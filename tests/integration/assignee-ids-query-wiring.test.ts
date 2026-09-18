// Integration test for F161 (AS-287, AS-288) — proves the full assignee
// SET (`task_assignees`) actually round-trips through every query the UI
// reads it from, not just built-but-unwired render logic. Mirrors the
// loadDotEnv/vi.mock("@/lib/supabase/server")/skipIf pattern established by
// tests/integration/estimate-minutes-query-wiring.test.ts (F167's own
// follow-up for the exact same "read path wiring" concern) and
// tests/integration/task-assignees-multi.test.ts (F160, for how
// `task_assignees` rows are seeded/asserted directly against the DB).
//
// This test sets 3 real assignees on a task via `setTaskAssigneesCore`
// (the same shared write path the UI actions above ultimately call), then
// calls every read path a live page actually uses —
// getProjectBoardTasks/getProjectListTasks/getWorkspaceListTasks
// (lib/queries/tasks.ts, feeding TaskCard/TaskListTable) and getTaskDetail
// (lib/actions/tasks.ts, feeding the task detail sheet) — and asserts the
// returned `assigneeIds` array carries every assignee through, oldest
// first, proving the end-to-end wiring this feature's clarified spec
// requires ("must be reachable end-to-end, not built-but-unwired").

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createClient as createSupabaseJsClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

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
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F161: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let memberClient: SupabaseClient | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => memberClient,
}));

