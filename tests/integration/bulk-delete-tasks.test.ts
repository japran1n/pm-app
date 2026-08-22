// Integration test for F187 (AS-339, AS-340), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/bulk-update-tasks.test.ts (F186), this feature's own
// sibling action.
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
    "F187: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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
  "bulkDeleteTasks (F187: AS-339, AS-340)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    // A second, PRIVATE project in the SAME workspace that `memberUserId`
    // has no explicit project_members row for — the AS-340 "mixed
    // selection" scenario (a task the caller CAN delete and a task they
    // CANNOT, in the same call), mirroring F186's AS-341 test shape.
    let privateProjectId: string;
    let authorUserId: string;
    let memberUserId: string;
    let outsiderUserId: string;
    let viewerUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F187 Test Workspace",
          slug: `f187-tasks-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const authorEmail = `f187-author-${uniqueSuffix}@example.com`;
      const { data: authorAuth, error: authorAuthErr } =
        await adminClient.auth.admin.createUser({
          email: authorEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (authorAuthErr || !authorAuth.user) {
        throw new Error(`Failed to create author user: ${authorAuthErr?.message}`);
      }
      authorUserId = authorAuth.user.id;
      createdUserIds.push(authorUserId);

      const memberEmail = `f187-member-${uniqueSuffix}@example.com`;
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

      const outsiderEmail = `f187-outsider-${uniqueSuffix}@example.com`;
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

      const viewerEmail = `f187-viewer-${uniqueSuffix}@example.com`;
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

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert([
          {
            workspace_id: workspaceId,
            user_id: authorUserId,
            role: "member",
            status: "active",
          },
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
        ]);
      if (memberInsertErr) {
        throw new Error(`Failed to seed members: ${memberInsertErr.message}`);
      }
      // outsiderUserId is deliberately never added to `workspaceId`.

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F187 Project ${uniqueSuffix}`,
          created_by: authorUserId,
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      projectId = proj.id;
      createdProjectIds.push(projectId);

      // Private project — memberUserId is an active workspace member but
      // has NO explicit project_members row here (AS-340's mixed-selection
      // scenario, mirroring F186's AS-341 test).
      const { data: privateProj, error: privateProjErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F187 Private Project ${uniqueSuffix}`,
          created_by: authorUserId,
          visibility: "private",
        })
        .select("id")
        .single();
      if (privateProjErr || !privateProj) {
        throw new Error(
          `Failed to create private test project: ${privateProjErr?.message}`,
        );
      }
      privateProjectId = privateProj.id;
      createdProjectIds.push(privateProjectId);

      // Only the project's author is an explicit member of the private
      // project — memberUserId is not.
      const { error: pmErr } = await adminClient.from("project_members").insert({
        project_id: privateProjectId,
        user_id: authorUserId,
        project_role: "lead",
      });
      if (pmErr) {
        throw new Error(`Failed to seed project_members: ${pmErr.message}`);
      }
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      for (const taskId of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", taskId);
      }
      for (const pId of createdProjectIds) {
        await adminClient.from("project_members").delete().eq("project_id", pId);
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

    async function makeTask(
      targetProjectId: string = projectId,
      parentTaskId: string | null = null,
    ): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: targetProjectId,
          title: `F187 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: authorUserId,
          status: "todo",
          parent_task_id: parentTaskId,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    it("AS-339: a single call soft-deletes every task in the selection", async () => {
      const { bulkDeleteTasks } = await import("@/lib/actions/tasks");
      const taskA = await makeTask();
      const taskB = await makeTask();
      const taskC = await makeTask();

      currentTestUserId = memberUserId;

      const result = await bulkDeleteTasks([taskA, taskB, taskC]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(new Set(result.data.succeededIds)).toEqual(
        new Set([taskA, taskB, taskC]),
      );
      expect(result.data.failedIds).toEqual([]);

      const { data: rows } = await adminClient
        .from("tasks")
        .select("id, deleted_at")
        .in("id", [taskA, taskB, taskC]);
      expect(rows?.every((row) => row.deleted_at !== null)).toBe(true);
    });

    it("AS-339: this is a soft delete, not a hard delete — the row still exists after the call", async () => {
      const { bulkDeleteTasks } = await import("@/lib/actions/tasks");
      const taskA = await makeTask();

      currentTestUserId = memberUserId;

      const result = await bulkDeleteTasks([taskA]);
      expect(result.ok).toBe(true);

      const { data: row, error } = await adminClient
        .from("tasks")
        .select("id, deleted_at")
        .eq("id", taskA)
        .single();
      expect(error).toBeNull();
      expect(row?.id).toBe(taskA);
      expect(row?.deleted_at).not.toBeNull();
    });

    it("AS-340: a task in a private project the caller isn't a member of is rejected by KEY-lookup-able id, while a permitted task in the same call still succeeds and isn't rolled back", async () => {
      const { bulkDeleteTasks } = await import("@/lib/actions/tasks");
      const permittedTask = await makeTask(projectId);
      const forbiddenTask = await makeTask(privateProjectId);

      // memberUserId is an active member of the workspace (so the
      // permitted, workspace-visible task's delete should succeed) but has
      // no project_members row for the private project the forbidden task
      // lives in.
      currentTestUserId = memberUserId;

      const result = await bulkDeleteTasks([permittedTask, forbiddenTask]);

      // AS-340: one forbidden task does NOT fail the whole batch — the
      // call still returns ok:true, with the permitted task succeeding and
      // the forbidden one excluded/reported (by id here; the UI layer
      // resolves failedIds to "PROJECTKEY-number" via formatTaskKey before
      // display — see bulk-delete-action.tsx).
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.succeededIds).toEqual([permittedTask]);
      expect(result.data.failedIds).toHaveLength(1);
      expect(result.data.failedIds[0]?.id).toBe(forbiddenTask);

      // The permitted task was actually deleted...
      const { data: permittedRow } = await adminClient
        .from("tasks")
        .select("deleted_at")
        .eq("id", permittedTask)
        .single();
      expect(permittedRow?.deleted_at).not.toBeNull();

      // ...and the forbidden task's success is NOT rolled back by the
      // other failure — it was simply never touched (still live).
      const { data: forbiddenRow } = await adminClient
        .from("tasks")
        .select("deleted_at")
        .eq("id", forbiddenTask)
        .single();
      expect(forbiddenRow?.deleted_at).toBeNull();
    });

    it("AS-340: a caller who is not a member of the workspace at all gets every task rejected, not a whole-call throw, and nothing is deleted", async () => {
      const { bulkDeleteTasks } = await import("@/lib/actions/tasks");
      const taskA = await makeTask();
      const taskB = await makeTask();

      currentTestUserId = outsiderUserId;

      const result = await bulkDeleteTasks([taskA, taskB]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.succeededIds).toEqual([]);
      expect(result.data.failedIds).toHaveLength(2);

      const { data: rows } = await adminClient
        .from("tasks")
        .select("deleted_at")
        .in("id", [taskA, taskB]);
      expect(rows?.every((row) => row.deleted_at === null)).toBe(true);
    });

    it("AS-340: a viewer (read-only role) has every selected task rejected", async () => {
      const { bulkDeleteTasks } = await import("@/lib/actions/tasks");
      const taskA = await makeTask();

      currentTestUserId = viewerUserId;

      const result = await bulkDeleteTasks([taskA]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.succeededIds).toEqual([]);
      expect(result.data.failedIds).toHaveLength(1);

      const { data: row } = await adminClient
        .from("tasks")
        .select("deleted_at")
        .eq("id", taskA)
        .single();
      expect(row?.deleted_at).toBeNull();
    });

    it("cascades to a deleted task's live children in the same call", async () => {
      const { bulkDeleteTasks } = await import("@/lib/actions/tasks");
      const parent = await makeTask();
      const child = await makeTask(projectId, parent);

      currentTestUserId = memberUserId;

      const result = await bulkDeleteTasks([parent]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.succeededIds).toEqual([parent]);

      const { data: childRow } = await adminClient
        .from("tasks")
        .select("deleted_at")
        .eq("id", child)
        .single();
      expect(childRow?.deleted_at).not.toBeNull();
    });

    it("rejects an unauthenticated caller", async () => {
      const { bulkDeleteTasks } = await import("@/lib/actions/tasks");
      const taskA = await makeTask();

      currentTestUserId = null;

      const result = await bulkDeleteTasks([taskA]);
      expect(result.ok).toBe(false);
    });

    it("rejects an empty task list at the validation boundary", async () => {
      const { bulkDeleteTasks } = await import("@/lib/actions/tasks");
      currentTestUserId = memberUserId;

      const result = await bulkDeleteTasks([]);
      expect(result.ok).toBe(false);
    });

    it("rejects a list longer than the 200-id cap at the validation boundary", async () => {
      const { bulkDeleteTasks } = await import("@/lib/actions/tasks");
      currentTestUserId = memberUserId;

      const tooMany = Array.from({ length: 201 }, (_, i) =>
        // Deterministic, valid-shaped UUIDs — the cap is checked before any
        // DB lookup, so these never need to resolve to real rows.
        `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      );

      const result = await bulkDeleteTasks(tooMany);
      expect(result.ok).toBe(false);
    });

    it("rejects duplicate ids in the same call at the validation boundary", async () => {
      const { bulkDeleteTasks } = await import("@/lib/actions/tasks");
      const taskA = await makeTask();
      currentTestUserId = memberUserId;

      const result = await bulkDeleteTasks([taskA, taskA]);
      expect(result.ok).toBe(false);
    });

    it("re-calling on an already-deleted task treats it as not found rather than re-deleting", async () => {
      const { bulkDeleteTasks } = await import("@/lib/actions/tasks");
      const taskA = await makeTask();
      currentTestUserId = memberUserId;

      const first = await bulkDeleteTasks([taskA]);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.data.succeededIds).toEqual([taskA]);

      const second = await bulkDeleteTasks([taskA]);
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.data.succeededIds).toEqual([]);
      expect(second.data.failedIds).toHaveLength(1);
      expect(second.data.failedIds[0]?.reason).toBe("Task not found.");
    });
  },
);
