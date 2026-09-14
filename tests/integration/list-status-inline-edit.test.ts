// Integration test for F057 (AS-093), run against the real linked Supabase
// project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/move-task-status.test.ts and
// tests/integration/list-view-render.test.ts.
//
// F057's <ListStatusSelect> (components/task/list-status-select.tsx) is a
// thin Client Component whose onChange handler calls `moveTaskStatus`
// (lib/actions/tasks.ts, F045) directly — the same Server Action the
// board's drag-and-drop already uses. This test exercises that same call
// path (rather than re-testing `moveTaskStatus` itself, already covered by
// tests/integration/move-task-status.test.ts for AS-069) and asserts:
//
//   AS-093a: after calling moveTaskStatus (as the list view's dropdown
//     does), `getProjectListTasks` (the List view's data layer) returns
//     the task with the new status — i.e. the list "re-renders" with the
//     new status on next read, with no other row/task mutated.
//   AS-093b: `getProjectBoardTasks` (the Board view's data layer, reading
//     the same underlying `tasks` table) also reflects the new status —
//     proving the change is visible on the board view without any
//     board-specific code path, since both views read the same rows.
//   AS-093 (failure case): an invalid status value is rejected and the
//     task's stored status is left unchanged.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { seedLegacyStatusColumns } from "../helpers/legacy-status-columns";

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
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

// Unlike tests/integration/move-task-status.test.ts (which only exercises
// `moveTaskStatus` itself and can get away with a bare
// `auth.getUser()` stub), this test also calls `getProjectListTasks` and
// `getProjectBoardTasks`, which run real RLS-scoped `.from(...)` queries
// against `createClient()`'s return value. So this mock instead follows
// tests/integration/list-view-render.test.ts's pattern: a real,
// password-signed-in Supabase client stands in for the Next.js
// request-scoped server client, so both the Server Action's
// `auth.getUser()` call and the queries' `.from(...)` calls work against
// a real client.
let memberClient: SupabaseClient | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => memberClient,
}));

describe.skipIf(!haveAdminCreds)("List view status dropdown (F057: AS-093)", () => {
  let adminClient: SupabaseClient;
  const createdTaskIds: string[] = [];
  let workspaceId: string;
  let projectId: string;
  let memberUserId: string;
  let taskId: string;
  let otherTaskId: string;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const memberEmail = `f057-member-${uniqueSuffix}@example.com`;
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

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F057 List Workspace", slug: `f057-list-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
    workspaceId = ws.id;

    const { error: memberErr } = await adminClient
      .from("workspace_members")
      .insert({
        workspace_id: workspaceId,
        user_id: memberUserId,
        role: "member",
        status: "active",
      });
    if (memberErr) throw new Error(`Failed to seed membership: ${memberErr.message}`);

    const { data: project, error: projectErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "F057 List Project" })
      .select("id")
      .single();
    if (projectErr || !project) {
      throw new Error(`Failed to seed project: ${projectErr?.message}`);
    }
    projectId = project.id;

    // status_set_v2: this suite uses the legacy status names literally,
    // so seed them as project-owned columns (pattern A).
    await seedLegacyStatusColumns(adminClient, projectId);

    const { data: task, error: taskErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "List dropdown status task",
        status: "todo",
        author_id: memberUserId,
      })
      .select("id")
      .single();
    if (taskErr || !task) throw new Error(`Failed to seed task: ${taskErr?.message}`);
    taskId = task.id;
    createdTaskIds.push(taskId);

    // A second, untouched task — proves the status change is scoped to
    // the one row the dropdown was changed on, not the whole project.
    const { data: otherTask, error: otherTaskErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "Untouched sibling task",
        status: "todo",
        author_id: memberUserId,
      })
      .select("id")
      .single();
    if (otherTaskErr || !otherTask) {
      throw new Error(`Failed to seed sibling task: ${otherTaskErr?.message}`);
    }
    otherTaskId = otherTask.id;
    createdTaskIds.push(otherTaskId);

    memberClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
    const { error: signInErr } = await memberClient.auth.signInWithPassword({
      email: memberEmail,
      password: "Test-password-1!",
    });
    if (signInErr) throw new Error(`Failed to sign in member: ${signInErr.message}`);
  });

  afterAll(async () => {
    for (const id of createdTaskIds) {
      await adminClient.from("tasks").delete().eq("id", id);
    }
    if (projectId) await adminClient.from("projects").delete().eq("id", projectId);
    if (workspaceId) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspaces").delete().eq("id", workspaceId);
    }
    if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
  });

  it("AS-093: changing status via moveTaskStatus (the list dropdown's action call) persists and both the list and board queries reflect it", async () => {
    const { moveTaskStatus } = await import("@/lib/actions/tasks");
    const { getProjectListTasks, getProjectBoardTasks } = await import(
      "@/lib/queries/tasks"
    );

    const beforeList = await getProjectListTasks(projectId);
    expect(beforeList.find((t) => t.id === taskId)?.status).toBe("todo");

    const result = await moveTaskStatus(taskId, "in_review");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("in_review");

    // AS-093a: the list view's own data layer reflects the new status
    // without a full page reload being involved in this assertion — a
    // fresh read after the action call is exactly what the client
    // component's own optimistic-update-then-reconcile flow depends on.
    const afterList = await getProjectListTasks(projectId);
    const changedListRow = afterList.find((t) => t.id === taskId);
    expect(changedListRow?.status).toBe("in_review");

    // The sibling task is untouched.
    const siblingListRow = afterList.find((t) => t.id === otherTaskId);
    expect(siblingListRow?.status).toBe("todo");

    // AS-093b: the board view's data layer, reading the same `tasks`
    // table, reflects the same change — confirming the list-view edit is
    // visible on the board without any board-specific write path.
    const boardTasks = await getProjectBoardTasks(projectId);
    const boardTask = boardTasks.find((t) => t.id === taskId);
    expect(boardTask?.status).toBe("in_review");
  });

  it("AS-093 (failure case): an invalid status value is rejected and the task's stored status is unchanged", async () => {
    const { moveTaskStatus } = await import("@/lib/actions/tasks");
    const { getProjectListTasks } = await import("@/lib/queries/tasks");

    // F221: `status` is no longer a fixed-enum Zod type (moveTaskStatusSchema
    // now accepts any string, verified against the project's real
    // project_statuses at the action layer), so this is a plain invalid
    // call, not a type error.
    const result = await moveTaskStatus(otherTaskId, "not_a_real_status");
    expect(result.ok).toBe(false);

    const rows = await getProjectListTasks(projectId);
    expect(rows.find((t) => t.id === otherTaskId)?.status).toBe("todo");
  });
});
