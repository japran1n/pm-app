// Integration test for F036 (AS-051, AS-052, AS-053), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf pattern
// established by tests/integration/create-task.test.ts.
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
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "assignTask (F036: AS-051, AS-052, AS-053)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let otherWorkspaceId: string;
    let projectId: string;
    let memberUserId: string;
    let otherMemberUserId: string;
    let outsiderUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F036 Test Workspace",
          slug: `f036-tasks-${uniqueSuffix}`,
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
          name: "F036 Other Workspace",
          slug: `f036-other-${uniqueSuffix}`,
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

      // Active member of `workspaceId` — the caller in the happy-path tests
      // and a valid assignee target.
      const memberEmail = `f036-member-${uniqueSuffix}@example.com`;
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

      // A second active member of `workspaceId` — used as a second valid
      // assignee to confirm re-assignment works.
      const otherMemberEmail = `f036-other-member-${uniqueSuffix}@example.com`;
      const { data: otherMemberAuth, error: otherMemberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: otherMemberEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (otherMemberAuthErr || !otherMemberAuth.user) {
        throw new Error(
          `Failed to create other member user: ${otherMemberAuthErr?.message}`,
        );
      }
      otherMemberUserId = otherMemberAuth.user.id;
      createdUserIds.push(otherMemberUserId);

      // A member of a *different* workspace only — never a member of
      // `workspaceId`. Used both as an invalid assignee target (AS-052)
      // and as a non-member caller.
      const outsiderEmail = `f036-outsider-${uniqueSuffix}@example.com`;
      const { data: outsiderAuth, error: outsiderAuthErr } =
        await adminClient.auth.admin.createUser({
          email: outsiderEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (outsiderAuthErr || !outsiderAuth.user) {
        throw new Error(
          `Failed to create outsider user: ${outsiderAuthErr?.message}`,
        );
      }
      outsiderUserId = outsiderAuth.user.id;
      createdUserIds.push(outsiderUserId);

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert([
          {
            workspace_id: workspaceId,
            user_id: memberUserId,
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
          name: `F036 Project ${uniqueSuffix}`,
          created_by: memberUserId,
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      projectId = proj.id;
      createdProjectIds.push(projectId);
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      for (const taskId of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", taskId);
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

    async function makeTask(): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F036 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    it("AS-051: an active workspace member can assign a task to another active member of the same workspace", async () => {
      const { assignTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      currentTestUserId = memberUserId;

      const result = await assignTask(taskId, otherMemberUserId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.assigneeId).toBe(otherMemberUserId);

      const { data: row } = await adminClient
        .from("tasks")
        .select("assignee_id")
        .eq("id", taskId)
        .single();
      expect(row?.assignee_id).toBe(otherMemberUserId);
    });

    it("AS-052: assigning a task to a user who is not a member of the task's workspace is rejected", async () => {
      const { assignTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      currentTestUserId = memberUserId;

      const result = await assignTask(taskId, outsiderUserId);

      expect(result.ok).toBe(false);

      // Side-effect check: the task's assignee was not changed.
      const { data: row } = await adminClient
        .from("tasks")
        .select("assignee_id")
        .eq("id", taskId)
        .single();
      expect(row?.assignee_id).toBeNull();
    });

    it("AS-053: an active workspace member can unassign a task (assignee set to null)", async () => {
      const { assignTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      currentTestUserId = memberUserId;

      // First assign, then unassign.
      const assignResult = await assignTask(taskId, memberUserId);
      expect(assignResult.ok).toBe(true);

      const unassignResult = await assignTask(taskId, null);

      expect(unassignResult.ok).toBe(true);
      if (!unassignResult.ok) return;
      expect(unassignResult.data.assigneeId).toBeNull();

      const { data: row } = await adminClient
        .from("tasks")
        .select("assignee_id")
        .eq("id", taskId)
        .single();
      expect(row?.assignee_id).toBeNull();
    });

    it("a caller who is not a member of the task's workspace cannot call assignTask at all", async () => {
      const { assignTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      currentTestUserId = outsiderUserId;

      const result = await assignTask(taskId, otherMemberUserId);

      expect(result.ok).toBe(false);

      // Side-effect check: the task's assignee was not changed, and no
      // other workspace's rows were touched either.
      const { data: row } = await adminClient
        .from("tasks")
        .select("assignee_id")
        .eq("id", taskId)
        .single();
      expect(row?.assignee_id).toBeNull();
    });
  },
);
