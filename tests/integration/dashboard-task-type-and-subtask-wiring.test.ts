// Portal-parity fix: the workspace Dashboard's task table (Type column,
// item 3 of the "4 povezana poboljšanja" mission task) rendered an always-
// empty Type column because getWorkspaceListTasks (lib/queries/tasks.ts)
// never selected task_type_id/task_types, and never selected
// parent_task_id either (needed for <TaskListTable>'s inline subtask
// nesting, item 1). Mirrors the loadDotEnv/vi.mock("@/lib/supabase/
// server")/skipIf pattern from tests/integration/
// estimate-minutes-query-wiring.test.ts (the closest existing precedent
// for "prove an existing column is actually carried through an existing
// query to the exact prop shape a component expects").

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
    "Missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let memberClient: SupabaseClient | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => memberClient,
}));

describe.skipIf(!haveAdminCreds)(
  "Dashboard task table wiring — task_type and parent_task_id round-trip through getWorkspaceListTasks",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let projectId: string;
    let taskTypeId: string;
    let parentTaskId: string;
    let childTaskId: string;
    let taskWithTypeId: string;
    let memberUserId: string;
    const createdTaskIds: string[] = [];

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const memberEmail = `dashboard-type-subtask-wiring-${uniqueSuffix}@example.com`;
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
          name: "Dashboard Type/Subtask Wiring Workspace",
          slug: `dashboard-type-subtask-wiring-${uniqueSuffix}`,
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
        .insert({ workspace_id: workspaceId, name: "Dashboard Type/Subtask Wiring Project" })
        .select("id")
        .single();
      if (projectErr || !project) {
        throw new Error(`Failed to seed project: ${projectErr?.message}`);
      }
      projectId = project.id;

      const { data: taskType, error: taskTypeErr } = await adminClient
        .from("task_types")
        .insert({ workspace_id: workspaceId, name: "QA", color: "#f97316", position: 1000 })
        .select("id")
        .single();
      if (taskTypeErr || !taskType) {
        throw new Error(`Failed to seed task type: ${taskTypeErr?.message}`);
      }
      taskTypeId = taskType.id;

      const { data: taskWithType, error: taskWithTypeErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "Task with a real type",
          author_id: memberUserId,
          task_type_id: taskTypeId,
        })
        .select("id")
        .single();
      if (taskWithTypeErr || !taskWithType) {
        throw new Error(`Failed to seed task with type: ${taskWithTypeErr?.message}`);
      }
      taskWithTypeId = taskWithType.id;
      createdTaskIds.push(taskWithTypeId);

      const { data: parentTask, error: parentTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "Parent task",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (parentTaskErr || !parentTask) {
        throw new Error(`Failed to seed parent task: ${parentTaskErr?.message}`);
      }
      parentTaskId = parentTask.id;
      createdTaskIds.push(parentTaskId);

      const { data: childTask, error: childTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "Child task",
          author_id: memberUserId,
          parent_task_id: parentTaskId,
        })
        .select("id")
        .single();
      if (childTaskErr || !childTask) {
        throw new Error(`Failed to seed child task: ${childTaskErr?.message}`);
      }
      childTaskId = childTask.id;
      createdTaskIds.push(childTaskId);

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
      if (taskTypeId) {
        await adminClient.from("task_types").delete().eq("id", taskTypeId);
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

    it("test_AS_dashboard_type_column_getWorkspaceListTasks_carries_taskType_through_into_TaskCardTask", async () => {
      const { getWorkspaceListTasks } = await import("@/lib/queries/tasks");
      const rows = await getWorkspaceListTasks(workspaceId);

      const withType = rows.find((t) => t.id === taskWithTypeId);
      expect(withType).toBeDefined();
      expect(withType?.taskType?.id).toBe(taskTypeId);
      expect(withType?.taskType?.name).toBe("QA");
      expect(withType?.taskType?.color).toBe("#f97316");
    });

    it("test_AS_dashboard_type_column_getWorkspaceListTasks_returns_null_taskType_when_unset", async () => {
      const { getWorkspaceListTasks } = await import("@/lib/queries/tasks");
      const rows = await getWorkspaceListTasks(workspaceId);

      const parent = rows.find((t) => t.id === parentTaskId);
      expect(parent).toBeDefined();
      expect(parent?.taskType ?? null).toBe(null);
    });

    it("test_AS_dashboard_subtask_nesting_getWorkspaceListTasks_carries_parentTaskId_through_into_TaskCardTask", async () => {
      const { getWorkspaceListTasks } = await import("@/lib/queries/tasks");
      const rows = await getWorkspaceListTasks(workspaceId);

      const child = rows.find((t) => t.id === childTaskId);
      expect(child).toBeDefined();
      expect(child?.parentTaskId).toBe(parentTaskId);

      const parent = rows.find((t) => t.id === parentTaskId);
      expect(parent).toBeDefined();
      expect(parent?.parentTaskId ?? null).toBe(null);
    });
  },
);