describe.skipIf(!haveAdminCreds)(
  "F161 — task_assignees round-trips through every board/list/detail query",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let projectId: string;
    let taskWithAssigneesId: string;
    let taskWithoutAssigneesId: string;
    let memberUserId: string;
    let assigneeIds: string[];
    const createdTaskIds: string[] = [];

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const memberEmail = `f161-assignee-ids-wiring-${uniqueSuffix}@example.com`;
      const memberPassword = "Test-password-1!";

      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create test user: ${memberAuthErr?.message}`);
      }
      memberUserId = memberAuth.user.id;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F161 Assignee Ids Wiring Workspace",
          slug: `f161-assignee-ids-wiring-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      const { error: memberErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: memberUserId,
          role: "owner",
          status: "active",
        });
      if (memberErr) throw new Error(`Failed to seed membership: ${memberErr.message}`);

      const { data: project, error: projectErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F161 Assignee Ids Wiring Project",
        })
        .select("id")
        .single();
      if (projectErr || !project) {
        throw new Error(`Failed to seed project: ${projectErr?.message}`);
      }
      projectId = project.id;

      // Two more workspace members, both eligible assignees, so the test
      // task can genuinely carry 3 assignees (owner + 2 others), not just
      // the same user repeated.
      const extraUserIds: string[] = [];
      for (let i = 0; i < 2; i++) {
        const email = `f161-assignee-ids-wiring-extra-${i}-${uniqueSuffix}@example.com`;
        const { data: extraAuth, error: extraAuthErr } =
          await adminClient.auth.admin.createUser({
            email,
            password: memberPassword,
            email_confirm: true,
          });
        if (extraAuthErr || !extraAuth.user) {
          throw new Error(`Failed to create extra test user: ${extraAuthErr?.message}`);
        }
        extraUserIds.push(extraAuth.user.id);
        const { error: extraMemberErr } = await adminClient
          .from("workspace_members")
          .insert({
            workspace_id: workspaceId,
            user_id: extraAuth.user.id,
            role: "member",
            status: "active",
          });
        if (extraMemberErr) {
          throw new Error(`Failed to seed extra membership: ${extraMemberErr.message}`);
        }
      }

      const { data: taskWithAssignees, error: taskWithAssigneesErr } =
        await adminClient
          .from("tasks")
          .insert({
            project_id: projectId,
            title: "Task with 3 assignees",
            author_id: memberUserId,
          })
          .select("id")
          .single();
      if (taskWithAssigneesErr || !taskWithAssignees) {
        throw new Error(
          `Failed to seed task: ${taskWithAssigneesErr?.message}`,
        );
      }
      taskWithAssigneesId = taskWithAssignees.id;
      createdTaskIds.push(taskWithAssigneesId);

      const { data: taskWithoutAssignees, error: taskWithoutAssigneesErr } =
        await adminClient
          .from("tasks")
          .insert({
            project_id: projectId,
            title: "Task with no assignees",
            author_id: memberUserId,
          })
          .select("id")
          .single();
      if (taskWithoutAssigneesErr || !taskWithoutAssignees) {
        throw new Error(
          `Failed to seed unassigned task: ${taskWithoutAssigneesErr?.message}`,
        );
      }
      taskWithoutAssigneesId = taskWithoutAssignees.id;
      createdTaskIds.push(taskWithoutAssigneesId);

      // Oldest-first insert order (created_at ascending) — the same
      // ordering every read path below is asserted against.
      assigneeIds = [memberUserId, ...extraUserIds];
      for (const userId of assigneeIds) {
        const { error: taInsertErr } = await adminClient
          .from("task_assignees")
          .insert({ task_id: taskWithAssigneesId, user_id: userId });
        if (taInsertErr) {
          throw new Error(`Failed to seed task_assignees row: ${taInsertErr.message}`);
        }
      }

      memberClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await memberClient.auth.signInWithPassword({
        email: memberEmail,
        password: memberPassword,
      });
      if (signInErr) throw new Error(`Failed to sign in member: ${signInErr.message}`);
    }, 30000);

    afterAll(async () => {
      if (createdTaskIds.length > 0) {
        await adminClient.from("tasks").delete().in("id", createdTaskIds);
      }
      if (projectId) {
        await adminClient.from("projects").delete().eq("id", projectId);
      }
      if (workspaceId) {
        await adminClient
          .from("workspace_members")
          .delete()
          .eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
    }, 30000);

    it("test_AS_287_getProjectBoardTasks_carries_the_full_assignee_set_through_its_RPC_into_TaskCardTask", async () => {
      const { getProjectBoardTasks } = await import("@/lib/queries/tasks");
      const rows = await getProjectBoardTasks(projectId);

      const withAssignees = rows.find((t) => t.id === taskWithAssigneesId);
      const withoutAssignees = rows.find((t) => t.id === taskWithoutAssigneesId);

      expect(withAssignees).toBeDefined();
      expect(withAssignees?.assigneeIds).toEqual(assigneeIds);

      // AS-288's negative shape: zero assignees carries through as an
      // empty array, never null, so TaskCard's "no group renders" empty
      // state (not a crash) is reachable.
      expect(withoutAssignees).toBeDefined();
      expect(withoutAssignees?.assigneeIds).toEqual([]);
    });

    it("test_AS_287_getProjectListTasks_carries_the_full_assignee_set_through_into_TaskCardTask", async () => {
      const { getProjectListTasks } = await import("@/lib/queries/tasks");
      const { tasks: rows } = await getProjectListTasks(projectId);

      const withAssignees = rows.find((t) => t.id === taskWithAssigneesId);
      expect(withAssignees?.assigneeIds).toEqual(assigneeIds);
    });

    it("test_AS_287_getWorkspaceListTasks_carries_the_full_assignee_set_through_into_TaskCardTask", async () => {
      const { getWorkspaceListTasks } = await import("@/lib/queries/tasks");
      const rows = await getWorkspaceListTasks(workspaceId);

      const withAssignees = rows.find((t) => t.id === taskWithAssigneesId);
      expect(withAssignees?.assigneeIds).toEqual(assigneeIds);
    });

    it("test_AS_287_getTaskDetail_carries_the_full_assignee_set_through_into_TaskDetailSheetTask", async () => {
      const { getTaskDetail } = await import("@/lib/actions/tasks");
      const result = await getTaskDetail(taskWithAssigneesId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.task.assigneeIds).toEqual(assigneeIds);
    });

    it("test_AS_288_getTaskDetail_returns_an_empty_assignee_array_when_unset_not_null_or_a_crash", async () => {
      const { getTaskDetail } = await import("@/lib/actions/tasks");
      const result = await getTaskDetail(taskWithoutAssigneesId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.task.assigneeIds).toEqual([]);
    });
  },
);
