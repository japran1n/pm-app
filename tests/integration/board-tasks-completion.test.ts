// Integration test for F154 (AS-272, AS-273), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf/signed-in-client
// pattern established by tests/integration/board-columns-render.test.ts
// (F042) and tests/integration/db-subtasks.test.ts (F148).
//
// Exercises the REAL `getProjectBoardTasks` (lib/queries/tasks.ts) end to
// end — checklist items and child tasks are actually inserted into the
// database, not mocked — to prove:
//   AS-272: a task's `completion` combines its checklist items and child
//     tasks, correctly, when read back through the real board query.
//   AS-273: a task with neither gets `completion: null`, never a
//     `{ percent: 0 }` result.
//
// Also proves the "no per-card round trip" contract from this feature's
// Draft scope: seeds several tasks and reads them back in ONE call to
// getProjectBoardTasks, then asserts every task's completion is correct —
// if the implementation regressed to a per-card fetch it would still pass
// this assertion (this test can't observe query *count* directly), but it
// does prove the single-query implementation actually threads the right
// counts to the right task, which is the behaviour that per-card-fetch
// code would also have to get right — so a regression to a slower
// implementation wouldn't be caught here, only a *correctness* regression
// would. The "single query" property itself is proven by code review of
// lib/queries/tasks.ts (one childRows query + one checklistRows query for
// the whole project, both outside the per-task .map()).

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

let memberClient: SupabaseClient | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => memberClient,
}));

