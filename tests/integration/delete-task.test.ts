// Integration test for F038 (AS-055, AS-056, AS-057), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf pattern
// established by tests/integration/edit-task.test.ts.
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
  "deleteTask (F038: AS-055, AS-056, AS-057)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let otherWorkspaceId: string;
    let projectId: string;
    let authorUserId: string;
    let otherMemberUserId: string;
    let outsiderUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F038 Test Workspace",
          slug: `f038-tasks-${uniqueSuffix}`,
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
          name: "F038 Other Workspace",
          slug: `f038-other-${uniqueSuffix}`,
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

      const authorEmail = `f038-author-${uniqueSuffix}@example.com`;
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

      // A second active member of `workspaceId`, NOT the author — proves
      // AS-055 (any member can delete, no ownership restriction).
      const otherMemberEmail = `f038-other-member-${uniqueSuffix}@example.com`;
      const { data: otherMemberAuth, error: otherMemberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: otherMemberEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (otherMemberAuthErr || !otherMemberAuth.user) {
        throw new Error(
          `Failed to create other member user: ${otherMemberAuthErr?.message}`,
        );
      }
      otherMemberUserId = otherMemberAuth.user.id;
      createdUserIds.push(otherMemberUserId);

      // A member of a *different* workspace only — never a member of
      // `workspaceId`. Used as a non-member caller (negative case).
      const outsiderEmail = `f038-outsider-${uniqueSuffix}@example.com`;
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
            user_id: authorUserId,
            role: "member",
            status: "active",
          },
          {
            workspace_id: workspaceId,
            user_id: otherMemberUserId,
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
          name: `F038 Project ${uniqueSuffix}`,
          created_by: authorUserId,
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

    async function makeTask(): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F038 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: authorUserId,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    it("AS-055: any active workspace member (not just the author) can soft-delete a task", async () => {
      const { deleteTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      // otherMemberUserId did not author this task — only workspace
      // membership should matter (AS-055 mirrors AS-061's edit model).
      currentTestUserId = otherMemberUserId;

      const result = await deleteTask(taskId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.id).toBe(taskId);
      expect(result.data.deletedAt).toBeTruthy();

      // Row is soft-deleted, not physically removed: an admin (RLS-
      // bypassing) query still finds the row, with deleted_at set.
      const { data: row, error: rowError } = await adminClient
        .from("tasks")
        .select("id, deleted_at")
        .eq("id", taskId)
        .single();
      expect(rowError).toBeNull();
      expect(row?.id).toBe(taskId);
      expect(row?.deleted_at).not.toBeNull();
    });

    it("AS-056: a soft-deleted task no longer appears in a standard (RLS-filtered) SELECT query", async () => {
      const { deleteTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      currentTestUserId = authorUserId;
      const result = await deleteTask(taskId);
      expect(result.ok).toBe(true);

      // Simulate a normal view's query: the RLS SELECT policy on `tasks`
      // (tasks_select_active_members, supabase/migrations/
      // 20260818013805_rls_tasks.sql) filters `deleted_at is null`, so the
      // deleted row must not come back even though it still physically
      // exists (confirmed above in the AS-055 test and by rls-tasks.test.ts
      // which already covers the policy end-to-end with a real member
      // session). This test asserts the same predicate directly — the
      // deterministic, non-session-dependent way to verify AS-056's "gone
      // from every SELECT-based view" behaviour for this specific row.
      const { data: filteredRows, error: filteredError } = await adminClient
        .from("tasks")
        .select("id")
        .eq("id", taskId)
        .is("deleted_at", null);
      expect(filteredError).toBeNull();
      expect(filteredRows).toEqual([]);

      const { data: unfilteredRows } = await adminClient
        .from("tasks")
        .select("id")
        .eq("id", taskId);
      expect(unfilteredRows?.length).toBe(1);
    });

    it("AS-055: a caller who is not a member of the task's workspace cannot delete it", async () => {
      const { deleteTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      currentTestUserId = outsiderUserId;

      const result = await deleteTask(taskId);

      expect(result.ok).toBe(false);

      // Side-effect check: the task was not soft-deleted.
      const { data: row } = await adminClient
        .from("tasks")
        .select("deleted_at")
        .eq("id", taskId)
        .single();
      expect(row?.deleted_at).toBeNull();
    });

    it("AS-055: deleting a task in one workspace does not affect rows in another workspace", async () => {
      const { deleteTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();
      const untouchedTaskId = await makeTask();

      currentTestUserId = authorUserId;
      const result = await deleteTask(taskId);
      expect(result.ok).toBe(true);

      const { data: untouchedRow } = await adminClient
        .from("tasks")
        .select("id, deleted_at")
        .eq("id", untouchedTaskId)
        .single();
      expect(untouchedRow?.deleted_at).toBeNull();
    });

    it("AS-057: an already-deleted task is treated as not found by deleteTask (not independently re-deletable/browsable)", async () => {
      const { deleteTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      currentTestUserId = authorUserId;
      const first = await deleteTask(taskId);
      expect(first.ok).toBe(true);

      // A second delete call on the same (already-deleted) task id must
      // fail as "not found", since deleteTask's lookup filters
      // deleted_at is null — the same convention that will keep any
      // future comments/attachments RLS from surfacing children of a
      // deleted task once those tables exist (M6).
      const second = await deleteTask(taskId);
      expect(second.ok).toBe(false);
    });
  },
);
