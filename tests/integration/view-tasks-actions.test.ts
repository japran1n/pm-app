// Integration test for the follow-up "manual view membership" feature:
// lib/actions/view-tasks.ts (addTaskToView, removeTaskFromView,
// reorderTaskInView, listViewTaskIds), backed by `public.view_tasks`
// (supabase/migrations/20260907010000_create_view_tasks.sql). Mirrors the
// currentTestClient-mock/signInAs/beforeAll-seed pattern established by
// tests/integration/f228-saved-view-actions.test.ts -- every case here
// drives the real Server Actions against the real linked Supabase
// project and asserts real DB state before/after.

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
import { seedLegacyStatusColumns } from "../helpers/legacy-status-columns";
import { poolUserId, getPoolSession } from "../helpers/auth";

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
    "view-tasks: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestClient: {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: SupabaseClient["from"];
} = {
  auth: { getUser: async () => ({ data: { user: null } }) },
  from: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["from"],
};

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentTestClient,
}));

describe.skipIf(!haveAdminCreds)(
  "view-tasks actions (manual view membership follow-up)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdProjectIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let taskAId: string;
    let taskBId: string;

    const OWNER = 0;
    let ownerUserId: string;
    const ADMIN = 1;
    let adminUserId: string;
    const MEMBER_A = 2; // owns the personal view under test
    let memberAUserId: string;
    const MEMBER_B = 3; // plain member, not owner, not admin
    let memberBUserId: string;

    let personalViewId: string;
    let sharedViewId: string;

    async function signInAs(slot: number) {
      currentTestClient = (await getPoolSession(slot)) as unknown as typeof currentTestClient;
    }

    function signOut() {
      currentTestClient = {
        auth: { getUser: async () => ({ data: { user: null } }) },
        from: (() => {
          throw new Error("no client signed in for this test");
        }) as unknown as SupabaseClient["from"],
      };
    }

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "ViewTasks Workspace", slug: `view-tasks-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      ownerUserId = await poolUserId(OWNER);
      adminUserId = await poolUserId(ADMIN);
      memberAUserId = await poolUserId(MEMBER_A);
      memberBUserId = await poolUserId(MEMBER_B);

      const { error: memberInsertErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: ownerUserId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: adminUserId, role: "admin", status: "active" },
        { workspace_id: workspaceId, user_id: memberAUserId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: memberBUserId, role: "member", status: "active" },
      ]);
      if (memberInsertErr) throw new Error(`Failed to seed members: ${memberInsertErr.message}`);

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `ViewTasks Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      projectId = proj.id;
      createdProjectIds.push(projectId);

      // status_set_v2: the fixtures below use the legacy "todo" name
      // literally, so seed the legacy columns (pattern A).
      await seedLegacyStatusColumns(adminClient, projectId);

      // tasks has author_id (not created_by).
      const { data: tasks, error: tasksErr } = await adminClient
        .from("tasks")
        .insert([
          { project_id: projectId, title: "Task A", status: "todo", author_id: ownerUserId },
          { project_id: projectId, title: "Task B", status: "todo", author_id: ownerUserId },
        ])
        .select("id");
      if (tasksErr || !tasks) throw new Error(`Failed to create tasks: ${tasksErr?.message}`);
      taskAId = tasks[0].id;
      taskBId = tasks[1].id;

      const { data: views, error: viewsErr } = await adminClient
        .from("saved_views")
        .insert([
          {
            workspace_id: workspaceId,
            project_id: projectId,
            owner_id: memberAUserId,
            name: "Member A personal view",
            scope: "personal",
            view_type: "list",
            config: { filters: [], sort: [], groupBy: null },
          },
          {
            workspace_id: workspaceId,
            project_id: projectId,
            owner_id: memberAUserId,
            name: "Shared view",
            scope: "shared",
            view_type: "list",
            config: { filters: [], sort: [], groupBy: null },
          },
        ])
        .select("id");
      if (viewsErr || !views) throw new Error(`Failed to create views: ${viewsErr?.message}`);
      personalViewId = views[0].id;
      sharedViewId = views[1].id;
    });

    beforeEach(() => {
      signOut();
    });

    afterAll(async () => {
      for (const pId of createdProjectIds) {
        await adminClient.from("view_tasks").delete().in(
          "view_id",
          (
            await adminClient.from("saved_views").select("id").eq("project_id", pId)
          ).data?.map((r: { id: string }) => r.id) ?? [],
        );
        await adminClient.from("saved_views").delete().eq("project_id", pId);
        await adminClient.from("tasks").delete().eq("project_id", pId);
        await adminClient.from("projects").delete().eq("id", pId);
      }
      for (const wsId of createdWorkspaceIds) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
    });

    it("test_owner_can_manually_add_a_task_to_their_own_view", async () => {
      const { addTaskToView } = await import("@/lib/actions/view-tasks");
      await signInAs(MEMBER_A);

      const result = await addTaskToView({ viewId: personalViewId, taskId: taskAId });
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("view_tasks")
        .select("view_id, task_id, added_by")
        .eq("view_id", personalViewId)
        .eq("task_id", taskAId)
        .maybeSingle();
      expect(row?.task_id).toBe(taskAId);
      expect(row?.added_by).toBe(memberAUserId);
    });

    it("test_adding_the_same_task_twice_is_an_idempotent_no_op_not_an_error", async () => {
      const { addTaskToView } = await import("@/lib/actions/view-tasks");
      await signInAs(MEMBER_A);

      const first = await addTaskToView({ viewId: personalViewId, taskId: taskBId });
      expect(first.ok).toBe(true);
      const second = await addTaskToView({ viewId: personalViewId, taskId: taskBId });
      expect(second.ok).toBe(true);

      const { data: rows } = await adminClient
        .from("view_tasks")
        .select("id")
        .eq("view_id", personalViewId)
        .eq("task_id", taskBId);
      expect(rows).toHaveLength(1);
    });

    it("test_a_non_owner_non_admin_member_cannot_add_a_task_to_someone_elses_personal_view", async () => {
      const { addTaskToView } = await import("@/lib/actions/view-tasks");
      await signInAs(MEMBER_B);

      const result = await addTaskToView({ viewId: personalViewId, taskId: taskAId });
      expect(result.ok).toBe(false);
    });

    it("test_an_admin_can_manage_membership_of_a_shared_view_they_do_not_own", async () => {
      const { addTaskToView, removeTaskFromView } = await import("@/lib/actions/view-tasks");
      await signInAs(ADMIN);

      const added = await addTaskToView({ viewId: sharedViewId, taskId: taskAId });
      expect(added.ok).toBe(true);

      const removed = await removeTaskFromView({ viewId: sharedViewId, taskId: taskAId });
      expect(removed.ok).toBe(true);

      const { data: row } = await adminClient
        .from("view_tasks")
        .select("id")
        .eq("view_id", sharedViewId)
        .eq("task_id", taskAId)
        .maybeSingle();
      expect(row).toBeNull();
    });

    it("test_owner_can_remove_a_manually_added_task", async () => {
      const { addTaskToView, removeTaskFromView } = await import("@/lib/actions/view-tasks");
      await signInAs(MEMBER_A);

      await addTaskToView({ viewId: personalViewId, taskId: taskAId });
      const removed = await removeTaskFromView({ viewId: personalViewId, taskId: taskAId });
      expect(removed.ok).toBe(true);

      const { data: row } = await adminClient
        .from("view_tasks")
        .select("id")
        .eq("view_id", personalViewId)
        .eq("task_id", taskAId)
        .maybeSingle();
      expect(row).toBeNull();
    });

    it("test_listViewTaskIds_returns_manually_pinned_tasks_in_position_order", async () => {
      const { addTaskToView, listViewTaskIds } = await import("@/lib/actions/view-tasks");
      await signInAs(MEMBER_A);

      await addTaskToView({ viewId: personalViewId, taskId: taskBId, position: 2 });
      await addTaskToView({ viewId: personalViewId, taskId: taskAId, position: 1 });

      const result = await listViewTaskIds(personalViewId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual([taskAId, taskBId]);
    });

    it("test_a_member_with_no_visibility_into_the_view_cannot_read_its_manual_membership", async () => {
      const { addTaskToView, listViewTaskIds } = await import("@/lib/actions/view-tasks");
      await signInAs(MEMBER_A);
      await addTaskToView({ viewId: personalViewId, taskId: taskAId });

      await signInAs(MEMBER_B);
      const result = await listViewTaskIds(personalViewId);
      // RLS scopes the read to zero rows rather than erroring -- a
      // personal view invisible to MEMBER_B simply has no visible
      // membership rows, matching saved_views' own "invisible, not
      // errored" convention (AS-434).
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual([]);
    });
  },
);
