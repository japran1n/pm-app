// Integration test for F189 (AS-344, AS-351), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/delete-task.test.ts.
//
// `@/lib/supabase/server`'s `createClient()` is mocked to stand in for the
// Next.js request-scoped server client, resolving `auth.getUser()` to a
// real throwaway Supabase Auth user for the current test.

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
  "restoreTask (F189: AS-344, AS-351)",
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
    let viewerUserId: string;
    let outsiderUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F189 Test Workspace",
          slug: `f189-tasks-${uniqueSuffix}`,
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
          name: "F189 Other Workspace",
          slug: `f189-other-${uniqueSuffix}`,
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

      const memberEmail = `f189-member-${uniqueSuffix}@example.com`;
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

      // Viewer: active member of the workspace, but restore is a write
      // action — a viewer must be rejected (F128's canWrite gate), same
      // negative-case shape deleteTask's own suite already covers for
      // AS-055.
      const viewerEmail = `f189-viewer-${uniqueSuffix}@example.com`;
      const { data: viewerAuth, error: viewerAuthErr } =
        await adminClient.auth.admin.createUser({
          email: viewerEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (viewerAuthErr || !viewerAuth.user) {
        throw new Error(`Failed to create viewer user: ${viewerAuthErr?.message}`);
      }
      viewerUserId = viewerAuth.user.id;
      createdUserIds.push(viewerUserId);

      // A member of a *different* workspace only — never a member of
      // `workspaceId`. Used as a non-member caller (negative case).
      const outsiderEmail = `f189-outsider-${uniqueSuffix}@example.com`;
      const { data: outsiderAuth, error: outsiderAuthErr } =
        await adminClient.auth.admin.createUser({
          email: outsiderEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (outsiderAuthErr || !outsiderAuth.user) {
        throw new Error(`Failed to create outsider user: ${outsiderAuthErr?.message}`);
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
            user_id: viewerUserId,
            role: "viewer",
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
          name: `F189 Project ${uniqueSuffix}`,
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
      // A larger fixture set than delete-task.test.ts's own (more test
      // cases create more rows) pushes real-network cleanup past the
      // default 10s hook timeout — bumped, same non-fatal network-latency
      // class F186/F187/F188's own handoffs already documented.
      if (createdTaskIds.length > 0) {
        await adminClient.from("tasks").delete().in("id", createdTaskIds);
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
    }, 30000);

    async function makeDeletedTask(
      overrides: {
        status?: string;
        deletedViaTaskId?: string | null;
        projectIdOverride?: string;
      } = {},
    ): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: overrides.projectIdOverride ?? projectId,
          title: `F189 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: memberUserId,
          status: overrides.status ?? "todo",
          deleted_at: new Date().toISOString(),
          deleted_by: memberUserId,
          deleted_via_task_id: overrides.deletedViaTaskId ?? null,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed deleted task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    it("AS-344: a restored task returns to its original project and status", async () => {
      const { restoreTask } = await import("@/lib/actions/tasks");
      const taskId = await makeDeletedTask({ status: "in_review" });

      currentTestUserId = memberUserId;
      const result = await restoreTask(taskId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.id).toBe(taskId);
      expect(result.data.projectId).toBe(projectId);
      expect(result.data.status).toBe("in_review");
      expect(result.data.statusWasReset).toBe(false);
      expect(typeof result.data.position).toBe("number");

      const { data: row } = await adminClient
        .from("tasks")
        .select("id, project_id, status, deleted_at, deleted_by")
        .eq("id", taskId)
        .single();
      expect(row?.project_id).toBe(projectId);
      expect(row?.status).toBe("in_review");
      expect(row?.deleted_at).toBeNull();
      expect(row?.deleted_by).toBeNull();

      // The row is visible again in a standard RLS-filtered SELECT.
      const { data: visibleRows } = await adminClient
        .from("tasks")
        .select("id")
        .eq("id", taskId)
        .is("deleted_at", null);
      expect(visibleRows?.length).toBe(1);
    });

    it("AS-344: restoring recomputes a fresh, non-colliding position rather than reusing the stale one", async () => {
      const { restoreTask } = await import("@/lib/actions/tasks");
      const taskId = await makeDeletedTask({ status: "todo" });

      // Seed the task's stale position to a value that a currently-live
      // task now also occupies, then create that colliding live task
      // AFTER the deleted task's own position was set — simulating time
      // passing while the task sat in trash.
      await adminClient
        .from("tasks")
        .update({ position: 5000 })
        .eq("id", taskId);

      const { data: liveTask } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F189 Live Colliding Task ${Date.now()}`,
          author_id: memberUserId,
          status: "todo",
          position: 5000,
        })
        .select("id")
        .single();
      if (liveTask) createdTaskIds.push(liveTask.id);

      currentTestUserId = memberUserId;
      const result = await restoreTask(taskId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The restored task must be appended to the end of the column, not
      // reuse the stale 5000 value that now collides.
      expect(result.data.position).toBeGreaterThan(5000);
    });

    it("AS-344: restoring a task also restores its cascade-deleted children whose deleted_via_task_id points back to it", async () => {
      const { restoreTask } = await import("@/lib/actions/tasks");
      const parentId = await makeDeletedTask({ status: "todo" });
      const childId = await makeDeletedTask({
        status: "in_progress",
        deletedViaTaskId: parentId,
      });
      // A sibling deleted task that just happens to be in trash at the
      // same time, but was NOT cascade-deleted via this parent — must NOT
      // be restored as a side effect.
      const unrelatedId = await makeDeletedTask({ status: "todo" });

      currentTestUserId = memberUserId;
      const result = await restoreTask(parentId);
      expect(result.ok).toBe(true);

      const { data: childRow } = await adminClient
        .from("tasks")
        .select("deleted_at, deleted_via_task_id, status")
        .eq("id", childId)
        .single();
      expect(childRow?.deleted_at).toBeNull();
      expect(childRow?.deleted_via_task_id).toBeNull();
      expect(childRow?.status).toBe("in_progress");

      const { data: unrelatedRow } = await adminClient
        .from("tasks")
        .select("deleted_at")
        .eq("id", unrelatedId)
        .single();
      expect(unrelatedRow?.deleted_at).not.toBeNull();
    });

    it("AS-351: restoring a task into an archived project does not unarchive the project", async () => {
      const { restoreTask } = await import("@/lib/actions/tasks");

      const { data: archivedProject, error: archivedProjErr } =
        await adminClient
          .from("projects")
          .insert({
            workspace_id: workspaceId,
            name: `F189 Archived Project ${Date.now()}`,
            created_by: memberUserId,
          })
          .select("id")
          .single();
      if (archivedProjErr || !archivedProject) {
        throw new Error(
          `Failed to create archived-project fixture: ${archivedProjErr?.message}`,
        );
      }
      createdProjectIds.push(archivedProject.id);

      const taskId = await makeDeletedTask({
        status: "todo",
        projectIdOverride: archivedProject.id,
      });

      const archivedAt = new Date().toISOString();
      await adminClient
        .from("projects")
        .update({ deleted_at: archivedAt })
        .eq("id", archivedProject.id);

      currentTestUserId = memberUserId;
      const result = await restoreTask(taskId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.projectId).toBe(archivedProject.id);

      const { data: taskRow } = await adminClient
        .from("tasks")
        .select("deleted_at, project_id")
        .eq("id", taskId)
        .single();
      expect(taskRow?.deleted_at).toBeNull();
      expect(taskRow?.project_id).toBe(archivedProject.id);

      // The archived project's own deleted_at must be completely
      // unchanged by restoring a task inside it.
      const { data: projectRow } = await adminClient
        .from("projects")
        .select("deleted_at")
        .eq("id", archivedProject.id)
        .single();
      expect(projectRow?.deleted_at).toBeTruthy();
      expect(new Date(projectRow!.deleted_at as string).getTime()).toBe(
        new Date(archivedAt).getTime(),
      );
    });

    it("negative: a task that is not currently deleted cannot be restored (behaves as not found)", async () => {
      const { restoreTask } = await import("@/lib/actions/tasks");
      const { data: liveTask } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F189 Live Task ${Date.now()}`,
          author_id: memberUserId,
          status: "todo",
        })
        .select("id")
        .single();
      if (liveTask) createdTaskIds.push(liveTask.id);

      currentTestUserId = memberUserId;
      const result = await restoreTask(liveTask!.id);
      expect(result.ok).toBe(false);
    });

    it("negative: a caller who is not a member of the task's workspace cannot restore it", async () => {
      const { restoreTask } = await import("@/lib/actions/tasks");
      const taskId = await makeDeletedTask();

      currentTestUserId = outsiderUserId;
      const result = await restoreTask(taskId);
      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("tasks")
        .select("deleted_at")
        .eq("id", taskId)
        .single();
      expect(row?.deleted_at).not.toBeNull();
    });

    it("negative: a viewer cannot restore a task", async () => {
      const { restoreTask } = await import("@/lib/actions/tasks");
      const taskId = await makeDeletedTask();

      currentTestUserId = viewerUserId;
      const result = await restoreTask(taskId);
      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("tasks")
        .select("deleted_at")
        .eq("id", taskId)
        .single();
      expect(row?.deleted_at).not.toBeNull();
    });

    it("negative: an unauthenticated caller cannot restore a task", async () => {
      const { restoreTask } = await import("@/lib/actions/tasks");
      const taskId = await makeDeletedTask();

      currentTestUserId = null;
      const result = await restoreTask(taskId);
      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("tasks")
        .select("deleted_at")
        .eq("id", taskId)
        .single();
      expect(row?.deleted_at).not.toBeNull();
    });

    it("negative: an invalid task id is rejected by Zod validation", async () => {
      const { restoreTask } = await import("@/lib/actions/tasks");
      currentTestUserId = memberUserId;
      const result = await restoreTask("not-a-uuid");
      expect(result.ok).toBe(false);
    });
  },
);
