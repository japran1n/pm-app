// Integration test for F046 (AS-070, AS-078, AS-079, AS-080), run against
// the real linked Supabase project — mirrors the loadDotEnv/skipIf pattern
// established by tests/integration/move-task-status.test.ts.
//
// `@/lib/supabase/server`'s `createClient()` is mocked to stand in for the
// Next.js request-scoped server client, resolving `auth.getUser()` to a real
// throwaway Supabase Auth user for the current test.

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
  "reorderTask (F046: AS-070, AS-078, AS-079, AS-080)",
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
    let outsiderUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F046 Test Workspace",
          slug: `f046-tasks-${uniqueSuffix}`,
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
          name: "F046 Other Workspace",
          slug: `f046-other-${uniqueSuffix}`,
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

      // Active member of `workspaceId` — the caller in the happy-path tests.
      const memberEmail = `f046-member-${uniqueSuffix}@example.com`;
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(
          `Failed to create member user: ${memberAuthErr?.message}`,
        );
      }
      memberUserId = memberAuth.user.id;
      createdUserIds.push(memberUserId);

      // A member of a *different* workspace only — never a member of
      // `workspaceId`. Used as a non-member caller (negative case).
      const outsiderEmail = `f046-outsider-${uniqueSuffix}@example.com`;
      const { data: outsiderAuth, error: outsiderAuthErr } =
        await adminClient.auth.admin.createUser({
          email: outsiderEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (outsiderAuthErr || !outsiderAuth.user) {
        throw new Error(
          `Failed to create outsider user: ${outsiderAuthErr?.message}`,
        );
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
          name: `F046 Project ${uniqueSuffix}`,
          created_by: memberUserId,
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      projectId = proj.id;
      createdProjectIds.push(projectId);
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

    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      for (const taskId of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", taskId);
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
    });

    async function makeTask(
      status = "todo",
      position = 1000,
    ): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F046 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: memberUserId,
          status,
          position,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    it("AS-070/AS-078: an active workspace member can reorder a task within a column — position updates, status untouched", async () => {
      const { reorderTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask("todo", 1000);

      currentTestUserId = memberUserId;

      const result = await reorderTask(taskId, 500);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.position).toBe(500);

      const { data: row } = await adminClient
        .from("tasks")
        .select("position, status")
        .eq("id", taskId)
        .single();
      expect(row?.position).toBe(500);
      expect(row?.status).toBe("todo");
    });

    it("AS-080: a position-only reorder does NOT change updated_at, but a status-changing move DOES", async () => {
      const { reorderTask, moveTaskStatus } = await import(
        "@/lib/actions/tasks"
      );
      const taskId = await makeTask("todo", 1000);

      const { data: before } = await adminClient
        .from("tasks")
        .select("updated_at")
        .eq("id", taskId)
        .single();

      // Small delay so a bumped updated_at would be observably different
      // from the original timestamp.
      await new Promise((resolve) => setTimeout(resolve, 1100));

      currentTestUserId = memberUserId;

      const reorderResult = await reorderTask(taskId, 250);
      expect(reorderResult.ok).toBe(true);

      const { data: afterReorder } = await adminClient
        .from("tasks")
        .select("updated_at, position")
        .eq("id", taskId)
        .single();
      expect(afterReorder?.position).toBe(250);
      expect(afterReorder?.updated_at).toBe(before?.updated_at);

      const moveResult = await moveTaskStatus(taskId, "in_progress");
      expect(moveResult.ok).toBe(true);

      const { data: afterMove } = await adminClient
        .from("tasks")
        .select("updated_at, status")
        .eq("id", taskId)
        .single();
      expect(afterMove?.status).toBe("in_progress");
      expect(afterMove?.updated_at).not.toBe(before?.updated_at);
    });

    it("AS-079: a newly created task is appended to the end of its column", async () => {
      const { createTask } = await import("@/lib/actions/tasks");
      const firstTaskId = await makeTask("in_review", 1000);

      currentTestUserId = memberUserId;

      const result = await createTask(
        projectId,
        `F046 Appended Task ${Date.now()}`,
        null,
        "in_review",
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdTaskIds.push(result.data.id);

      expect(result.data.position).toBeGreaterThan(1000);

      const { data: firstRow } = await adminClient
        .from("tasks")
        .select("position")
        .eq("id", firstTaskId)
        .single();
      expect(result.data.position).toBeGreaterThan(firstRow!.position);
    });

    it("AS-084: a caller with only the 'member' role (not owner/admin) CAN successfully reorder a task — board interaction is not permission-gated beyond workspace membership", async () => {
      const { reorderTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask("todo", 1000);

      // memberUserId was seeded above with role: "member" (never owner/admin).
      currentTestUserId = memberUserId;

      const result = await reorderTask(taskId, 750);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.position).toBe(750);

      const { data: row } = await adminClient
        .from("tasks")
        .select("position")
        .eq("id", taskId)
        .single();
      expect(row?.position).toBe(750);
    });

    it("a caller who is not a member of the task's workspace cannot reorder the task", async () => {
      const { reorderTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask("todo", 1000);

      currentTestUserId = outsiderUserId;

      const result = await reorderTask(taskId, 500);

      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("tasks")
        .select("position")
        .eq("id", taskId)
        .single();
      expect(row?.position).toBe(1000);
    });

    it("a non-finite position value is rejected before reaching the database", async () => {
      const { reorderTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask("todo", 1000);

      currentTestUserId = memberUserId;

      const result = await reorderTask(taskId, Number.NaN);

      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("tasks")
        .select("position")
        .eq("id", taskId)
        .single();
      expect(row?.position).toBe(1000);
    });
  },
);
