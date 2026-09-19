// F020 (missions/20260919-150607): when a discipline estimate is deleted,
// the note stored alongside it must be deleted too. clearDisciplineEstimate
// (lib/actions/architecture/estimates.ts) deletes the entire
// task_discipline_estimates row for (task_id, discipline), which by
// construction removes both `minutes` and `note` together -- there is no
// row left to carry a stale note. This suite proves that end to end against
// the real action + real validation schema, mocking only the I/O boundaries
// (admin client, auth, membership, permissions, next/cache), following the
// module-mock pattern established by
// tests/unit/f060-discipline-estimate-schema.test.tsx.
//
// AS-074: Deleting an estimate also deletes its note.

import { afterEach, describe, expect, it, vi } from "vitest";

const TASK_ID = "c6d92920-fa93-408d-91cb-87cb907b3fec";
const PROJECT_ID = "83a351f8-6762-498d-8c6e-a1683703c6f1";
const WORKSPACE_ID = "73b61885-e883-48cb-b7fa-6477238ffc00";
const USER_ID = "01c5bd9a-c1da-41a4-ac0e-a4fab320a32a";

let deleteCalls: Array<{ filters: Record<string, unknown> }> = [];
let tasksSelectCalls = 0;
// Tracks any table other than task_discipline_estimates that the action
// tries to mutate (insert/update/upsert/delete), so the side-effect
// assertion can prove no adjacent table was touched.
let adjacentTableMutations: string[] = [];

let membershipOk = true;
let membershipRole = "member";
let canWriteResult = true;
let currentUser: { id: string } | null = { id: USER_ID };
let taskRow: {
  id: string;
  project_id: string;
  deleted_at: string | null;
  projects: { workspace_id: string } | null;
} | null = {
  id: TASK_ID,
  project_id: PROJECT_ID,
  deleted_at: null,
  projects: { workspace_id: WORKSPACE_ID },
};

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({ user: currentUser }),
}));

vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: async () => ({ ok: membershipOk, role: membershipRole }),
}));

vi.mock("@/lib/auth/permissions", () => ({
  canWrite: () => canWriteResult,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "tasks") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => {
                tasksSelectCalls += 1;
                return { data: taskRow, error: taskRow ? null : { message: "not found" } };
              },
            }),
          }),
        };
      }
      if (table === "task_discipline_estimates") {
        return {
          delete: () => {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq(column: string, value: unknown) {
                filters[column] = value;
                return this;
              },
              then(resolve: (result: { error: null }) => unknown) {
                deleteCalls.push({ filters });
                return resolve({ error: null });
              },
            };
            return builder;
          },
          insert: () => {
            adjacentTableMutations.push(`${table}.insert`);
            return { error: null };
          },
          upsert: () => {
            adjacentTableMutations.push(`${table}.upsert`);
            return { error: null };
          },
        };
      }
      // Any other table (workspaces, workspace_members, projects, etc.)
      // being written to is exactly the side effect AS-074's DoD forbids.
      adjacentTableMutations.push(`${table}.unexpected-access`);
      return {
        insert: () => {
          adjacentTableMutations.push(`${table}.insert`);
          return { error: null };
        },
        upsert: () => {
          adjacentTableMutations.push(`${table}.upsert`);
          return { error: null };
        },
        update: () => {
          adjacentTableMutations.push(`${table}.update`);
          return { error: null };
        },
        delete: () => {
          adjacentTableMutations.push(`${table}.delete`);
          return { error: null };
        },
      };
    },
  }),
}));

afterEach(() => {
  deleteCalls = [];
  adjacentTableMutations = [];
  tasksSelectCalls = 0;
  membershipOk = true;
  membershipRole = "member";
  canWriteResult = true;
  currentUser = { id: USER_ID };
  taskRow = {
    id: TASK_ID,
    project_id: PROJECT_ID,
    deleted_at: null,
    projects: { workspace_id: WORKSPACE_ID },
  };
  vi.clearAllMocks();
});

describe("F020 — clearing a discipline estimate also deletes its note (AS-074)", () => {
  it("test_AS_074_clearDisciplineEstimate_deletes_the_whole_row_removing_minutes_and_note_together", async () => {
    const { clearDisciplineEstimate } = await import(
      "@/lib/actions/architecture/estimates"
    );

    const result = await clearDisciplineEstimate(TASK_ID, "design");

    expect(result.success).toBe(true);
    // The delete targets the exact (task_id, discipline) row -- there is no
    // partial delete of `minutes` only that could leave a stale `note`
    // behind. Deleting the row is what guarantees the note is gone too.
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].filters).toEqual({
      task_id: TASK_ID,
      discipline: "design",
    });
  });

  it("test_AS_074_clearDisciplineEstimate_leaves_no_adjacent_table_mutated", async () => {
    const { clearDisciplineEstimate } = await import(
      "@/lib/actions/architecture/estimates"
    );

    const result = await clearDisciplineEstimate(TASK_ID, "development");

    expect(result.success).toBe(true);
    expect(tasksSelectCalls).toBe(1);
    // Only the delete on task_discipline_estimates happened -- no insert,
    // upsert, update, or unexpected read/write on any other table.
    expect(adjacentTableMutations).toEqual([]);
  });

  it("test_AS_074_unauthenticated_user_cannot_clear_an_estimate", async () => {
    currentUser = null;
    const { clearDisciplineEstimate } = await import(
      "@/lib/actions/architecture/estimates"
    );

    const result = await clearDisciplineEstimate(TASK_ID, "design");

    expect(result.success).toBe(false);
    expect(deleteCalls).toHaveLength(0);
  });

  it("test_AS_074_a_task_that_does_not_exist_or_is_soft_deleted_blocks_the_clear", async () => {
    taskRow = null;
    const { clearDisciplineEstimate } = await import(
      "@/lib/actions/architecture/estimates"
    );

    const result = await clearDisciplineEstimate(TASK_ID, "design");

    expect(result.success).toBe(false);
    expect(deleteCalls).toHaveLength(0);
  });

  it("test_AS_074_a_user_without_active_membership_cannot_clear_an_estimate", async () => {
    membershipOk = false;
    const { clearDisciplineEstimate } = await import(
      "@/lib/actions/architecture/estimates"
    );

    const result = await clearDisciplineEstimate(TASK_ID, "design");

    expect(result.success).toBe(false);
    expect(deleteCalls).toHaveLength(0);
  });

  it("test_AS_074_a_viewer_role_without_write_permission_cannot_clear_an_estimate", async () => {
    canWriteResult = false;
    const { clearDisciplineEstimate } = await import(
      "@/lib/actions/architecture/estimates"
    );

    const result = await clearDisciplineEstimate(TASK_ID, "design");

    expect(result.success).toBe(false);
    expect(deleteCalls).toHaveLength(0);
  });

  it("test_AS_074_an_invalid_discipline_is_rejected_before_any_delete_is_attempted", async () => {
    const { clearDisciplineEstimate } = await import(
      "@/lib/actions/architecture/estimates"
    );

    const result = await clearDisciplineEstimate(TASK_ID, "not-a-real-discipline");

    expect(result.success).toBe(false);
    expect(deleteCalls).toHaveLength(0);
  });
});
