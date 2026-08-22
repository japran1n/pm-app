// Integration test for F186 (AS-337, AS-338, AS-341), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf pattern
// established by tests/integration/assign-task.test.ts and
// tests/integration/edit-task.test.ts.
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
    "F186: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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
  "bulkUpdateTasks (F186: AS-337, AS-338, AS-341)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    // A second, PRIVATE project in the SAME workspace that `memberUserId`
    // has no explicit project_members row for — the AS-341 "mixed
    // selection" scenario (a task the caller CAN edit and a task they
    // CANNOT, in the same call).
    let privateProjectId: string;
    let authorUserId: string;
    let memberUserId: string;
    let assigneeUserId: string;
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
          name: "F186 Test Workspace",
          slug: `f186-tasks-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const authorEmail = `f186-author-${uniqueSuffix}@example.com`;
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

      const memberEmail = `f186-member-${uniqueSuffix}@example.com`;
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

      const assigneeEmail = `f186-assignee-${uniqueSuffix}@example.com`;
      const { data: assigneeAuth, error: assigneeAuthErr } =
        await adminClient.auth.admin.createUser({
          email: assigneeEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (assigneeAuthErr || !assigneeAuth.user) {
        throw new Error(
          `Failed to create assignee user: ${assigneeAuthErr?.message}`,
        );
      }
      assigneeUserId = assigneeAuth.user.id;
      createdUserIds.push(assigneeUserId);

      const outsiderEmail = `f186-outsider-${uniqueSuffix}@example.com`;
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

      const viewerEmail = `f186-viewer-${uniqueSuffix}@example.com`;
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
            user_id: assigneeUserId,
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
          name: `F186 Project ${uniqueSuffix}`,
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
      // has NO explicit project_members row here (AS-341's scenario).
      const { data: privateProj, error: privateProjErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F186 Private Project ${uniqueSuffix}`,
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
      status: string = "todo",
    ): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: targetProjectId,
          title: `F186 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: authorUserId,
          status,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    it("AS-337: a single call changes the status of every task in the selection", async () => {
      const { bulkUpdateTasks } = await import("@/lib/actions/tasks");
      const taskA = await makeTask();
      const taskB = await makeTask();
      const taskC = await makeTask();

      currentTestUserId = memberUserId;

      const result = await bulkUpdateTasks([taskA, taskB, taskC], {
        status: "in_progress",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(new Set(result.data.succeededIds)).toEqual(
        new Set([taskA, taskB, taskC]),
      );
      expect(result.data.failedIds).toEqual([]);

      const { data: rows } = await adminClient
        .from("tasks")
        .select("id, status")
        .in("id", [taskA, taskB, taskC]);
      expect(rows?.every((row) => row.status === "in_progress")).toBe(true);
    });

    it("AS-338: a single call sets assignee, priority, and due date together", async () => {
      const { bulkUpdateTasks } = await import("@/lib/actions/tasks");
      const taskA = await makeTask();
      const taskB = await makeTask();

      currentTestUserId = memberUserId;

      const result = await bulkUpdateTasks([taskA, taskB], {
        assigneeId: assigneeUserId,
        priority: "high",
        dueDate: "2026-12-31",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(new Set(result.data.succeededIds)).toEqual(new Set([taskA, taskB]));

      const { data: rows } = await adminClient
        .from("tasks")
        .select("id, assignee_id, priority, due_date")
        .in("id", [taskA, taskB]);
      for (const row of rows ?? []) {
        expect(row.assignee_id).toBe(assigneeUserId);
        expect(row.priority).toBe("high");
        expect(row.due_date).toBe("2026-12-31");
      }
    });

    it("AS-338: a bulk call can set only priority, leaving assignee/due date untouched", async () => {
      const { bulkUpdateTasks } = await import("@/lib/actions/tasks");
      const taskA = await makeTask();

      currentTestUserId = memberUserId;

      const first = await bulkUpdateTasks([taskA], {
        assigneeId: assigneeUserId,
        dueDate: "2026-11-01",
      });
      expect(first.ok).toBe(true);

      const second = await bulkUpdateTasks([taskA], { priority: "low" });
      expect(second.ok).toBe(true);

      const { data: row } = await adminClient
        .from("tasks")
        .select("assignee_id, priority, due_date")
        .eq("id", taskA)
        .single();
      expect(row?.priority).toBe("low");
      expect(row?.assignee_id).toBe(assigneeUserId);
      expect(row?.due_date).toBe("2026-11-01");
    });

    it("AS-341: a task in a private project the caller isn't a member of is rejected, while a permitted task in the same call still succeeds", async () => {
      const { bulkUpdateTasks } = await import("@/lib/actions/tasks");
      const permittedTask = await makeTask(projectId);
      const forbiddenTask = await makeTask(privateProjectId);

      // memberUserId is an active member of the workspace (so the
      // permitted, workspace-visible task's update should succeed) but has
      // no project_members row for the private project the forbidden task
      // lives in.
      currentTestUserId = memberUserId;

      const result = await bulkUpdateTasks([permittedTask, forbiddenTask], {
        priority: "urgent",
      });

      // AS-341: one forbidden task does NOT fail the whole batch — the
      // call still returns ok:true, with the permitted task succeeding and
      // the forbidden one excluded/reported.
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.succeededIds).toEqual([permittedTask]);
      expect(result.data.failedIds).toHaveLength(1);
      expect(result.data.failedIds[0]?.id).toBe(forbiddenTask);

      const { data: permittedRow } = await adminClient
        .from("tasks")
        .select("priority")
        .eq("id", permittedTask)
        .single();
      expect(permittedRow?.priority).toBe("urgent");

      // Side effect check: the forbidden task's priority was never
      // touched.
      const { data: forbiddenRow } = await adminClient
        .from("tasks")
        .select("priority")
        .eq("id", forbiddenTask)
        .single();
      expect(forbiddenRow?.priority).not.toBe("urgent");
    });

    it("AS-341: a caller who is not a member of the workspace at all gets every task rejected, not a whole-call throw", async () => {
      const { bulkUpdateTasks } = await import("@/lib/actions/tasks");
      const taskA = await makeTask();
      const taskB = await makeTask();

      currentTestUserId = outsiderUserId;

      const result = await bulkUpdateTasks([taskA, taskB], {
        priority: "urgent",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.succeededIds).toEqual([]);
      expect(result.data.failedIds).toHaveLength(2);

      const { data: rows } = await adminClient
        .from("tasks")
        .select("priority")
        .in("id", [taskA, taskB]);
      expect(rows?.every((row) => row.priority !== "urgent")).toBe(true);
    });

    it("AS-341: a viewer (read-only role) has every selected task rejected", async () => {
      const { bulkUpdateTasks } = await import("@/lib/actions/tasks");
      const taskA = await makeTask();

      currentTestUserId = viewerUserId;

      const result = await bulkUpdateTasks([taskA], { priority: "urgent" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.succeededIds).toEqual([]);
      expect(result.data.failedIds).toHaveLength(1);

      const { data: row } = await adminClient
        .from("tasks")
        .select("priority")
        .eq("id", taskA)
        .single();
      expect(row?.priority).not.toBe("urgent");
    });

    it("rejects an unauthenticated caller", async () => {
      const { bulkUpdateTasks } = await import("@/lib/actions/tasks");
      const taskA = await makeTask();

      currentTestUserId = null;

      const result = await bulkUpdateTasks([taskA], { priority: "urgent" });
      expect(result.ok).toBe(false);
    });

    it("rejects an empty task list at the validation boundary", async () => {
      const { bulkUpdateTasks } = await import("@/lib/actions/tasks");
      currentTestUserId = memberUserId;

      const result = await bulkUpdateTasks([], { priority: "urgent" });
      expect(result.ok).toBe(false);
    });

    it("rejects a list longer than the 200-id cap at the validation boundary", async () => {
      const { bulkUpdateTasks } = await import("@/lib/actions/tasks");
      currentTestUserId = memberUserId;

      const tooMany = Array.from({ length: 201 }, (_, i) =>
        // Deterministic, valid-shaped UUIDs — the cap is checked before any
        // DB lookup, so these never need to resolve to real rows.
        `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      );

      const result = await bulkUpdateTasks(tooMany, { priority: "urgent" });
      expect(result.ok).toBe(false);
    });

    it("rejects an update payload with no fields set", async () => {
      const { bulkUpdateTasks } = await import("@/lib/actions/tasks");
      const taskA = await makeTask();
      currentTestUserId = memberUserId;

      const result = await bulkUpdateTasks([taskA], {});
      expect(result.ok).toBe(false);
    });
  },
);
