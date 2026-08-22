// Integration test for F191 (AS-346), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf/makeUser/afterAll
// pattern established by tests/integration/delete-comment.test.ts, whose
// author-or-admin permission structure this restore counterpart mirrors
// exactly.

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

let realtimeClientForServerAction: SupabaseClient | null = null;

describe.skipIf(!haveAdminCreds)(
  "restoreComment (F191: AS-346)",
  () => {
    let adminClient: SupabaseClient;
    let subscriberClient: SupabaseClient;
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
          name: "F191 Test Workspace",
          slug: `f191-comments-${uniqueSuffix}`,
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
          name: "F191 Other Workspace",
          slug: `f191-other-${uniqueSuffix}`,
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
        const email = `f191-${label}-${uniqueSuffix}@example.com`;
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

      authorUserId = await makeUser("author");
      otherMemberUserId = await makeUser("other-member");
      adminUserId = await makeUser("admin");
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
          name: `F191 Project ${uniqueSuffix}`,
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
          title: `F191 Task ${uniqueSuffix}`,
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

    async function makeDeletedComment(): Promise<string> {
      const { data, error } = await adminClient
        .from("comments")
        .insert({
          task_id: taskId,
          user_id: authorUserId,
          text: `F191 comment ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          deleted_at: new Date().toISOString(),
          deleted_by: authorUserId,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed deleted comment: ${error?.message}`);
      }
      createdCommentIds.push(data.id);
      return data.id;
    }

    it("AS-346: the comment's own author can restore their own deleted comment", async () => {
      const { restoreComment } = await import("@/lib/actions/comments");
      const commentId = await makeDeletedComment();

      currentTestUserId = authorUserId;
      const result = await restoreComment(commentId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.id).toBe(commentId);

      const { data: row } = await adminClient
        .from("comments")
        .select("deleted_at, deleted_by")
        .eq("id", commentId)
        .single();
      expect(row?.deleted_at).toBeNull();
      expect(row?.deleted_by).toBeNull();
    });

    it("AS-346: a workspace admin/owner can restore another member's deleted comment", async () => {
      const { restoreComment } = await import("@/lib/actions/comments");
      const commentId = await makeDeletedComment(); // authored by authorUserId

      currentTestUserId = adminUserId;
      const result = await restoreComment(commentId);

      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("comments")
        .select("deleted_at")
        .eq("id", commentId)
        .single();
      expect(row?.deleted_at).toBeNull();
    });

    it("AS-346 (negative): a different regular member (not author, not admin/owner) cannot restore someone else's deleted comment", async () => {
      const { restoreComment } = await import("@/lib/actions/comments");
      const commentId = await makeDeletedComment(); // authored by authorUserId

      currentTestUserId = otherMemberUserId;
      const result = await restoreComment(commentId);

      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("comments")
        .select("deleted_at")
        .eq("id", commentId)
        .single();
      expect(row?.deleted_at).not.toBeNull();
    });

    it("a caller who is not a member of the comment's workspace at all cannot restore it", async () => {
      const { restoreComment } = await import("@/lib/actions/comments");
      const commentId = await makeDeletedComment();

      currentTestUserId = outsiderUserId;
      const result = await restoreComment(commentId);

      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("comments")
        .select("deleted_at")
        .eq("id", commentId)
        .single();
      expect(row?.deleted_at).not.toBeNull();
    });

    it("restoring an already-active (never-deleted) comment is a no-op success, not an error", async () => {
      const { restoreComment } = await import("@/lib/actions/comments");
      const { data, error } = await adminClient
        .from("comments")
        .insert({
          task_id: taskId,
          user_id: authorUserId,
          text: `F191 active comment ${Date.now()}`,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error("failed to seed active comment");
      createdCommentIds.push(data.id);

      currentTestUserId = authorUserId;
      const result = await restoreComment(data.id);
      expect(result.ok).toBe(true);
    });

    it("restoring a non-existent comment id returns an error", async () => {
      const { restoreComment } = await import("@/lib/actions/comments");
      currentTestUserId = authorUserId;
      const result = await restoreComment("00000000-0000-0000-0000-000000000000");
      expect(result.ok).toBe(false);
    });

    it(
      "AS-346 realtime: a real restoreComment call broadcasts comment_restored, and an independent subscriber on comments:<taskId> actually receives it with the restored comment's data",
      async () => {
        const { restoreComment } = await import("@/lib/actions/comments");
        const commentId = await makeDeletedComment();

        const received = await new Promise<{ id: string } | null>(
          (resolve, reject) => {
            const timeout = setTimeout(() => {
              resolve(null);
            }, 8000);

            const channel = subscriberClient
              .channel(`comments:${taskId}`)
              .on(
                "broadcast",
                { event: "comment_restored" },
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
                  currentTestUserId = authorUserId;
                  void restoreComment(commentId);
                }
              });

            void channel;
          },
        );

        expect(received).not.toBeNull();
        expect(received?.id).toBe(commentId);

        const { data: row } = await adminClient
          .from("comments")
          .select("deleted_at")
          .eq("id", commentId)
          .single();
        expect(row?.deleted_at).toBeNull();
      },
      15000,
    );
  },
);
