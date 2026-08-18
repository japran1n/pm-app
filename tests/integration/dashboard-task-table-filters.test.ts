// Integration test for F078 (AS-134), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/list-view-filters.test.ts (F054), exercising
// `getWorkspaceListTasks`'s `filters` argument (lib/queries/tasks.ts)
// directly since that's where AS-134's filter/AND/clear semantics
// actually live — `<ListFilters>` only ever changes which `filters`
// object this query receives via the URL round-trip, and is reused
// unmodified from F054 (see components/dashboard/dashboard-task-table.tsx).
//
// The distinguishing behaviour vs. F054's test: tasks are seeded across
// TWO projects in the same workspace, and `getWorkspaceListTasks` must
// return matching tasks from both — proving the query is workspace-wide
// (tasks -> projects -> workspace_id), not project-scoped like F053's
// `getProjectListTasks`.

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
  "getWorkspaceListTasks filters (F078, AS-134)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let otherWorkspaceId: string;
    let projectAId: string;
    let projectBId: string;
    let archivedProjectId: string;
    let otherWorkspaceProjectId: string;
    let memberUserId: string;
    let otherMemberUserId: string;
    const createdTaskIds: string[] = [];

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const memberEmail = `f078-dash-member-${uniqueSuffix}@example.com`;
      const memberPassword = "Test-password-1!";
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(
          `Failed to create test user: ${memberAuthErr?.message}`,
        );
      }
      memberUserId = memberAuth.user.id;

      const { data: otherAuth, error: otherAuthErr } =
        await adminClient.auth.admin.createUser({
          email: `f078-dash-other-${uniqueSuffix}@example.com`,
          password: memberPassword,
          email_confirm: true,
        });
      if (otherAuthErr || !otherAuth.user) {
        throw new Error(`Failed to create other user: ${otherAuthErr?.message}`);
      }
      otherMemberUserId = otherAuth.user.id;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F078 Dashboard Workspace",
          slug: `f078-dash-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws)
        throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      // A second, unrelated workspace with its own project + task, used to
      // prove getWorkspaceListTasks never leaks another workspace's rows
      // (mirrors the DoD's "no other workspace's rows are mutated or
      // returned" requirement).
      const { data: otherWs, error: otherWsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F078 Other Workspace",
          slug: `f078-dash-other-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (otherWsErr || !otherWs)
        throw new Error(
          `Failed to create other workspace: ${otherWsErr?.message}`,
        );
      otherWorkspaceId = otherWs.id;

      const { error: memberErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: memberUserId,
          role: "owner",
          status: "active",
        });
      if (memberErr)
        throw new Error(`Failed to seed membership: ${memberErr.message}`);

      // Two projects in the SAME workspace — the workspace-wide query
      // must combine tasks from both.
      const { data: projectA, error: projectAErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F078 Project A" })
        .select("id")
        .single();
      if (projectAErr || !projectA)
        throw new Error(`Failed to seed project A: ${projectAErr?.message}`);
      projectAId = projectA.id;

      const { data: projectB, error: projectBErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F078 Project B" })
        .select("id")
        .single();
      if (projectBErr || !projectB)
        throw new Error(`Failed to seed project B: ${projectBErr?.message}`);
      projectBId = projectB.id;

      const { data: otherProject, error: otherProjectErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: otherWorkspaceId,
          name: "F078 Other Workspace Project",
        })
        .select("id")
        .single();
      if (otherProjectErr || !otherProject)
        throw new Error(
          `Failed to seed other workspace project: ${otherProjectErr?.message}`,
        );
      otherWorkspaceProjectId = otherProject.id;

      // A third project in the SAME workspace, immediately soft-deleted
      // (archived). F105 (AS-129/AS-134): a task in this project must be
      // excluded from getWorkspaceListTasks's results, matching the
      // dashboard RPCs' `p.deleted_at is null` exclusion rule.
      const { data: archivedProject, error: archivedProjectErr } =
        await adminClient
          .from("projects")
          .insert({ workspace_id: workspaceId, name: "F078 Archived Project" })
          .select("id")
          .single();
      if (archivedProjectErr || !archivedProject)
        throw new Error(
          `Failed to seed archived project: ${archivedProjectErr?.message}`,
        );
      archivedProjectId = archivedProject.id;
      const { error: archiveErr } = await adminClient
        .from("projects")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", archivedProjectId);
      if (archiveErr)
        throw new Error(`Failed to archive project: ${archiveErr.message}`);

      // Task A: project A / todo / high / assigned to memberUserId
      const { data: taskA, error: taskAErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectAId,
          title: "Task A",
          status: "todo",
          priority: "high",
          assignee_id: memberUserId,
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (taskAErr || !taskA)
        throw new Error(`Failed to seed task A: ${taskAErr?.message}`);
      createdTaskIds.push(taskA.id);

      // Task B: project B / todo / low / assigned to otherMemberUserId —
      // different project than A, proving the query spans projects.
      const { data: taskB, error: taskBErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectBId,
          title: "Task B",
          status: "todo",
          priority: "low",
          assignee_id: otherMemberUserId,
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (taskBErr || !taskB)
        throw new Error(`Failed to seed task B: ${taskBErr?.message}`);
      createdTaskIds.push(taskB.id);

      // Task C: project A / in_progress / high / unassigned.
      const { data: taskC, error: taskCErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectAId,
          title: "Task C",
          status: "in_progress",
          priority: "high",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (taskCErr || !taskC)
        throw new Error(`Failed to seed task C: ${taskCErr?.message}`);
      createdTaskIds.push(taskC.id);

      // Task D: a different workspace's project entirely — must never
      // appear in results scoped to `workspaceId`.
      const { data: taskD, error: taskDErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: otherWorkspaceProjectId,
          title: "Task D (other workspace)",
          status: "todo",
          priority: "high",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (taskDErr || !taskD)
        throw new Error(`Failed to seed task D: ${taskDErr?.message}`);
      createdTaskIds.push(taskD.id);

      // Task E: belongs to the archived project in the SAME workspace —
      // must never appear in getWorkspaceListTasks's results (F105).
      const { data: taskE, error: taskEErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: archivedProjectId,
          title: "Task E (archived project)",
          status: "todo",
          priority: "urgent",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (taskEErr || !taskE)
        throw new Error(`Failed to seed task E: ${taskEErr?.message}`);
      createdTaskIds.push(taskE.id);

      memberClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await memberClient.auth.signInWithPassword({
        email: memberEmail,
        password: memberPassword,
      });
      if (signInErr)
        throw new Error(`Failed to sign in member: ${signInErr.message}`);
    });

    afterAll(async () => {
      for (const id of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", id);
      }
      if (projectAId) await adminClient.from("projects").delete().eq("id", projectAId);
      if (projectBId) await adminClient.from("projects").delete().eq("id", projectBId);
      if (archivedProjectId)
        await adminClient.from("projects").delete().eq("id", archivedProjectId);
      if (otherWorkspaceProjectId)
        await adminClient.from("projects").delete().eq("id", otherWorkspaceProjectId);
      if (workspaceId) {
        await adminClient
          .from("workspace_members")
          .delete()
          .eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      if (otherWorkspaceId)
        await adminClient.from("workspaces").delete().eq("id", otherWorkspaceId);
      if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
      if (otherMemberUserId)
        await adminClient.auth.admin.deleteUser(otherMemberUserId);
    });

    it("AS-134: a workspace-wide query with no filters returns tasks from every project in the workspace, and none from another workspace", async () => {
      const { getWorkspaceListTasks } = await import("@/lib/queries/tasks");
      const tasks = await getWorkspaceListTasks(workspaceId);

      const titles = tasks.map((t) => t.title).sort();
      expect(titles).toEqual(["Task A", "Task B", "Task C"]);
    });

    it("AS-134: a single status filter narrows results across projects to matching tasks only", async () => {
      const { getWorkspaceListTasks } = await import("@/lib/queries/tasks");
      const tasks = await getWorkspaceListTasks(workspaceId, {
        status: "in_progress",
      });

      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe("Task C");
    });

    it("AS-134: a single priority filter narrows results across projects to matching tasks only", async () => {
      const { getWorkspaceListTasks } = await import("@/lib/queries/tasks");
      const tasks = await getWorkspaceListTasks(workspaceId, {
        priority: "high",
      });

      const titles = tasks.map((t) => t.title).sort();
      expect(titles).toEqual(["Task A", "Task C"]);
    });

    it("AS-134: a single assignee filter narrows results across projects to matching tasks only", async () => {
      const { getWorkspaceListTasks } = await import("@/lib/queries/tasks");
      const tasks = await getWorkspaceListTasks(workspaceId, {
        assigneeId: otherMemberUserId,
      });

      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe("Task B");
    });

    it("AS-134: combining status + priority filters applies AND semantics, same as the project list view", async () => {
      const { getWorkspaceListTasks } = await import("@/lib/queries/tasks");

      // Both Task A and Task B are status=todo; only Task A is also
      // priority=high. An OR-combined filter would incorrectly also
      // return Task C (priority=high, status=in_progress).
      const tasks = await getWorkspaceListTasks(workspaceId, {
        status: "todo",
        priority: "high",
      });

      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe("Task A");
    });

    it("AS-134: a combination matching zero tasks returns an empty list, not an OR-fallback", async () => {
      const { getWorkspaceListTasks } = await import("@/lib/queries/tasks");

      const tasks = await getWorkspaceListTasks(workspaceId, {
        status: "in_progress",
        priority: "low",
      });

      expect(tasks).toHaveLength(0);
    });

    it("AS-134: omitting all filters (clearing) restores the full unfiltered, workspace-wide list", async () => {
      const { getWorkspaceListTasks } = await import("@/lib/queries/tasks");

      const filtered = await getWorkspaceListTasks(workspaceId, {
        status: "todo",
      });
      expect(filtered).toHaveLength(2);

      const cleared = await getWorkspaceListTasks(workspaceId, {});
      const clearedNoArg = await getWorkspaceListTasks(workspaceId);

      expect(cleared).toHaveLength(3);
      expect(clearedNoArg).toHaveLength(3);
      expect(cleared.map((t) => t.title).sort()).toEqual([
        "Task A",
        "Task B",
        "Task C",
      ]);
    });

    it("AS-129/AS-134 (F105): a task belonging to an archived (soft-deleted) project is excluded from the dashboard table, while non-archived-project tasks remain, matching the charts' exclusion rule", async () => {
      const { getWorkspaceListTasks } = await import("@/lib/queries/tasks");
      const tasks = await getWorkspaceListTasks(workspaceId);

      const titles = tasks.map((t) => t.title).sort();
      // Task E lives in the archived project and must be absent, even
      // though it is workspace-scoped and not soft-deleted itself.
      expect(titles).not.toContain("Task E (archived project)");
      // Non-archived-project tasks are still present — proving this is a
      // project-archive filter, not an over-broad exclusion.
      expect(titles).toEqual(["Task A", "Task B", "Task C"]);
    });
  },
);
