// F339 (M18 scrutiny BLOCKER-4 fix, AS-530 follow-up FU-B): regression guard
// for the real product bug FU-B describes — `addComment` 500ing whenever the
// submitted `bodyJson` actually contains a real `mention` node, reproduced
// 3/3 via the real "Post" button by a prior worker and confirmed again by
// this feature's own live repro against a running dev server (see this
// feature's handoff, "Notes for the next worker", for the exact stack
// trace/root cause).
//
// This test calls `addComment` directly (as a plain async function, the
// same convention tests/integration/add-comment.test.ts already
// establishes) with a mention-bearing `bodyJson` shaped exactly like
// `editor.getJSON()` actually produces for a real `@`-mention (including
// the `label`/`mentionSuggestionChar` attrs @tiptap/extension-mention's
// stock schema adds beyond just `id` — the real shape the composer sends,
// not a hand-trimmed `{ id }`-only stand-in). Calling the Server Action as
// a plain function from a Vitest process never exercises the actual
// browser -> Server Action RPC wire (there is no React Flight
// serialisation boundary in this test, only a direct function call), so
// this test cannot, by itself, catch the *live* "temporary client
// reference" crash the way the F272 e2e test's real "Post" button click
// can — that live boundary is exactly why this feature also fixed
// components/task/comment-list.tsx's client-side call sites (see
// `toPlainJson`, lib/comments/rich-text.ts) and rewrote the e2e mention
// test to submit for real. What THIS test guards is the business logic
// half FU-B explicitly asks for: given a mention-bearing body reaches
// `addComment` intact, the persisted `text` projection is correct AND the
// `mention` notification fan-out actually fires — regressions in either of
// those would not depend on the browser-serialisation bug at all, so they
// need their own guard independent of the e2e suite.
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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F339: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

// A real, signed-in session client (not a bare getUser()-only stub) is
// required here — unlike tests/integration/add-comment.test.ts (which only
// needs auth.getUser() for its plain-text-only assertions),
// createNotification's create_notification RPC and the delete/restore
// broadcast channel both need a real PostgREST/Realtime session to run
// through (same rationale as tests/integration/notification-fanout.test.ts's
// own doc comment).
let sessionClientForMock: SupabaseClient | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => sessionClientForMock,
}));

