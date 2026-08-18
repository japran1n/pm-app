// Integration test for F059 (AS-094, AS-095), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/create-task.test.ts.
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
  "addComment (F059: AS-094, AS-095)",
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
    let memberUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F059 Test Workspace",
          slug: `f059-comments-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const memberEmail = `f059-member-${uniqueSuffix}@example.com`;
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create member user: ${memberAuthErr?.message}`);
      }
      memberUserId = memberAuth.user.id;
      createdUserIds.push(memberUserId);

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: memberUserId,
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
          name: `F059 Project ${uniqueSuffix}`,
          created_by: memberUserId,
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
          title: `F059 Task ${uniqueSuffix}`,
          author_id: memberUserId,
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
        await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    it("AS-094: an active workspace member can add a non-empty text comment to a task", async () => {
      const { addComment } = await import("@/lib/actions/comments");

      currentTestUserId = memberUserId;

      const text = `F059 comment ${Date.now()}`;
      const result = await addComment(taskId, text);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      createdCommentIds.push(result.data.id);

      expect(result.data.taskId).toBe(taskId);
      expect(result.data.userId).toBe(memberUserId);
      expect(result.data.text).toBe(text);

      const { data: row, error } = await adminClient
        .from("comments")
        .select("id, task_id, user_id, text")
        .eq("id", result.data.id)
        .single();

      expect(error).toBeNull();
      expect(row?.task_id).toBe(taskId);
      expect(row?.user_id).toBe(memberUserId);
      expect(row?.text).toBe(text);
    });

    it("AS-095: an empty-string comment is rejected before reaching the database", async () => {
      const { addComment } = await import("@/lib/actions/comments");

      currentTestUserId = memberUserId;

      const result = await addComment(taskId, "");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeTruthy();

      const { data: rows } = await adminClient
        .from("comments")
        .select("id")
        .eq("task_id", taskId)
        .eq("text", "");
      expect(rows ?? []).toHaveLength(0);
    });

    it("AS-095: a whitespace-only comment is rejected before reaching the database", async () => {
      const { addComment } = await import("@/lib/actions/comments");

      currentTestUserId = memberUserId;

      const result = await addComment(taskId, "   ");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeTruthy();
    });

    it("a user who is not a member of the task's workspace cannot add a comment", async () => {
      const { addComment } = await import("@/lib/actions/comments");

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const nonMemberEmail = `f059-nonmember-${uniqueSuffix}@example.com`;
      const { data: nonMemberAuth, error: nonMemberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: nonMemberEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (nonMemberAuthErr || !nonMemberAuth.user) {
        throw new Error(
          `Failed to create non-member user: ${nonMemberAuthErr?.message}`,
        );
      }
      createdUserIds.push(nonMemberAuth.user.id);

      currentTestUserId = nonMemberAuth.user.id;

      const result = await addComment(taskId, `F059 nonmember comment ${Date.now()}`);

      expect(result.ok).toBe(false);

      const { data: rows } = await adminClient
        .from("comments")
        .select("id")
        .eq("task_id", taskId)
        .eq("user_id", nonMemberAuth.user.id);
      expect(rows ?? []).toHaveLength(0);
    });
  },
);
