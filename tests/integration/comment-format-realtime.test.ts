// Integration test for F174 (AS-312: "comments support the same
// formatting as descriptions"), run against the real linked Supabase
// project.
//
// Mirrors two existing patterns in this suite:
//   - tests/integration/add-comment.test.ts's loadDotEnv/skipIf/
//     createClient-mock-for-the-Server-Action setup, for calling the real
//     `addComment` Server Action end to end.
//   - tests/integration/comment-delete-broadcast.test.ts's independent
//     "second client" subscriber structure, for proving Realtime delivery
//     is real and not just a synthetic payload assertion — adapted here
//     to `postgres_changes` INSERT (what a live comment actually goes
//     through per lib/tasks/subscribe-comments-realtime.ts; unlike
//     deleteComment, addComment does not use Broadcast — new rows always
//     pass comments_select_active_members's SELECT RLS check, so
//     postgres_changes INSERT delivery isn't affected by the RLS-on-NEW-
//     row bug that made deleteComment need Broadcast instead).
//
// What this proves that a pure reducer/unit test cannot:
//   1. A formatted comment (bold + italic marks) posted through the real
//      `addComment` Server Action actually round-trips through the real
//      database with its Tiptap JSONContent formatting intact
//      (body_json), not degraded to plain text.
//   2. An independent, already-subscribed Realtime client (standing in
//      for "a second connected client with the task open") actually
//      receives that same formatted document over the wire via
//      postgres_changes — proving the realtime reconciliation path
//      (lib/tasks/reconcile-realtime-comment.ts's `reconcileComment`,
//      wired through this exact row shape) has real formatted content to
//      render, not just a bare id.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { reconcileComment } from "@/lib/tasks/reconcile-realtime-comment";
import type { CommentRealtimeRow } from "@/lib/tasks/reconcile-realtime-comment";

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
  }),
}));

// A Tiptap JSONContent document exercising the same node/mark subset the
// shared editor's compact toolbar (components/editor/rich-text-editor.tsx)
// actually produces for comments: bold + italic marks inside a paragraph.
const FORMATTED_BODY = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "please " },
        { type: "text", text: "review", marks: [{ type: "bold" }] },
        { type: "text", text: " this " },
        { type: "text", text: "today", marks: [{ type: "italic" }] },
      ],
    },
  ],
};

describe.skipIf(!haveAdminCreds)(
  "comment rich-text round-trip and realtime delivery (F174: AS-312)",
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
    let authorEmail: string;
    const authorPassword = "Test-password-1!";

    const ANON_KEY =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? SECRET_KEY!;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      subscriberClient = createClient(SUPABASE_URL!, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F174 Test Workspace",
          slug: `f174-comments-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      authorEmail = `f174-author-${uniqueSuffix}@example.com`;
      const { data: userData, error: userErr } =
        await adminClient.auth.admin.createUser({
          email: authorEmail,
          password: authorPassword,
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
          name: `F174 Project ${uniqueSuffix}`,
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
          title: `F174 Task ${uniqueSuffix}`,
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
      currentTestUserId = authorUserId;
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
      await subscriberClient?.removeAllChannels();
    });

    it("AS-312: a formatted comment round-trips through the real database with body_json/body_text intact", async () => {
      const { addComment } = await import("@/lib/actions/comments");

      const plainText = "please review this today";
      const result = await addComment(taskId, plainText, FORMATTED_BODY);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdCommentIds.push(result.data.id);

      expect(result.data.bodyJson).toEqual(FORMATTED_BODY);

      const { data: row, error } = await adminClient
        .from("comments")
        .select("id, text, body_json, body_text")
        .eq("id", result.data.id)
        .single();

      expect(error).toBeNull();
      expect(row?.body_json).toEqual(FORMATTED_BODY);
      // AS-312: formatting marks are preserved in body_json even though
      // the legacy plain-text projection (body_text/text, used only by
      // the deprecated column and the CHECK constraint) necessarily loses
      // them, per the shared extractPlainText projection.
      expect(row?.body_text).toBe(plainText);
      expect(row?.text).toBe(plainText);

      // What comment-list.tsx's RichTextRenderer actually receives once
      // it hydrates client-side — proves the stored document, when run
      // through the exact same reconciliation shape a realtime row would
      // produce, still carries its bold/italic marks (not just present,
      // but structurally correct for rendering).
      const asRealtimeRow = {
        id: row!.id,
        task_id: taskId,
        user_id: authorUserId,
        text: row!.text,
        created_at: new Date().toISOString(),
        deleted_at: null,
        body_json: row!.body_json,
      } as unknown as CommentRealtimeRow;
      const reconciled = reconcileComment([], {
        eventType: "INSERT",
        schema: "public",
        table: "comments",
        new: asRealtimeRow,
        old: {},
      } as never);
      expect(reconciled[0]?.bodyJson).toEqual(FORMATTED_BODY);
    });

    it(
      "AS-312: an independent Realtime subscriber on comments:<taskId> receives a new formatted comment's body_json via postgres_changes INSERT",
      async () => {
        const { addComment } = await import("@/lib/actions/comments");

        // postgres_changes is RLS-gated (unlike deleteComment's Broadcast
        // path) — the subscriber must be authenticated as an active
        // member of the task's workspace for
        // comments_select_active_members to let the INSERT event through,
        // same as a real second browser tab with its own logged-in
        // session.
        const { error: signInError } =
          await subscriberClient.auth.signInWithPassword({
            email: authorEmail,
            password: authorPassword,
          });
        expect(signInError).toBeNull();

        const received = await new Promise<CommentRealtimeRow | null>(
          (resolve, reject) => {
            const timeout = setTimeout(() => resolve(null), 8000);

            const channel = subscriberClient
              .channel(`comments:${taskId}`)
              .on(
                "postgres_changes",
                {
                  event: "INSERT",
                  schema: "public",
                  table: "comments",
                  filter: `task_id=eq.${taskId}`,
                },
                (payload: { new: CommentRealtimeRow }) => {
                  clearTimeout(timeout);
                  resolve(payload.new);
                },
              )
              .subscribe((status, err) => {
                if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                  clearTimeout(timeout);
                  reject(err ?? new Error(`subscribe failed: ${status}`));
                  return;
                }
                if (status === "SUBSCRIBED") {
                  void addComment(
                    taskId,
                    "please review this today (live)",
                    FORMATTED_BODY,
                  ).then((result) => {
                    if (result.ok) createdCommentIds.push(result.data.id);
                  });
                }
              });

            void channel;
          },
        );

        expect(received).not.toBeNull();
        expect(received?.body_json).toEqual(FORMATTED_BODY);

        // Feeds the exact wire payload through the real reconciliation
        // reducer used by components/task/comment-list.tsx, proving the
        // live-delivered row renders through RichTextRenderer with its
        // formatting intact, not just that some payload arrived.
        const reconciled = reconcileComment([], {
          eventType: "INSERT",
          schema: "public",
          table: "comments",
          new: received!,
          old: {},
        } as never);
        expect(reconciled[0]?.bodyJson).toEqual(FORMATTED_BODY);
      },
      15000,
    );
  },
);
