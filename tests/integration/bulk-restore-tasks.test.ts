// Integration test for F190 (AS-345), run against the real linked Supabase
// project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/bulk-delete-tasks.test.ts (F187), this feature's own
// sibling action, and calls the real `bulkDeleteTasks` then `bulkRestoreTasks`
// pair to prove the undo genuinely restores the rows (not just that a toast
// disappeared).
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
  vi,
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
    "F190: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    // Matches bulkDeleteTasks/restoreTask's own non-fatal try/catch around
    // revalidatePath outside a real request context — this must not throw
    // the whole action.
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
    channel: () => ({
      send: async () => {},
    }),
    removeChannel: async () => {},
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "bulkRestoreTasks (F190: AS-345)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let authorUserId: string;
    let memberUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F190 Test Workspace",
          slug: `f190-tasks-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const authorEmail = `f190-author-${uniqueSuffix}@example.com`;
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

      const memberEmail = `f190-member-${uniqueSuffix}@example.com`;
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
        ]);
      if (memberInsertErr) {
        throw new Error(`Failed to seed members: ${memberInsertErr.message}`);
      }

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F190 Project ${uniqueSuffix}`,
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

    async function makeTask(): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F190 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: authorUserId,
          status: "todo",
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    it("AS-345: restores every task deleted in a single bulkDeleteTasks call, in one bulkRestoreTasks call", async () => {
      const { bulkDeleteTasks, bulkRestoreTasks } = await import(
        "@/lib/actions/tasks"
      );
      const taskA = await makeTask();
      const taskB = await makeTask();
      const taskC = await makeTask();

      currentTestUserId = memberUserId;

      const deleteResult = await bulkDeleteTasks([taskA, taskB, taskC]);
      expect(deleteResult.ok).toBe(true);
      if (!deleteResult.ok) return;
      expect(new Set(deleteResult.data.succeededIds)).toEqual(
        new Set([taskA, taskB, taskC]),
      );

      // The whole batch is genuinely gone (not just visually) before undo.
      const { data: deletedRows } = await adminClient
        .from("tasks")
        .select("id, deleted_at")
        .in("id", [taskA, taskB, taskC]);
      expect(deletedRows?.every((row) => row.deleted_at !== null)).toBe(true);

      // A single Undo click fires exactly one bulkRestoreTasks call with
      // every succeeded id from the delete (mirrors bulk-delete-action.tsx's
      // real onUndo wiring).
      const restoreResult = await bulkRestoreTasks(
        deleteResult.data.succeededIds,
      );
      expect(restoreResult.ok).toBe(true);
      if (!restoreResult.ok) return;
      expect(new Set(restoreResult.data.succeededIds)).toEqual(
        new Set([taskA, taskB, taskC]),
      );
      expect(restoreResult.data.failedIds).toEqual([]);

      // Genuinely restored, not merely a toast disappearing: every row's
      // deleted_at is cleared again.
      const { data: restoredRows } = await adminClient
        .from("tasks")
        .select("id, deleted_at, status")
        .in("id", [taskA, taskB, taskC]);
      expect(restoredRows?.every((row) => row.deleted_at === null)).toBe(
        true,
      );
      expect(restoredRows?.every((row) => row.status === "todo")).toBe(true);
    });

    it("AS-345: one id already restored (double-undo) does not fail the rest of the batch", async () => {
      const { bulkDeleteTasks, bulkRestoreTasks, restoreTask } = await import(
        "@/lib/actions/tasks"
      );
      const taskA = await makeTask();
      const taskB = await makeTask();

      currentTestUserId = memberUserId;

      const deleteResult = await bulkDeleteTasks([taskA, taskB]);
      expect(deleteResult.ok).toBe(true);
      if (!deleteResult.ok) return;

      // Simulate taskA already having been restored independently before
      // the batch undo fires (e.g. a double-click race) — its own restore
      // is idempotent-safe (reported as a per-id failure, not a thrown
      // error or a duplicate row), while taskB in the same call still
      // succeeds.
      const firstRestore = await restoreTask(taskA);
      expect(firstRestore.ok).toBe(true);

      const batchRestore = await bulkRestoreTasks([taskA, taskB]);
      expect(batchRestore.ok).toBe(true);
      if (!batchRestore.ok) return;
      expect(batchRestore.data.succeededIds).toEqual([taskB]);
      expect(batchRestore.data.failedIds).toHaveLength(1);
      expect(batchRestore.data.failedIds[0]?.id).toBe(taskA);

      const { data: rows } = await adminClient
        .from("tasks")
        .select("id, deleted_at")
        .in("id", [taskA, taskB]);
      expect(rows?.every((row) => row.deleted_at === null)).toBe(true);
    });

    it("an unauthenticated caller has every id reported as a per-id failure (restoreTask's own auth check), not a thrown error", async () => {
      // bulkRestoreTasks deliberately has no separate top-level auth check
      // of its own — it delegates entirely to restoreTask per id (see
      // bulkRestoreTasks's own doc comment on why: reusing the one correct
      // implementation rather than a second, parallel one), so an
      // unauthenticated caller surfaces as every id failing individually,
      // the same discriminated-union shape as any other per-id rejection.
      const { bulkRestoreTasks } = await import("@/lib/actions/tasks");
      const taskA = await makeTask();

      currentTestUserId = null;

      const result = await bulkRestoreTasks([taskA]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.succeededIds).toEqual([]);
      expect(result.data.failedIds).toHaveLength(1);
      expect(result.data.failedIds[0]?.id).toBe(taskA);
    });

    it("rejects an empty id list at the validation boundary, mirroring bulkDeleteTasks", async () => {
      const { bulkRestoreTasks } = await import("@/lib/actions/tasks");
      currentTestUserId = memberUserId;

      const result = await bulkRestoreTasks([]);
      expect(result.ok).toBe(false);
    });
  },
);
