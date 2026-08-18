// Integration test for F061 (AS-098, AS-099, AS-100), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf pattern
// established by tests/integration/delete-task.test.ts.
//
// `@/lib/supabase/server`'s `createClient()` is mocked to stand in for the
// Next.js request-scoped server client, resolving `auth.getUser()` to a real
// throwaway Supabase Auth user for the current test.

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
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "deleteComment (F061: AS-098, AS-099, AS-100)",
  () => {
    let adminClient: SupabaseClient;
    const createdCommentIds: string[] = [];
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let otherWorkspaceId: string;
    let projectId: string;
    let taskId: string;
    let authorUserId: string;
    let otherMemberUserId: string;
    let adminUserId: string;
    let outsiderUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F061 Test Workspace",
          slug: `f061-comments-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const { data: otherWs, error: otherWsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F061 Other Workspace",
          slug: `f061-other-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (otherWsErr || !otherWs) {
        throw new Error(
          `Failed to create other test workspace: ${otherWsErr?.message}`,
        );
      }
      otherWorkspaceId = otherWs.id;
      createdWorkspaceIds.push(otherWorkspaceId);

      async function makeUser(label: string) {
        const email = `f061-${label}-${uniqueSuffix}@example.com`;
        const { data, error } = await adminClient.auth.admin.createUser({
          email,
          password: "Test-password-1!",
          email_confirm: true,
        });
        if (error || !data.user) {
          throw new Error(`Failed to create ${label} user: ${error?.message}`);
        }
        createdUserIds.push(data.user.id);
        return data.user.id;
      }

      // The comment's author (a plain member).
      authorUserId = await makeUser("author");
      // A different plain member of the same workspace — NOT the author,
      // NOT an admin/owner. Used to prove AS-099.
      otherMemberUserId = await makeUser("other-member");
      // An admin of the same workspace. Used to prove AS-100.
      adminUserId = await makeUser("admin");
      // A member of a *different* workspace only. Used as a non-member
      // negative case.
      outsiderUserId = await makeUser("outsider");

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
            user_id: otherMemberUserId,
            role: "member",
            status: "active",
          },
          {
            workspace_id: workspaceId,
            user_id: adminUserId,
            role: "admin",
            status: "active",
          },
          {
            workspace_id: otherWorkspaceId,
            user_id: outsiderUserId,
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
          name: `F061 Project ${uniqueSuffix}`,
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
          title: `F061 Task ${uniqueSuffix}`,
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
    });

    async function makeComment(): Promise<string> {
      const { data, error } = await adminClient
        .from("comments")
        .insert({
          task_id: taskId,
          user_id: authorUserId,
          text: `F061 comment ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed comment: ${error?.message}`);
      }
      createdCommentIds.push(data.id);
      return data.id;
    }

    it("AS-098: the comment's own author can delete their own comment", async () => {
      const { deleteComment } = await import("@/lib/actions/comments");
      const commentId = await makeComment();

      currentTestUserId = authorUserId;
      const result = await deleteComment(commentId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.id).toBe(commentId);
      expect(result.data.deletedAt).toBeTruthy();

      // Soft-deleted, not physically removed.
      const { data: row, error: rowError } = await adminClient
        .from("comments")
        .select("id, deleted_at")
        .eq("id", commentId)
        .single();
      expect(rowError).toBeNull();
      expect(row?.id).toBe(commentId);
      expect(row?.deleted_at).not.toBeNull();
    });

    it("AS-100: a workspace admin/owner can delete another member's comment", async () => {
      const { deleteComment } = await import("@/lib/actions/comments");
      const commentId = await makeComment(); // authored by authorUserId

      currentTestUserId = adminUserId;
      const result = await deleteComment(commentId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { data: row } = await adminClient
        .from("comments")
        .select("deleted_at")
        .eq("id", commentId)
        .single();
      expect(row?.deleted_at).not.toBeNull();
    });

    it("AS-099: a different regular member (not author, not admin/owner) cannot delete someone else's comment", async () => {
      const { deleteComment } = await import("@/lib/actions/comments");
      const commentId = await makeComment(); // authored by authorUserId

      currentTestUserId = otherMemberUserId;
      const result = await deleteComment(commentId);

      expect(result.ok).toBe(false);

      // Side-effect check: the comment was not soft-deleted.
      const { data: row } = await adminClient
        .from("comments")
        .select("deleted_at")
        .eq("id", commentId)
        .single();
      expect(row?.deleted_at).toBeNull();
    });

    it("a caller who is not a member of the comment's workspace at all cannot delete it", async () => {
      const { deleteComment } = await import("@/lib/actions/comments");
      const commentId = await makeComment();

      currentTestUserId = outsiderUserId;
      const result = await deleteComment(commentId);

      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("comments")
        .select("deleted_at")
        .eq("id", commentId)
        .single();
      expect(row?.deleted_at).toBeNull();
    });

    it("AS-098/AS-100 side effect: deleting one comment does not affect another comment on the same task", async () => {
      const { deleteComment } = await import("@/lib/actions/comments");
      const commentId = await makeComment();
      const untouchedCommentId = await makeComment();

      currentTestUserId = authorUserId;
      const result = await deleteComment(commentId);
      expect(result.ok).toBe(true);

      const { data: untouchedRow } = await adminClient
        .from("comments")
        .select("deleted_at")
        .eq("id", untouchedCommentId)
        .single();
      expect(untouchedRow?.deleted_at).toBeNull();
    });

    it("an already-deleted comment is treated as not found by deleteComment (idempotent-safe)", async () => {
      const { deleteComment } = await import("@/lib/actions/comments");
      const commentId = await makeComment();

      currentTestUserId = authorUserId;
      const first = await deleteComment(commentId);
      expect(first.ok).toBe(true);

      const second = await deleteComment(commentId);
      expect(second.ok).toBe(false);
    });
  },
);
