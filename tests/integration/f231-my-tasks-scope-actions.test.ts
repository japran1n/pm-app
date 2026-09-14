// Integration test for F231 My Tasks scope + actions (AS-437, AS-438,
// AS-440, AS-441), run against the real linked Supabase project --
// mirrors the loadDotEnv/real-signed-in-client/beforeAll-seed/afterAll-
// teardown pattern established by tests/integration/f230-my-tasks-query.test.ts
// and tests/integration/f322-single-task-project-visibility.test.ts.
//
// Drives the REAL paths this feature added: `getMyTasks(..., includeWatched)`
// (lib/queries/my-tasks.ts, unchanged assigned-only query path plus the new
// watched-tasks merge) and the REAL `moveTaskStatus` Server Action
// (lib/actions/tasks.ts) -- the exact action <MyTaskStatusCell>/
// <ListStatusSelect> calls from the My Tasks page -- never a raw admin
// query standing in for either.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
    "F231: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestClient: {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: SupabaseClient["from"];
  rpc: SupabaseClient["rpc"];
} = {
  auth: { getUser: async () => ({ data: { user: null } }) },
  from: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["from"],
  rpc: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["rpc"],
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentTestClient,
}));

describe.skipIf(!haveAdminCreds)(
  "F231 My Tasks scope + actions (AS-437, AS-438, AS-440, AS-441)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];
    const createdProjectIds: string[] = [];

    let workspaceId: string;
    let projectAId: string; // renamed done column ("Shipped")
    let projectBId: string; // renamed in-progress column ("Cooking")
    let archivedProjectId: string;

    let memberEmail: string;
    const memberPassword = "Test-password-1!";
    let memberUserId: string;

    let viewerEmail: string;
    let viewerUserId: string;

    let privateProjectId: string;

    async function signInAs(email: string, password: string) {
      const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        throw new Error(`Failed to sign in ${email}: ${error.message}`);
      }
      currentTestClient = client as unknown as typeof currentTestClient;
    }

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F231 Workspace", slug: `f231-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to seed workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      memberEmail = `f231-member-${uniqueSuffix}@example.com`;
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create member: ${memberAuthErr?.message}`);
      }
      memberUserId = memberAuth.user.id;
      createdUserIds.push(memberUserId);

      viewerEmail = `f231-viewer-${uniqueSuffix}@example.com`;
      const { data: viewerAuth, error: viewerAuthErr } =
        await adminClient.auth.admin.createUser({
          email: viewerEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (viewerAuthErr || !viewerAuth.user) {
        throw new Error(`Failed to create viewer: ${viewerAuthErr?.message}`);
      }
      viewerUserId = viewerAuth.user.id;
      createdUserIds.push(viewerUserId);

      const { error: memberRowErr } = await adminClient
        .from("workspace_members")
        .insert([
          { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
          { workspace_id: workspaceId, user_id: viewerUserId, role: "viewer", status: "active" },
        ]);
      if (memberRowErr) {
        throw new Error(`Failed to seed membership: ${memberRowErr.message}`);
      }

      // Project A: workspace-visible, done column renamed to "Shipped".
      const { data: projectA, error: projectAErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F231 Project A", visibility: "workspace" })
        .select("id")
        .single();
      if (projectAErr || !projectA) throw new Error(`Failed to seed project A: ${projectAErr?.message}`);
      projectAId = projectA.id;
      createdProjectIds.push(projectAId);

      // Project B: workspace-visible, in-progress column renamed to
      // "Cooking" -- deliberately different names than project A's
      // columns, so a status resolved against the wrong project's columns
      // would fail this test's assertions.
      const { data: projectB, error: projectBErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F231 Project B", visibility: "workspace" })
        .select("id")
        .single();
      if (projectBErr || !projectB) throw new Error(`Failed to seed project B: ${projectBErr?.message}`);
      projectBId = projectB.id;
      createdProjectIds.push(projectBId);

      // Archived project (AS-437 regression).
      const { data: archivedProject, error: archivedErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F231 Archived Project", visibility: "workspace" })
        .select("id")
        .single();
      if (archivedErr || !archivedProject) throw new Error(`Failed to seed archived project: ${archivedErr?.message}`);
      archivedProjectId = archivedProject.id;
      createdProjectIds.push(archivedProject.id);

      // Private project the member is NOT part of -- watched task here
      // must never leak in (AS-441 negative / F322 bug class).
      const { data: privateProject, error: privateErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F231 Private Project", visibility: "private" })
        .select("id")
        .single();
      if (privateErr || !privateProject) throw new Error(`Failed to seed private project: ${privateErr?.message}`);
      privateProjectId = privateProject.id;
      createdProjectIds.push(privateProjectId);
      // Someone else must be a member so it's a "real" private project.
      await adminClient
        .from("project_members")
        .insert({ project_id: privateProjectId, user_id: viewerUserId });

      // status_set_v2: this suite uses legacy names ("todo",
      // "in_progress") literally, so seed the legacy four on each
      // project (pattern A).
      await seedLegacyStatusColumns(adminClient, projectAId);
      await seedLegacyStatusColumns(adminClient, projectBId);
      await seedLegacyStatusColumns(adminClient, archivedProjectId);
      await seedLegacyStatusColumns(adminClient, privateProjectId);

      // Rename project A's done column (first by position — v2 also
      // seeds done-category columns).
      const { data: doneColA, error: doneColAErr } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", projectAId)
        .eq("category", "done")
        .order("position", { ascending: true })
        .limit(1)
        .single();
      if (doneColAErr || !doneColA) throw new Error(`Failed to find project A done column: ${doneColAErr?.message}`);
      await adminClient.from("project_statuses").update({ name: "Shipped" }).eq("id", doneColA.id);

      // Rename project B's "in_progress" (default-name) column.
      const { data: inProgColB, error: inProgColBErr } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", projectBId)
        .eq("name", "in_progress")
        .single();
      if (inProgColBErr || !inProgColB) throw new Error(`Failed to find project B in-progress column: ${inProgColBErr?.message}`);
      await adminClient.from("project_statuses").update({ name: "Cooking" }).eq("id", inProgColB.id);

      await signInAs(memberEmail, memberPassword);
    });

    afterAll(async () => {
      for (const id of createdProjectIds) {
        await adminClient.from("tasks").delete().eq("project_id", id);
        await adminClient.from("project_statuses").delete().eq("project_id", id);
        await adminClient.from("project_members").delete().eq("project_id", id);
        await adminClient.from("projects").delete().eq("id", id);
      }
      for (const id of createdWorkspaceIds) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", id);
        await adminClient.from("workspaces").delete().eq("id", id);
      }
      for (const id of createdUserIds) {
        await adminClient.auth.admin.deleteUser(id);
      }
    });

    it("test_AS_440_an_active_member_with_no_assignments_or_watches_sees_the_real_zero_row_path", async () => {
      const { getMyTasks } = await import("@/lib/queries/my-tasks");
      // memberUserId has no assignments/watches yet at this point in the
      // suite (seeded per-test below) -- prove the exact zero-row shape
      // the page's `totalCount === 0` branch (AS-440's empty state) reads.
      const buckets = await getMyTasks(workspaceId, memberUserId, "UTC", false);
      const total =
        buckets.overdue.length + buckets.today.length + buckets.thisWeek.length + buckets.later.length;
      expect(total).toBe(0);
    });

    it("test_AS_438_a_status_change_from_my_tasks_resolves_against_the_tasks_own_project_columns", async () => {
      const { moveTaskStatus } = await import("@/lib/actions/tasks");

      const { data: taskA } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectAId,
          title: "F231 task in project A",
          status: "todo",
          priority: "medium",
          author_id: memberUserId,
          number: 101,
        })
        .select("id")
        .single();
      const taskAId = taskA!.id;
      await adminClient.from("task_assignees").insert({ task_id: taskAId, user_id: memberUserId });

      // "Shipped" is a real column on project A -- must succeed and
      // resolve to project A's own done-category column, never project
      // B's differently-named columns.
      const result = await moveTaskStatus(taskAId, "Shipped");
      expect(result.ok).toBe(true);

      const { data: after } = await adminClient
        .from("tasks")
        .select("status, status_id")
        .eq("id", taskAId)
        .single();
      expect(after!.status).toBe("Shipped");

      const { data: statusRow } = await adminClient
        .from("project_statuses")
        .select("category, project_id")
        .eq("id", after!.status_id)
        .single();
      expect(statusRow!.project_id).toBe(projectAId);
      expect(statusRow!.category).toBe("done");

      // "Cooking" only exists on project B -- attempting it against a
      // project-A task must be rejected (the target column is resolved
      // against the TASK'S OWN project, never a fixed list or another
      // project's columns) and must leave DB state unchanged.
      const crossProjectResult = await moveTaskStatus(taskAId, "Cooking");
      expect(crossProjectResult.ok).toBe(false);

      const { data: unchanged } = await adminClient
        .from("tasks")
        .select("status")
        .eq("id", taskAId)
        .single();
      expect(unchanged!.status).toBe("Shipped");
    });

    it("test_AS_438_negative_a_viewer_without_write_permission_is_rejected_and_db_state_is_unchanged", async () => {
      const { moveTaskStatus } = await import("@/lib/actions/tasks");

      const { data: taskB } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectBId,
          title: "F231 task in project B for viewer test",
          status: "todo",
          priority: "low",
          author_id: memberUserId,
          number: 102,
        })
        .select("id")
        .single();
      const taskBId = taskB!.id;
      await adminClient.from("task_assignees").insert({ task_id: taskBId, user_id: viewerUserId });

      await signInAs(viewerEmail, memberPassword);
      const result = await moveTaskStatus(taskBId, "Cooking");
      expect(result.ok).toBe(false);

      const { data: unchanged } = await adminClient
        .from("tasks")
        .select("status")
        .eq("id", taskBId)
        .single();
      expect(unchanged!.status).toBe("todo");

      await signInAs(memberEmail, memberPassword);
    });

    it("test_AS_437_excludes_a_task_assigned_to_the_caller_in_an_archived_project_from_my_tasks", async () => {
      const { getMyTasks } = await import("@/lib/queries/my-tasks");

      const { data: archivedTask } = await adminClient
        .from("tasks")
        .insert({
          project_id: archivedProjectId,
          title: "F231 archived-project task",
          status: "todo",
          priority: "low",
          author_id: memberUserId,
          number: 1,
        })
        .select("id")
        .single();
      await adminClient
        .from("task_assignees")
        .insert({ task_id: archivedTask!.id, user_id: memberUserId });
      await adminClient
        .from("projects")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", archivedProjectId);

      const buckets = await getMyTasks(workspaceId, memberUserId, "UTC", true);
      const allIds = [...buckets.overdue, ...buckets.today, ...buckets.thisWeek, ...buckets.later].map(
        (r) => r.id,
      );
      expect(allIds).not.toContain(archivedTask!.id);
    });

    it("test_AS_441_optionally_includes_a_watched_task_in_a_project_other_than_any_assigned_one", async () => {
      const { getMyTasks } = await import("@/lib/queries/my-tasks");

      // A task in project B, NOT assigned to the caller, only watched.
      const { data: watchedTask } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectBId,
          title: "F231 watched-only task",
          status: "todo",
          priority: "medium",
          author_id: viewerUserId,
          number: 201,
        })
        .select("id")
        .single();
      const watchedTaskId = watchedTask!.id;
      // Self-serve insert under the caller's own session (RLS policy
      // requires user_id = auth.uid()), same as lib/actions/watchers.ts's
      // real self-serve path.
      const { error: watchErr } = await currentTestClient
        .from("task_watchers")
        .insert({ task_id: watchedTaskId, user_id: memberUserId });
      expect(watchErr).toBeNull();

      // Without the toggle: excluded.
      const withoutWatched = await getMyTasks(workspaceId, memberUserId, "UTC", false);
      const idsWithout = [
        ...withoutWatched.overdue,
        ...withoutWatched.today,
        ...withoutWatched.thisWeek,
        ...withoutWatched.later,
      ].map((r) => r.id);
      expect(idsWithout).not.toContain(watchedTaskId);

      // With the toggle: included exactly once, flagged as watched-only.
      const withWatched = await getMyTasks(workspaceId, memberUserId, "UTC", true);
      const allWithWatched = [
        ...withWatched.overdue,
        ...withWatched.today,
        ...withWatched.thisWeek,
        ...withWatched.later,
      ];
      const matches = allWithWatched.filter((r) => r.id === watchedTaskId);
      expect(matches.length).toBe(1);
      expect(matches[0].isWatched).toBe(true);
      expect(matches[0].isAssigned).toBe(false);
    });

    it("test_AS_441_a_task_both_assigned_and_watched_appears_exactly_once", async () => {
      const { getMyTasks } = await import("@/lib/queries/my-tasks");

      const { data: task } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectAId,
          title: "F231 assigned and watched task",
          status: "todo",
          priority: "low",
          author_id: memberUserId,
          number: 301,
        })
        .select("id")
        .single();
      const taskId = task!.id;
      await adminClient.from("task_assignees").insert({ task_id: taskId, user_id: memberUserId });
      const { error: watchErr } = await currentTestClient
        .from("task_watchers")
        .insert({ task_id: taskId, user_id: memberUserId });
      expect(watchErr).toBeNull();

      const buckets = await getMyTasks(workspaceId, memberUserId, "UTC", true);
      const all = [...buckets.overdue, ...buckets.today, ...buckets.thisWeek, ...buckets.later];
      const matches = all.filter((r) => r.id === taskId);
      expect(matches.length).toBe(1);
      expect(matches[0].isAssigned).toBe(true);
      expect(matches[0].isWatched).toBe(true);
    });

    it("test_AS_441_negative_a_watched_task_in_a_private_project_the_caller_cannot_see_is_excluded", async () => {
      const { getMyTasks } = await import("@/lib/queries/my-tasks");

      const { data: privateTask } = await adminClient
        .from("tasks")
        .insert({
          project_id: privateProjectId,
          title: "F231 private watched task",
          status: "todo",
          priority: "low",
          author_id: viewerUserId,
          number: 401,
        })
        .select("id")
        .single();
      const privateTaskId = privateTask!.id;
      // Insert the watcher row via the admin client -- RLS on
      // task_watchers itself would already block the caller's own session
      // from inserting a row for a task they can't see; seeding via admin
      // proves getMyTasks's SELECT-side visibility gate independently,
      // even if a watcher row exists.
      await adminClient
        .from("task_watchers")
        .insert({ task_id: privateTaskId, user_id: memberUserId });

      const buckets = await getMyTasks(workspaceId, memberUserId, "UTC", true);
      const allIds = [...buckets.overdue, ...buckets.today, ...buckets.thisWeek, ...buckets.later].map(
        (r) => r.id,
      );
      expect(allIds).not.toContain(privateTaskId);
    });
  },
);
