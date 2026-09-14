// F306 (D9/FU-3 scrutiny fix, AS-294, AS-353, AS-355, AS-380, AS-382): real-
// Supabase integration coverage proving `moveAndReorderTask` (board drag),
// `bulkUpdateTasks`, `createTask`-with-assignee, `duplicateTask`, and
// `restoreTask` each actually write real `task_activity` and/or
// `notifications` rows, closing the "untested paths, enumerated" gap
// (D9) M15-scrutiny.md flagged — these five paths previously mutated
// status/assignee with zero activity entry and zero watcher/assignee
// notification.
//
// Pattern mirrors tests/integration/notification-fanout.test.ts (F207) and
// tests/integration/task-activity-writer.test.ts (F195): `@/lib/supabase/
// server`'s createClient() is mocked to resolve to a REAL, signed-in
// session client per acting user, so the caller's actual auth.uid() flows
// into write_task_activity_entry/create_notification's SECURITY DEFINER
// pinning — a fake getUser()-only object would not carry a real PostgREST
// session for these RPC calls to run through.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F306: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

// Populated with a real signed-in SupabaseClient per test — mirrors
// notification-fanout.test.ts's `sessionClientForMock` module-level slot.
let sessionClientForMock: SupabaseClient | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => sessionClientForMock,
}));