describe.skipIf(!haveAdminCreds)(
  "addComment with a real mention node (F339: M18 scrutiny BLOCKER-4 / FU-B)",
  () => {
    let adminClient: SupabaseClient;
    const createdCommentIds: string[] = [];
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let taskId: string;
    let actorUserId: string;
    let actorClient: SupabaseClient;
    let recipientUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F339 Test Workspace",
          slug: `f339-mention-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const actorEmail = `f339-actor-${uniqueSuffix}@example.com`;
      const actorPassword = "Test-password-1!";
      const { data: actorAuth, error: actorAuthErr } =
        await adminClient.auth.admin.createUser({
          email: actorEmail,
          password: actorPassword,
          email_confirm: true,
        });
      if (actorAuthErr || !actorAuth.user) {
        throw new Error(`Failed to create actor user: ${actorAuthErr?.message}`);
      }
      actorUserId = actorAuth.user.id;
      createdUserIds.push(actorUserId);

      const recipientEmail = `f339-recipient-${uniqueSuffix}@example.com`;
      const { data: recipientAuth, error: recipientAuthErr } =
        await adminClient.auth.admin.createUser({
          email: recipientEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (recipientAuthErr || !recipientAuth.user) {
        throw new Error(
          `Failed to create recipient user: ${recipientAuthErr?.message}`,
        );
      }
      recipientUserId = recipientAuth.user.id;
      createdUserIds.push(recipientUserId);

      const { error: membersErr } = await adminClient
        .from("workspace_members")
        .insert([
          {
            workspace_id: workspaceId,
            user_id: actorUserId,
            role: "member",
            status: "active",
          },
          {
            workspace_id: workspaceId,
            user_id: recipientUserId,
            role: "member",
            status: "active",
          },
        ]);
      if (membersErr) {
        throw new Error(`Failed to seed members: ${membersErr.message}`);
      }

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F339 Project ${uniqueSuffix}`,
          created_by: actorUserId,
          visibility: "workspace",
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
          title: `F339 Task ${uniqueSuffix}`,
          author_id: actorUserId,
        })
        .select("id")
        .single();
      if (taskErr || !task) {
        throw new Error(`Failed to create test task: ${taskErr?.message}`);
      }
      taskId = task.id;
      createdTaskIds.push(taskId);

      actorClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await actorClient.auth.signInWithPassword({
        email: actorEmail,
        password: actorPassword,
      });
      if (signInErr) {
        throw new Error(`Failed to sign in actor: ${signInErr.message}`);
      }
    });

    beforeEach(() => {
      sessionClientForMock = actorClient;
    });

    afterAll(async () => {
      await adminClient.from("notifications").delete().eq("workspace_id", workspaceId);
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
        await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    it("AS-530 (FU-B): persists the mention's text projection and fans out a `mention` notification, without throwing", async () => {
      const { addComment } = await import("@/lib/actions/comments");

      // The real shape editor.getJSON() produces for an inserted mention —
      // @tiptap/extension-mention's stock schema attrs (`id`, `label`,
      // `mentionSuggestionChar`), not a hand-trimmed `{ id }`-only object,
      // so this test exercises the actual data shape the composer sends,
      // matching this feature's own live-verified repro.
      const bodyJson = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "mention",
                attrs: {
                  id: recipientUserId,
                  label: null,
                  mentionSuggestionChar: "@",
                },
              },
              { type: "text", text: " welcome to the task" },
            ],
          },
        ],
      };

      const result = await addComment(
        taskId,
        `@${recipientUserId} welcome to the task`,
        bodyJson,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdCommentIds.push(result.data.id);

      // The server-recomputed plain-text projection resolves the mention
      // to "@<id>" (addComment never has a client label-resolving function
      // in scope — see lib/comments/rich-text.ts's extractPlainText doc
      // comment) and keeps the trailing text.
      expect(result.data.text).toBe(`@${recipientUserId} welcome to the task`);

      const { data: row, error } = await adminClient
        .from("comments")
        .select("id, text, body_text, body_json")
        .eq("id", result.data.id)
        .single();
      expect(error).toBeNull();
      expect(row?.text).toBe(`@${recipientUserId} welcome to the task`);
      expect(row?.body_text).toBe(`@${recipientUserId} welcome to the task`);

      // AS-374/AS-381/AS-384: the mentioned user gets a `mention`
      // notification, linked to this comment.
      const { data: notifications, error: notifError } = await adminClient
        .from("notifications")
        .select("id, kind, user_id, comment_id, task_id")
        .eq("workspace_id", workspaceId)
        .eq("user_id", recipientUserId)
        .eq("kind", "mention");
      expect(notifError).toBeNull();
      expect(notifications ?? []).toHaveLength(1);
      expect(notifications?.[0]?.comment_id).toBe(result.data.id);
      expect(notifications?.[0]?.task_id).toBe(taskId);

      // AS-375: the mentioned non-watcher becomes a watcher.
      const { data: watcherRow } = await adminClient
        .from("task_watchers")
        .select("is_watching")
        .eq("task_id", taskId)
        .eq("user_id", recipientUserId)
        .maybeSingle();
      expect(watcherRow?.is_watching).toBe(true);
    });

    it("a mention-only comment (no other words) still projects to non-empty text and posts successfully", async () => {
      const { addComment } = await import("@/lib/actions/comments");

      const bodyJson = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "mention",
                attrs: {
                  id: recipientUserId,
                  label: null,
                  mentionSuggestionChar: "@",
                },
              },
            ],
          },
        ],
      };

      const result = await addComment(taskId, "placeholder", bodyJson);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdCommentIds.push(result.data.id);
      expect(result.data.text).toBe(`@${recipientUserId}`);
    });
  },
);
