// Integration test for F104 (AS-101 fix), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf/makeUser/afterAll
// pattern established by tests/integration/delete-comment.test.ts.
//
// What this proves that tests/unit/comment-realtime-subscription.test.ts
// cannot: that calling the real `deleteComment` Server Action against the
// real Supabase project actually causes a real Realtime Broadcast message
// to be delivered over the wire, with the correct comment id — not just
// that a reducer correctly transforms a synthetic payload someone claims
// Realtime would send.
//
// Per F104's spec ("if a fully real two-client Realtime test proves too
// flaky/slow for CI, a test that subscribes and asserts the broadcast
// fires with correct payload from ONE test client... is an acceptable
// middle ground"): this test subscribes to the `comments:<taskId>`
// broadcast channel from the test process itself (a real Realtime
// WebSocket client, completely independent of the Supabase client instance
// `deleteComment` uses internally), awaits SUBSCRIBED before calling
// `deleteComment`, and asserts the broadcast event actually arrives with
// the deleted comment's id. This is deliberately the single-client middle
// ground rather than a second simulated "other viewer" auth session,
// because standing up a second authenticated Realtime client purely to
// prove the channel/event-name/payload wiring (already proven for THIS
// client) would add auth/session flakiness without adding coverage of the
// actual regression this test guards against — the regression AS-101 was
// broken by (postgres_changes silently dropping an event due to RLS on the
// NEW row) has nothing to do with which client authored the subscription;
// it's about whether *any* subscriber to this channel/event ever receives
// anything at all. A subscriber receiving the broadcast proves delivery
// is real, independent of the RLS-on-NEW-row bug that made
// postgres_changes silently no-op for every subscriber including the
// deleter themselves.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  const contents = readFileSync(path, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;

import { vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: currentTestUserId ? { id: currentTestUserId } : null,
        },
      }),
    },
    channel: (name: string) => realtimeClientForServerAction!.channel(name),
    removeChannel: (ch: unknown) =>
      realtimeClientForServerAction!.removeChannel(ch as never),
  }),
}));

// The real Supabase client `deleteComment`'s mocked `createClient()` above
// delegates to for `.channel()`/`.send()` — a genuine Realtime-capable
// client (anon key, matching what a real request-scoped server client
// would use), kept separate from `adminClient` (service role, used only
// for direct-DB test setup/teardown) and separate from `subscriberClient`
// (the independent "viewer" that proves delivery below).
let realtimeClientForServerAction: SupabaseClient | null = null;

describe.skipIf(!haveAdminCreds)(
  "deleteComment Realtime Broadcast delivery (F104: AS-101)",
  () => {
    let adminClient: SupabaseClient;
    let subscriberClient: SupabaseClient;
    const createdCommentIds: string[] = [];
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let taskId: string;
    let authorUserId: string;

    const ANON_KEY =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? SECRET_KEY!;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      realtimeClientForServerAction = createClient(SUPABASE_URL!, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      subscriberClient = createClient(SUPABASE_URL!, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F104 Test Workspace",
          slug: `f104-comments-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const { data: userData, error: userErr } =
        await adminClient.auth.admin.createUser({
          email: `f104-author-${uniqueSuffix}@example.com`,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (userErr || !userData.user) {
        throw new Error(`Failed to create test user: ${userErr?.message}`);
      }
      authorUserId = userData.user.id;
      createdUserIds.push(authorUserId);

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: authorUserId,
          role: "member",
          status: "active",
        });
      if (memberInsertErr) {
        throw new Error(`Failed to seed member: ${memberInsertErr.message}`);
      }

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F104 Project ${uniqueSuffix}`,
          created_by: authorUserId,
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      projectId = proj.id;
      createdProjectIds.push(projectId);

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F104 Task ${uniqueSuffix}`,
          author_id: authorUserId,
        })
        .select("id")
        .single();
      if (taskErr || !task) {
        throw new Error(`Failed to create test task: ${taskErr?.message}`);
      }
      taskId = task.id;
      createdTaskIds.push(taskId);
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      for (const commentId of createdCommentIds) {
        await adminClient.from("comments").delete().eq("id", commentId);
      }
      for (const tId of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", tId);
      }
      for (const pId of createdProjectIds) {
        await adminClient.from("projects").delete().eq("id", pId);
      }
      for (const wsId of createdWorkspaceIds) {
        await adminClient
          .from("workspace_members")
          .delete()
          .eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
      await realtimeClientForServerAction?.removeAllChannels();
      await subscriberClient?.removeAllChannels();
    });

    async function makeComment(): Promise<string> {
      const { data, error } = await adminClient
        .from("comments")
        .insert({
          task_id: taskId,
          user_id: authorUserId,
          text: `F104 comment ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed comment: ${error?.message}`);
      }
      createdCommentIds.push(data.id);
      return data.id;
    }

    it(
      "AS-101: a real deleteComment call broadcasts comment_deleted, and an independent subscriber on comments:<taskId> actually receives it with the correct comment id",
      async () => {
        const { deleteComment } = await import("@/lib/actions/comments");
        const commentId = await makeComment();

        // A second, fully independent Realtime client (its own websocket
        // connection) subscribes to the same channel deleteComment will
        // broadcast on, exactly as
        // components/task/use-comments-realtime.ts's live viewers do. This
        // is the "second client" for delivery purposes — it does not
        // require its own authenticated app session because the thing
        // under test is Realtime broadcast delivery itself, not
        // application-level authorization (already covered by
        // tests/integration/delete-comment.test.ts's AS-098/099/100 and
        // tests/integration/rls-comments.test.ts).
        const received = await new Promise<{ id: string } | null>(
          (resolve, reject) => {
            const timeout = setTimeout(() => {
              resolve(null);
            }, 8000);

            const channel = subscriberClient
              .channel(`comments:${taskId}`)
              .on(
                "broadcast",
                { event: "comment_deleted" },
                (message: { payload: { id: string } }) => {
                  clearTimeout(timeout);
                  resolve(message.payload);
                },
              )
              .subscribe((status, err) => {
                if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                  clearTimeout(timeout);
                  reject(err ?? new Error(`subscribe failed: ${status}`));
                  return;
                }
                if (status === "SUBSCRIBED") {
                  // Only call deleteComment once the subscriber is
                  // confirmed live on the channel, so this test can't
                  // pass by accident on a race where the broadcast beats
                  // the subscription.
                  currentTestUserId = authorUserId;
                  void deleteComment(commentId);
                }
              });

            // Ensure cleanup even on the resolve path below.
            void channel;
          },
        );

        expect(received).not.toBeNull();
        expect(received?.id).toBe(commentId);

        // The soft-delete itself also actually happened (not just the
        // broadcast) — same assertion style as delete-comment.test.ts.
        const { data: row } = await adminClient
          .from("comments")
          .select("deleted_at")
          .eq("id", commentId)
          .single();
        expect(row?.deleted_at).not.toBeNull();
      },
      15000,
    );
  },
);