describe.skipIf(!haveAdminCreds)(
  "F306: activity + notification fan-out for the untested mutation paths (AS-294, AS-353, AS-355, AS-380, AS-382)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let projectId: string;
    let actorUserId: string;
    let actorClient: SupabaseClient;
    let watcherUserId: string;
    let assigneeUserId: string;
    const createdUserIds: string[] = [];
    const createdTaskIds: string[] = [];

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F306 fanout workspace",
          slug: `f306-fanout-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;

      const { data: project, error: projectErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F306 project",
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projectErr || !project) {
        throw new Error(`Failed to create project: ${projectErr?.message}`);
      }
      projectId = project.id;
    // status_set_v2 renamed the default columns, but this suite's
    // assertions use the legacy four names as literal column/status
    // values. Seed them as this project's own (PM-named) columns so the
    // exact-name path is exercised end to end, independent of the v2
    // default seed.
    {
      const { error: legacyColErr } = await adminClient
        .from("project_statuses")
        .upsert(
          [
            { project_id: projectId, name: "todo", color: "#64748b", category: "not_started", position: 100 },
            { project_id: projectId, name: "in_progress", color: "#3b82f6", category: "in_progress", position: 200 },
            { project_id: projectId, name: "in_review", color: "#8b5cf6", category: "in_progress", position: 300 },
            { project_id: projectId, name: "done", color: "#16a34a", category: "done", position: 400 },
          ],
          { onConflict: "project_id,name" },
        );
      if (legacyColErr) throw new Error(`legacy columns: ${legacyColErr.message}`);
    }


      async function createActiveMember(label: string) {
        const email = `f306-${label}-${uniqueSuffix}@example.com`;
        const password = "Test-password-1!";
        const { data: auth, error: authErr } =
          await adminClient.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
          });
        if (authErr || !auth.user) {
          throw new Error(`Failed to create ${label}: ${authErr?.message}`);
        }
        createdUserIds.push(auth.user.id);
        const { error: memberErr } = await adminClient
          .from("workspace_members")
          .insert({
            workspace_id: workspaceId,
            user_id: auth.user.id,
            role: "member",
            status: "active",
          });
        if (memberErr) {
          throw new Error(
            `Failed to seed ${label} membership: ${memberErr.message}`,
          );
        }
        const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
        const { error: signInErr } = await client.auth.signInWithPassword({
          email,
          password,
        });
        if (signInErr) {
          throw new Error(`Failed to sign in ${label}: ${signInErr.message}`);
        }
        return { userId: auth.user.id, client };
      }

      const actor = await createActiveMember("actor");
      actorUserId = actor.userId;
      actorClient = actor.client;

      const watcher = await createActiveMember("watcher");
      watcherUserId = watcher.userId;

      const assignee = await createActiveMember("assignee");
      assigneeUserId = assignee.userId;
    });

    afterAll(async () => {
      if (createdTaskIds.length > 0) {
        await adminClient
          .from("task_activity")
          .delete()
          .in("task_id", createdTaskIds);
        await adminClient.from("tasks").delete().in("id", createdTaskIds);
      }
      if (workspaceId) {
        await adminClient
          .from("notifications")
          .delete()
          .eq("workspace_id", workspaceId);
        await adminClient
          .from("workspace_members")
          .delete()
          .eq("workspace_id", workspaceId);
        await adminClient.from("projects").delete().eq("id", projectId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      for (const id of createdUserIds) {
        await adminClient.auth.admin.deleteUser(id).catch(() => {});
      }
    });

    async function makeTask(opts: {
      status?: string;
      assigneeId?: string | null;
      position?: number;
    }) {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F306 task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: actorUserId,
          status: opts.status ?? "todo",
          position: opts.position ?? 1000,
          assignee_id: opts.assigneeId ?? null,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id as string;
    }

    it("test_AS_353_AS_355_moveAndReorderTask_board_drag_writes_a_status_activity_entry", async () => {
      const taskId = await makeTask({ status: "todo" });
      sessionClientForMock = actorClient;

      const { moveAndReorderTask } = await import("@/lib/actions/tasks");
      const result = await moveAndReorderTask(taskId, "in_progress", 500);
      expect(result.ok).toBe(true);

      const { data: entries } = await adminClient
        .from("task_activity")
        .select("*")
        .eq("task_id", taskId)
        .eq("kind", "field_changed")
        .eq("field", "status");

      expect(entries).not.toBeNull();
      expect(entries!.length).toBe(1);
      expect(entries![0].old_value).toBe("todo");
      expect(entries![0].new_value).toBe("in_progress");
      expect(entries![0].actor_id).toBe(actorUserId);
    });

    it("test_AS_294_AS_382_moveAndReorderTask_board_drag_notifies_the_tasks_watchers", async () => {
      const taskId = await makeTask({ status: "todo" });
      const { error: watchErr } = await adminClient
        .from("task_watchers")
        .insert({ task_id: taskId, user_id: watcherUserId, is_watching: true });
      if (watchErr) throw new Error(`Failed to seed watcher: ${watchErr.message}`);

      sessionClientForMock = actorClient;
      const { moveAndReorderTask } = await import("@/lib/actions/tasks");
      const result = await moveAndReorderTask(taskId, "in_review", 500);
      expect(result.ok).toBe(true);

      const { data: notifs } = await adminClient
        .from("notifications")
        .select("*")
        .eq("task_id", taskId)
        .eq("user_id", watcherUserId)
        .eq("kind", "watcher_update");

      expect(notifs).not.toBeNull();
      expect(notifs!.length).toBe(1);
      expect(notifs![0].actor_id).toBe(actorUserId);
    });

    it("test_AS_353_AS_355_moveAndReorderTask_pure_reorder_within_the_same_column_writes_no_status_entry", async () => {
      const taskId = await makeTask({ status: "todo", position: 1000 });
      sessionClientForMock = actorClient;

      const { moveAndReorderTask } = await import("@/lib/actions/tasks");
      const result = await moveAndReorderTask(taskId, "todo", 250);
      expect(result.ok).toBe(true);

      const { data: entries } = await adminClient
        .from("task_activity")
        .select("*")
        .eq("task_id", taskId)
        .eq("kind", "field_changed")
        .eq("field", "status");

      expect(entries).not.toBeNull();
      expect(entries!.length).toBe(0);
    });

    it("test_AS_353_AS_355_AS_380_bulkUpdateTasks_writes_activity_and_notifies_the_new_assignee", async () => {
      const taskA = await makeTask({ status: "todo" });
      const taskB = await makeTask({ status: "todo" });
      sessionClientForMock = actorClient;

      const { bulkUpdateTasks } = await import("@/lib/actions/tasks");
      const result = await bulkUpdateTasks([taskA, taskB], {
        status: "done",
        assigneeId: assigneeUserId,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.succeededIds.sort()).toEqual(
        [taskA, taskB].sort(),
      );

      for (const taskId of [taskA, taskB]) {
        const { data: statusEntries } = await adminClient
          .from("task_activity")
          .select("*")
          .eq("task_id", taskId)
          .eq("kind", "field_changed")
          .eq("field", "status");
        expect(statusEntries).not.toBeNull();
        expect(statusEntries!.length).toBe(1);
        expect(statusEntries![0].old_value).toBe("todo");
        expect(statusEntries![0].new_value).toBe("done");

        const { data: assigneeEntries } = await adminClient
          .from("task_activity")
          .select("*")
          .eq("task_id", taskId)
          .eq("kind", "field_changed")
          .eq("field", "assignee_id");
        expect(assigneeEntries).not.toBeNull();
        expect(assigneeEntries!.length).toBe(1);
        expect(assigneeEntries![0].new_value).toBe(assigneeUserId);

        const { data: assignedNotifs } = await adminClient
          .from("notifications")
          .select("*")
          .eq("task_id", taskId)
          .eq("user_id", assigneeUserId)
          .eq("kind", "task_assigned");
        expect(assignedNotifs).not.toBeNull();
        expect(assignedNotifs!.length).toBe(1);
      }
    });

    it("test_AS_380_createTask_with_an_initial_assignee_notifies_that_assignee", async () => {
      sessionClientForMock = actorClient;
      const { createTask } = await import("@/lib/actions/tasks");

      const result = await createTask(
        projectId,
        "F306 created-with-assignee task",
        null,
        "todo",
        null,
        assigneeUserId,
        null,
        null,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdTaskIds.push(result.data.id);

      const { data: assignedNotifs } = await adminClient
        .from("notifications")
        .select("*")
        .eq("task_id", result.data.id)
        .eq("user_id", assigneeUserId)
        .eq("kind", "task_assigned");

      expect(assignedNotifs).not.toBeNull();
      expect(assignedNotifs!.length).toBe(1);
      expect(assignedNotifs![0].actor_id).toBe(actorUserId);
    });

    it("test_AS_380_duplicateTask_notifies_the_carried_over_assignee_on_the_new_task", async () => {
      const sourceTaskId = await makeTask({
        status: "todo",
        assigneeId: null,
      });
      const { error: assigneeInsertErr } = await adminClient
        .from("task_assignees")
        .insert({
          task_id: sourceTaskId,
          user_id: assigneeUserId,
          assigned_by: actorUserId,
        });
      if (assigneeInsertErr) {
        throw new Error(
          `Failed to seed source assignee: ${assigneeInsertErr.message}`,
        );
      }

      sessionClientForMock = actorClient;
      const { duplicateTask } = await import("@/lib/actions/tasks");
      const result = await duplicateTask(sourceTaskId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdTaskIds.push(result.data.id);

      const { data: assignedNotifs } = await adminClient
        .from("notifications")
        .select("*")
        .eq("task_id", result.data.id)
        .eq("user_id", assigneeUserId)
        .eq("kind", "task_assigned");

      expect(assignedNotifs).not.toBeNull();
      expect(assignedNotifs!.length).toBe(1);
      expect(assignedNotifs![0].actor_id).toBe(actorUserId);
    });

    it("test_AS_353_AS_355_restoreTask_writes_an_activity_entry_for_the_restore", async () => {
      const taskId = await makeTask({ status: "in_progress" });
      const { error: softDeleteErr } = await adminClient
        .from("tasks")
        .update({ deleted_at: new Date().toISOString(), deleted_by: actorUserId })
        .eq("id", taskId);
      if (softDeleteErr) {
        throw new Error(`Failed to soft-delete task: ${softDeleteErr.message}`);
      }

      sessionClientForMock = actorClient;
      const { restoreTask } = await import("@/lib/actions/tasks");
      const result = await restoreTask(taskId);
      expect(result.ok).toBe(true);

      const { data: entries } = await adminClient
        .from("task_activity")
        .select("*")
        .eq("task_id", taskId)
        .eq("kind", "field_changed")
        .eq("field", "status");

      expect(entries).not.toBeNull();
      expect(entries!.length).toBe(1);
      expect(entries![0].old_value).toBeNull();
      expect(entries![0].new_value).toBe("in_progress");
      expect(entries![0].actor_id).toBe(actorUserId);
    });

    it("test_AS_353_AS_355_setTaskAssigneesCore_records_a_non_first_assignee_added_to_an_already_multi_assignee_task", async () => {
      const taskId = await makeTask({ status: "todo" });
      // Seed a first assignee directly (so the mirror `assignee_id`
      // column is already set and does NOT change when a second,
      // non-mirror assignee is added below — this is exactly the
      // scrutiny report's finding: the old implementation only diffed
      // the mirror column, so this second add wrote NO activity entry
      // at all).
      const { error: firstAssigneeErr } = await adminClient
        .from("task_assignees")
        .insert({
          task_id: taskId,
          user_id: watcherUserId,
          assigned_by: actorUserId,
        });
      if (firstAssigneeErr) {
        throw new Error(
          `Failed to seed first assignee: ${firstAssigneeErr.message}`,
        );
      }
      await adminClient
        .from("tasks")
        .update({ assignee_id: watcherUserId })
        .eq("id", taskId);

      sessionClientForMock = actorClient;
      const { setTaskAssignees } = await import("@/lib/actions/tasks");
      const result = await setTaskAssignees(taskId, [
        watcherUserId,
        assigneeUserId,
      ]);
      expect(result.ok).toBe(true);

      const { data: allEntries } = await adminClient
        .from("task_activity")
        .select("*")
        .eq("task_id", taskId)
        .eq("kind", "field_changed")
        .eq("field", "assignee_id");

      expect(allEntries).not.toBeNull();
      const entries = (allEntries ?? []).filter(
        (row) => row.new_value === assigneeUserId,
      );
      expect(entries.length).toBe(1);
      expect(entries[0].old_value).toBeNull();
    });
  },
);
