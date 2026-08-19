// Integration test for F149 (AS-267, AS-268), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/delete-task.test.ts and tests/integration/db-subtasks.test.ts.
//
// Covers:
//   - AS-267: deleting a parent task soft-deletes its children too, via
//     the atomic `cascade_delete_task` RPC
//     (supabase/migrations/20260819071821_subtask_cascade_delete.sql)
//     called from `deleteTask` (lib/actions/tasks.ts). Also covers cascade
//     PROVENANCE (`deleted_via_task_id`) so a child deleted independently
//     BEFORE its parent is distinguishable from one deleted AS PART OF the
//     parent's cascade — the exact distinction F189's future restore
//     feature needs.
//   - AS-268: a child task can be promoted to a top-level task via
//     `promoteSubtask` (lib/actions/tasks.ts), including the "position
//     stays valid" check called out by the worker brief and the Q6
//     no-op-on-already-top-level default from
//     missions/20260818-213033/clarifications/F149-clarification.md.
//
// `@/lib/supabase/server`'s `createClient()` is mocked to stand in for the
// Next.js request-scoped server client, resolving `auth.getUser()` to a real
// throwaway Supabase Auth user for the current test.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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
  "F149 subtask create, promote, cascade delete (AS-267, AS-268)",
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
          name: "F149 Test Workspace",
          slug: `f149-tasks-${uniqueSuffix}`,
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
          name: "F149 Other Workspace",
          slug: `f149-other-${uniqueSuffix}`,
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

      const memberEmail = `f149-member-${uniqueSuffix}@example.com`;
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

      // A member of a *different* workspace only — never a member of
      // `workspaceId`. Used as a non-member caller (negative case).
      const outsiderEmail = `f149-outsider-${uniqueSuffix}@example.com`;
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
          name: `F149 Project ${uniqueSuffix}`,
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
      if (createdTaskIds.length > 0) {
        await adminClient.from("tasks").delete().in("id", createdTaskIds);
      }
      if (createdProjectIds.length > 0) {
        await adminClient
          .from("projects")
          .delete()
          .in("id", createdProjectIds);
      }
      if (createdWorkspaceIds.length > 0) {
        await adminClient
          .from("workspace_members")
          .delete()
          .in("workspace_id", createdWorkspaceIds);
        await adminClient
          .from("workspaces")
          .delete()
          .in("id", createdWorkspaceIds);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    }, 30000);

    async function makeParentTask(titlePrefix: string): Promise<string> {
      currentTestUserId = memberUserId;
      const { createTask } = await import("@/lib/actions/tasks");
      const result = await createTask(
        projectId,
        `${titlePrefix} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      );
      if (!result.ok) {
        throw new Error(`Failed to seed parent task: ${result.error}`);
      }
      createdTaskIds.push(result.data.id);
      return result.data.id;
    }

    async function makeChildTask(
      parentTaskId: string,
      titlePrefix: string,
    ): Promise<{ id: string; position: number }> {
      currentTestUserId = memberUserId;
      const { createTask } = await import("@/lib/actions/tasks");
      const result = await createTask(
        projectId,
        `${titlePrefix} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        null,
        "todo",
        null,
        null,
        null,
        parentTaskId,
      );
      if (!result.ok) {
        throw new Error(`Failed to seed child task: ${result.error}`);
      }
      createdTaskIds.push(result.data.id);
      expect(result.data.parentTaskId).toBe(parentTaskId);
      return { id: result.data.id, position: result.data.position };
    }

    async function fetchTaskRow(taskId: string) {
      const { data, error } = await adminClient
        .from("tasks")
        .select(
          "id, parent_task_id, deleted_at, deleted_via_task_id, position, updated_at",
        )
        .eq("id", taskId)
        .single();
      if (error || !data) {
        throw new Error(`Failed to fetch task row: ${error?.message}`);
      }
      return data;
    }

    // -----------------------------------------------------------------
    // AS-267: deleting a parent task soft-deletes its children too.
    // -----------------------------------------------------------------
    describe("AS-267", () => {
      it("test_AS_267_deleting_a_parent_task_soft_deletes_its_live_children_in_one_cascade", async () => {
        const { deleteTask } = await import("@/lib/actions/tasks");

        const parentId = await makeParentTask("F149 Cascade Parent");
        const child = await makeChildTask(parentId, "F149 Cascade Child");

        currentTestUserId = memberUserId;
        const result = await deleteTask(parentId);

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const parentRow = await fetchTaskRow(parentId);
        const childRow = await fetchTaskRow(child.id);

        // Parent itself was deleted directly, not via a cascade — its own
        // deleted_via_task_id stays null.
        expect(parentRow.deleted_at).not.toBeNull();
        expect(parentRow.deleted_via_task_id).toBeNull();

        // Child was hidden by the cascade, with provenance recorded.
        expect(childRow.deleted_at).not.toBeNull();
        expect(childRow.deleted_via_task_id).toBe(parentId);

        // Atomicity proxy: parent and cascaded child share the exact same
        // deleted_at timestamp, which only happens if both UPDATEs ran
        // inside the same Postgres transaction/function invocation (now()
        // is stable for a whole transaction) — a two-round-trip
        // implementation calling `new Date().toISOString()` twice from
        // application code could never guarantee byte-identical values.
        expect(childRow.deleted_at).toBe(parentRow.deleted_at);

        // A standard RLS-filtered SELECT (deleted_at is null) no longer
        // returns either row — the child is gone from every view exactly
        // like the parent, not left as a visible orphan.
        const { data: visibleRows } = await adminClient
          .from("tasks")
          .select("id")
          .in("id", [parentId, child.id])
          .is("deleted_at", null);
        expect(visibleRows ?? []).toHaveLength(0);
      });

      it("test_AS_267_cascade_provenance_distinguishes_a_child_deleted_before_the_parent_from_one_cascaded_with_it", async () => {
        const { deleteTask } = await import("@/lib/actions/tasks");

        const parentId = await makeParentTask("F149 Provenance Parent");
        const earlyChild = await makeChildTask(
          parentId,
          "F149 Independently Deleted Child",
        );
        const cascadedChild = await makeChildTask(
          parentId,
          "F149 Cascaded Child",
        );

        // Delete the first child on its own, BEFORE the parent is ever
        // touched — this is a direct delete, not a cascade.
        currentTestUserId = memberUserId;
        const earlyResult = await deleteTask(earlyChild.id);
        expect(earlyResult.ok).toBe(true);

        const earlyChildRowBefore = await fetchTaskRow(earlyChild.id);
        expect(earlyChildRowBefore.deleted_at).not.toBeNull();
        expect(earlyChildRowBefore.deleted_via_task_id).toBeNull();

        // Now delete the parent — this should cascade ONLY to the still-
        // live child (cascadedChild), leaving the already-deleted child's
        // deleted_at/deleted_via_task_id exactly as they were.
        const parentResult = await deleteTask(parentId);
        expect(parentResult.ok).toBe(true);

        const earlyChildRowAfter = await fetchTaskRow(earlyChild.id);
        const cascadedChildRow = await fetchTaskRow(cascadedChild.id);

        // Still not cascade-provenance, and its deleted_at is untouched by
        // the parent's later delete (same value as before).
        expect(earlyChildRowAfter.deleted_via_task_id).toBeNull();
        expect(earlyChildRowAfter.deleted_at).toBe(
          earlyChildRowBefore.deleted_at,
        );

        // The still-live child at the time of the parent's delete WAS
        // cascaded, and carries the parent's id as provenance.
        expect(cascadedChildRow.deleted_at).not.toBeNull();
        expect(cascadedChildRow.deleted_via_task_id).toBe(parentId);

        // The two children are now distinguishable by provenance alone —
        // exactly what F189's future restore needs: restoring `parentId`
        // should only resurrect `cascadedChild`, never `earlyChild`.
        expect(earlyChildRowAfter.deleted_via_task_id).not.toBe(
          cascadedChildRow.deleted_via_task_id,
        );
      });

      it("test_AS_267_deleting_a_childless_task_does_not_error_the_cascade_is_a_harmless_no_op", async () => {
        const { deleteTask } = await import("@/lib/actions/tasks");

        const soloTaskId = await makeParentTask("F149 Solo Task");

        currentTestUserId = memberUserId;
        const result = await deleteTask(soloTaskId);

        expect(result.ok).toBe(true);
        const row = await fetchTaskRow(soloTaskId);
        expect(row.deleted_at).not.toBeNull();
        expect(row.deleted_via_task_id).toBeNull();
      });

      it("test_AS_267_negative_a_non_member_cannot_trigger_the_cascade_delete_and_children_stay_live", async () => {
        const { deleteTask } = await import("@/lib/actions/tasks");

        const parentId = await makeParentTask("F149 Guarded Parent");
        const child = await makeChildTask(parentId, "F149 Guarded Child");

        currentTestUserId = outsiderUserId;
        const result = await deleteTask(parentId);

        expect(result.ok).toBe(false);

        const parentRow = await fetchTaskRow(parentId);
        const childRow = await fetchTaskRow(child.id);
        expect(parentRow.deleted_at).toBeNull();
        expect(childRow.deleted_at).toBeNull();
      });
    });

    // -----------------------------------------------------------------
    // AS-268: a child task can be promoted to a top-level task.
    // -----------------------------------------------------------------
    describe("AS-268", () => {
      it("test_AS_268_a_child_task_can_be_promoted_to_a_top_level_task", async () => {
        const { promoteSubtask } = await import("@/lib/actions/tasks");

        const parentId = await makeParentTask("F149 Promote Parent");
        const child = await makeChildTask(parentId, "F149 Promote Child");

        currentTestUserId = memberUserId;
        const result = await promoteSubtask(child.id);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.id).toBe(child.id);
        expect(result.data.parentTaskId).toBeNull();

        const row = await fetchTaskRow(child.id);
        expect(row.parent_task_id).toBeNull();
      });

      it("test_AS_268_promoting_a_subtask_leaves_its_board_position_valid_and_unchanged", async () => {
        const { promoteSubtask } = await import("@/lib/actions/tasks");

        const parentId = await makeParentTask("F149 Position Parent");
        const child = await makeChildTask(parentId, "F149 Position Child");

        // Verify the position assigned at creation time is already a
        // real, finite fractional-index value — a subtask goes through
        // the exact same calculatePosition append-to-end logic as any
        // top-level task (lib/board/position.ts), not a hardcoded/null
        // placeholder.
        expect(Number.isFinite(child.position)).toBe(true);

        currentTestUserId = memberUserId;
        const result = await promoteSubtask(child.id);
        expect(result.ok).toBe(true);

        const row = await fetchTaskRow(child.id);

        // Promotion must not have touched position at all — it is
        // already valid within its (project, status) column and needs no
        // recomputation, only verification (per the worker brief: "verify
        // the position remains valid rather than assuming").
        expect(row.position).toBe(child.position);
        expect(Number.isFinite(row.position)).toBe(true);
      });

      it("test_AS_268_promoting_an_already_top_level_task_is_a_no_op_and_does_not_write", async () => {
        const { promoteSubtask } = await import("@/lib/actions/tasks");

        const taskId = await makeParentTask("F149 Already Top Level");
        const before = await fetchTaskRow(taskId);
        expect(before.parent_task_id).toBeNull();

        currentTestUserId = memberUserId;
        const result = await promoteSubtask(taskId);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.parentTaskId).toBeNull();

        // No-op per this feature's Q6 default: ok without writing, so
        // updated_at must be byte-identical to before the call.
        const after = await fetchTaskRow(taskId);
        expect(after.updated_at).toBe(before.updated_at);
      });

      it("test_AS_268_negative_a_non_member_of_the_workspace_cannot_promote_a_subtask", async () => {
        const { promoteSubtask } = await import("@/lib/actions/tasks");

        const parentId = await makeParentTask("F149 Guarded Promote Parent");
        const child = await makeChildTask(
          parentId,
          "F149 Guarded Promote Child",
        );

        currentTestUserId = outsiderUserId;
        const result = await promoteSubtask(child.id);

        expect(result.ok).toBe(false);

        const row = await fetchTaskRow(child.id);
        expect(row.parent_task_id).toBe(parentId);
      });

      it("test_AS_268_negative_promoting_a_nonexistent_task_is_reported_as_not_found", async () => {
        const { promoteSubtask } = await import("@/lib/actions/tasks");

        currentTestUserId = memberUserId;
        const result = await promoteSubtask(randomUUID());

        expect(result.ok).toBe(false);
      });
    });

    // -----------------------------------------------------------------
    // createTask's new optional parentTaskId (F149 setup for AS-267/
    // AS-268) — negative validation paths, since both assertions above
    // depend on createTask actually enforcing these before a subtask can
    // exist to cascade-delete or promote.
    // -----------------------------------------------------------------
    describe("createTask parentTaskId validation", () => {
      it("rejects a parentTaskId that does not exist", async () => {
        const { createTask } = await import("@/lib/actions/tasks");

        currentTestUserId = memberUserId;
        const result = await createTask(
          projectId,
          `F149 Orphan Attempt ${Date.now()}`,
          null,
          "todo",
          null,
          null,
          null,
          randomUUID(),
        );

        expect(result.ok).toBe(false);
      });

      it("rejects creating a grandchild under an existing child (one-level nesting limit)", async () => {
        const { createTask } = await import("@/lib/actions/tasks");

        const parentId = await makeParentTask("F149 Nesting Parent");
        const child = await makeChildTask(parentId, "F149 Nesting Child");

        currentTestUserId = memberUserId;
        const result = await createTask(
          projectId,
          `F149 Attempted Grandchild ${Date.now()}`,
          null,
          "todo",
          null,
          null,
          null,
          child.id,
        );

        expect(result.ok).toBe(false);
      });
    });
  },
);
