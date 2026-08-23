// Integration test for F303 (missions/20260818-213033 follow-up FU-1,
// D3: AS-363, AS-365, AS-366), run against the real linked Supabase
// project — mirrors the loadDotEnv/skipIf/makeUser/afterAll pattern
// established by tests/integration/edit-comment.test.ts.
//
// This is the exact test the scrutiny report (M15-scrutiny.md, D3/D8)
// called for: creates a comment, edits it, reacts to it, then calls the
// REAL getTaskDetail (simulating a page reload, not a hand-built prop the
// test author already knows is correct) and asserts edited_at/body_json
// and reactions are actually present in the result. Every other test that
// touched this data (comment-list.test.ts, comment-reactions.test.ts)
// supplied editedAt/reactions as a prop, which is exactly why the missing
// getTaskDetail select went uncaught — this test would have failed on the
// pre-fix query.

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
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

// Swapped per test/step — mirrors tests/integration/toggle-reaction.test.ts's
// pattern of mocking createClient() to return a REAL, signed-in per-user
// SupabaseClient (not a hand-rolled fake with only `auth.getUser` stubbed),
// so editComment/toggleReaction's own `.from()`/`.channel()` calls (RLS,
// realtime broadcast) work exactly as they do in production, and so this
// test genuinely exercises RLS rather than an admin bypass.
let currentSessionClient: SupabaseClient | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    // getTaskDetail itself never calls revalidatePath — this mock exists
    // only in case a Server Action imported transitively during this file
    // does, mirroring the other integration tests' convention.
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentSessionClient,
}));

describe.skipIf(!haveAdminCreds)(
  "getTaskDetail comment read path (F303: AS-363, AS-365, AS-366)",
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
    let authorUserId: string;
    let authorEmail: string;
    let authorClient: SupabaseClient;
    let reactorUserId: string;
    let reactorEmail: string;
    let reactorClient: SupabaseClient;
    const password = "Test-password-1!";

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F303 Test Workspace",
          slug: `f303-comments-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      async function makeUser(label: string) {
        const email = `f303-${label}-${uniqueSuffix}@example.com`;
        const { data, error } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (error || !data.user) {
          throw new Error(`Failed to create ${label} user: ${error?.message}`);
        }
        createdUserIds.push(data.user.id);
        return { id: data.user.id, email };
      }

      const author = await makeUser("author");
      authorUserId = author.id;
      authorEmail = author.email;

      const reactor = await makeUser("reactor");
      reactorUserId = reactor.id;
      reactorEmail = reactor.email;

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert([
          {
            workspace_id: workspaceId,
            user_id: authorUserId,
            role: "member",
            status: "active",
          },
          {
            workspace_id: workspaceId,
            user_id: reactorUserId,
            role: "member",
            status: "active",
          },
        ]);
      if (memberInsertErr) {
        throw new Error(`Failed to seed members: ${memberInsertErr.message}`);
      }

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F303 Project ${uniqueSuffix}`,
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
          title: `F303 Task ${uniqueSuffix}`,
          author_id: authorUserId,
        })
        .select("id")
        .single();
      if (taskErr || !task) {
        throw new Error(`Failed to create test task: ${taskErr?.message}`);
      }
      taskId = task.id;
      createdTaskIds.push(taskId);

      authorClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: authorSignInErr } = await authorClient.auth.signInWithPassword({
        email: authorEmail,
        password,
      });
      if (authorSignInErr) {
        throw new Error(`Failed to sign in author: ${authorSignInErr.message}`);
      }

      reactorClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: reactorSignInErr } = await reactorClient.auth.signInWithPassword({
        email: reactorEmail,
        password,
      });
      if (reactorSignInErr) {
        throw new Error(`Failed to sign in reactor: ${reactorSignInErr.message}`);
      }
    });

    beforeEach(() => {
      currentSessionClient = null;
    });

    afterAll(async () => {
      await adminClient.from("comment_reactions").delete().in(
        "comment_id",
        createdCommentIds.length > 0 ? createdCommentIds : ["00000000-0000-0000-0000-000000000000"],
      );
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
    });

    it("test_AS_363_AS_365_AS_366_getTaskDetail_carries_edited_at_and_reactions_through_a_simulated_reload", async () => {
      // 1. Create a comment as the author, directly against the DB —
      //    matches what addComment would insert.
      const { data: commentRow, error: commentErr } = await adminClient
        .from("comments")
        .insert({
          task_id: taskId,
          user_id: authorUserId,
          text: "original text",
        })
        .select("id")
        .single();
      if (commentErr || !commentRow) {
        throw new Error(`Failed to seed comment: ${commentErr?.message}`);
      }
      const commentId = commentRow.id;
      createdCommentIds.push(commentId);

      // 2. Edit it via the real editComment Server Action, as the author —
      //    stamps edited_at, exactly the F197 path AS-363 depends on.
      currentSessionClient = authorClient;
      const { editComment } = await import("@/lib/actions/comments");
      const editResult = await editComment(commentId, "edited text");
      expect(editResult.ok).toBe(true);

      // 3. React to it via the real toggleReaction Server Action, as a
      //    different member — the real INSERT path AS-365/AS-366 depend on.
      currentSessionClient = reactorClient;
      const { toggleReaction } = await import("@/lib/actions/comment-reactions");
      const reactResult = await toggleReaction(commentId, "👍");
      expect(reactResult.ok).toBe(true);

      // 4. Simulate a fresh page load: call the real getTaskDetail (not a
      //    hand-built TaskComment prop) as any signed-in member.
      currentSessionClient = authorClient;
      const { getTaskDetail } = await import("@/lib/actions/tasks");
      const detail = await getTaskDetail(taskId);

      expect(detail.ok).toBe(true);
      if (!detail.ok) return;

      const reloadedComment = detail.data.comments.find(
        (comment) => comment.id === commentId,
      );
      expect(reloadedComment).toBeTruthy();

      // AS-363: the edit survives a reload — this is what
      // getTaskDetail's pre-fix `id, task_id, user_id, text, created_at`
      // select could never carry.
      expect(reloadedComment?.text).toBe("edited text");
      expect(reloadedComment?.editedAt).toBeTruthy();

      // AS-365/AS-366: the reaction, added by a DIFFERENT viewer before
      // this "reload", is actually present — not undefined, as it always
      // was pre-fix.
      expect(reloadedComment?.reactions).toBeTruthy();
      const thumbsUp = reloadedComment?.reactions?.find(
        (reaction) => reaction.emoji === "👍",
      );
      expect(thumbsUp).toBeTruthy();
      expect(thumbsUp?.userIds).toContain(reactorUserId);
    });

    it("test_AS_365_a_comment_with_no_reactions_still_returns_an_empty_array_not_undefined", async () => {
      const { data: commentRow, error: commentErr } = await adminClient
        .from("comments")
        .insert({
          task_id: taskId,
          user_id: authorUserId,
          text: "no reactions here",
        })
        .select("id")
        .single();
      if (commentErr || !commentRow) {
        throw new Error(`Failed to seed comment: ${commentErr?.message}`);
      }
      createdCommentIds.push(commentRow.id);

      currentSessionClient = authorClient;
      const { getTaskDetail } = await import("@/lib/actions/tasks");
      const detail = await getTaskDetail(taskId);

      expect(detail.ok).toBe(true);
      if (!detail.ok) return;

      const reloadedComment = detail.data.comments.find(
        (comment) => comment.id === commentRow.id,
      );
      expect(reloadedComment?.reactions).toEqual([]);
      expect(reloadedComment?.editedAt).toBeFalsy();
    });
  },
);