describe.skipIf(!haveAdminCreds)(
  "getProjectBoardTasks completion (F154: AS-272, AS-273)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let projectId: string;
    let memberUserId: string;
    let bareTaskId: string;
    let checklistOnlyTaskId: string;
    let childrenOnlyTaskId: string;
    let mixedTaskId: string;
    const createdTaskIds: string[] = [];
    const createdChecklistItemIds: string[] = [];

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const memberEmail = `f154-completion-member-${uniqueSuffix}@example.com`;
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
          name: "F154 Completion Workspace",
          slug: `f154-completion-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      const { error: memberErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: memberUserId,
        role: "owner",
        status: "active",
      });
      if (memberErr) throw new Error(`Failed to seed membership: ${memberErr.message}`);

      const { data: project, error: projectErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F154 Completion Project" })
        .select("id")
        .single();
      if (projectErr || !project) {
        throw new Error(`Failed to seed project: ${projectErr?.message}`);
      }
      projectId = project.id;

      // 1) A bare task: no checklist items, no children — AS-273.
      const { data: bareTask, error: bareErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "Bare task",
          status: "todo",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (bareErr || !bareTask) throw new Error(`Failed to seed bare task: ${bareErr?.message}`);
      bareTaskId = bareTask.id;
      createdTaskIds.push(bareTaskId);

      // 2) A task with checklist items only: 1 of 3 checked -> 33%.
      const { data: checklistTask, error: checklistTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "Checklist-only task",
          status: "todo",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (checklistTaskErr || !checklistTask) {
        throw new Error(`Failed to seed checklist task: ${checklistTaskErr?.message}`);
      }
      checklistOnlyTaskId = checklistTask.id;
      createdTaskIds.push(checklistOnlyTaskId);

      const checklistRows = [
        { task_id: checklistOnlyTaskId, content: "Item 1", is_checked: true, position: 1000 },
        { task_id: checklistOnlyTaskId, content: "Item 2", is_checked: false, position: 2000 },
        { task_id: checklistOnlyTaskId, content: "Item 3", is_checked: false, position: 3000 },
      ];
      const { data: insertedItems, error: checklistItemsErr } = await adminClient
        .from("checklist_items")
        .insert(checklistRows)
        .select("id");
      if (checklistItemsErr) {
        throw new Error(`Failed to seed checklist items: ${checklistItemsErr.message}`);
      }
      for (const row of insertedItems ?? []) createdChecklistItemIds.push(row.id);

      // 3) A task with children only: 1 of 2 done -> 50%.
      const { data: parentTask, error: parentTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "Children-only task",
          status: "todo",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (parentTaskErr || !parentTask) {
        throw new Error(`Failed to seed parent task: ${parentTaskErr?.message}`);
      }
      childrenOnlyTaskId = parentTask.id;
      createdTaskIds.push(childrenOnlyTaskId);

      const { data: child1, error: child1Err } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "Child 1 (done)",
          status: "done",
          author_id: memberUserId,
          parent_task_id: childrenOnlyTaskId,
        })
        .select("id")
        .single();
      if (child1Err || !child1) throw new Error(`Failed to seed child 1: ${child1Err?.message}`);
      createdTaskIds.push(child1.id);

      const { data: child2, error: child2Err } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "Child 2 (todo)",
          status: "todo",
          author_id: memberUserId,
          parent_task_id: childrenOnlyTaskId,
        })
        .select("id")
        .single();
      if (child2Err || !child2) throw new Error(`Failed to seed child 2: ${child2Err?.message}`);
      createdTaskIds.push(child2.id);

      // 4) A task with BOTH checklist items and children, flat-counted
      // together: 1 of 2 checklist items checked + 1 of 2 children done
      // = 2 of 4 -> 50% (AS-272's "equal units" rule).
      const { data: mixedTask, error: mixedTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "Mixed task",
          status: "todo",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (mixedTaskErr || !mixedTask) {
        throw new Error(`Failed to seed mixed task: ${mixedTaskErr?.message}`);
      }
      mixedTaskId = mixedTask.id;
      createdTaskIds.push(mixedTaskId);

      const { data: mixedItems, error: mixedItemsErr } = await adminClient
        .from("checklist_items")
        .insert([
          { task_id: mixedTaskId, content: "Mixed item 1", is_checked: true, position: 1000 },
          { task_id: mixedTaskId, content: "Mixed item 2", is_checked: false, position: 2000 },
        ])
        .select("id");
      if (mixedItemsErr) {
        throw new Error(`Failed to seed mixed checklist items: ${mixedItemsErr.message}`);
      }
      for (const row of mixedItems ?? []) createdChecklistItemIds.push(row.id);

      const { data: mixedChild1, error: mixedChild1Err } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "Mixed child 1 (done)",
          status: "done",
          author_id: memberUserId,
          parent_task_id: mixedTaskId,
        })
        .select("id")
        .single();
      if (mixedChild1Err || !mixedChild1) {
        throw new Error(`Failed to seed mixed child 1: ${mixedChild1Err?.message}`);
      }
      createdTaskIds.push(mixedChild1.id);

      const { data: mixedChild2, error: mixedChild2Err } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "Mixed child 2 (todo)",
          status: "todo",
          author_id: memberUserId,
          parent_task_id: mixedTaskId,
        })
        .select("id")
        .single();
      if (mixedChild2Err || !mixedChild2) {
        throw new Error(`Failed to seed mixed child 2: ${mixedChild2Err?.message}`);
      }
      createdTaskIds.push(mixedChild2.id);

      memberClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await memberClient.auth.signInWithPassword({
        email: memberEmail,
        password: memberPassword,
      });
      if (signInErr) throw new Error(`Failed to sign in member: ${signInErr.message}`);
    });

    afterAll(async () => {
      if (createdChecklistItemIds.length > 0) {
        await adminClient.from("checklist_items").delete().in("id", createdChecklistItemIds);
      }
      // Children before parents (both are plain `tasks` rows, no FK
      // ON DELETE CASCADE relied on here) — same delete-order caution as
      // db-subtasks.test.ts's own afterAll.
      if (createdTaskIds.length > 0) {
        await adminClient.from("tasks").delete().in("id", createdTaskIds);
      }
      if (projectId) await adminClient.from("projects").delete().eq("id", projectId);
      if (workspaceId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
    });

    it("test_AS_273_a_task_with_no_checklist_items_and_no_children_has_null_completion", async () => {
      const { getProjectBoardTasks } = await import("@/lib/queries/tasks");
      const tasks = await getProjectBoardTasks(projectId);

      const bare = tasks.find((t) => t.id === bareTaskId);
      expect(bare).toBeDefined();
      expect(bare?.completion).toBeNull();
    });

    it("test_AS_272_derives_completion_from_checklist_items_alone", async () => {
      const { getProjectBoardTasks } = await import("@/lib/queries/tasks");
      const tasks = await getProjectBoardTasks(projectId);

      const task = tasks.find((t) => t.id === checklistOnlyTaskId);
      expect(task?.completion).toEqual({ done: 1, total: 3, percent: 33 });
    });

    it("test_AS_272_derives_completion_from_child_tasks_alone", async () => {
      const { getProjectBoardTasks } = await import("@/lib/queries/tasks");
      const tasks = await getProjectBoardTasks(projectId);

      const task = tasks.find((t) => t.id === childrenOnlyTaskId);
      expect(task?.completion).toEqual({ done: 1, total: 2, percent: 50 });
    });

    it("test_AS_272_combines_checklist_items_and_children_as_flat_equal_units", async () => {
      const { getProjectBoardTasks } = await import("@/lib/queries/tasks");
      const tasks = await getProjectBoardTasks(projectId);

      const task = tasks.find((t) => t.id === mixedTaskId);
      expect(task?.completion).toEqual({ done: 2, total: 4, percent: 50 });
    });

    it("side effect: reading one task's completion never leaks another task's checklist items or children into it", async () => {
      const { getProjectBoardTasks } = await import("@/lib/queries/tasks");
      const tasks = await getProjectBoardTasks(projectId);

      // Every task's completion total is exactly what that task alone
      // was seeded with — never accumulated across tasks, which would be
      // the failure mode of a grouping bug in the batched maps.
      expect(tasks.find((t) => t.id === bareTaskId)?.completion).toBeNull();
      expect(tasks.find((t) => t.id === checklistOnlyTaskId)?.completion?.total).toBe(3);
      expect(tasks.find((t) => t.id === childrenOnlyTaskId)?.completion?.total).toBe(2);
      expect(tasks.find((t) => t.id === mixedTaskId)?.completion?.total).toBe(4);
    });
  },
);
