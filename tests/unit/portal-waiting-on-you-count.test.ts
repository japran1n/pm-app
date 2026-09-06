// F085 (missions/20260903-portal audit, defect 2): unit coverage for
// `getPortalWaitingOnYouCount` (lib/queries/portal.ts) -- the Overview
// tile's own union of what's actually waiting on a client: open
// approvals (owned decision types), pending-approval tasks, and past-due
// deliverables, deduped so a task-subject approval and its
// `pending_client_approval` task row are never counted twice.
//
// Self-contained mock (not the shared tests/unit/portal-overview-
// queries.test.ts fixture) -- this function reads `tasks` and
// `approval_requests` for actual ROWS (subject_type/subject_id), not the
// head-count shape `getPortalBadgeCounts` needs, so it gets its own
// narrow mock rather than overloading that file's shared table branches
// with a second, incompatible response shape.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;

let currentUserId: string | null;
let taskRows: Row[];
let taskError: { message: string } | null;
let ownerRows: Row[];
let ownerError: { message: string } | null;
let approvalRows: Row[];
let approvalError: { message: string } | null;
let deliverableRows: Row[];
let deliverableError: { message: string } | null;
let accountRows: Row[];
let accountError: { message: string } | null;

function applyEq(rows: Row[], filters: [string, unknown][]): Row[] {
  return rows.filter((row) => filters.every(([col, val]) => row[col] === val));
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: currentUserId ? { id: currentUserId } : null },
      })),
    },
    from: vi.fn((table: string) => {
      if (table === "tasks") {
        return {
          select: vi.fn(() => {
            const filters: [string, unknown][] = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push([col, val]);
                return builder;
              }),
              is: vi.fn((col: string, val: unknown) => {
                filters.push([col, val]);
                return builder;
              }),
              order: vi.fn(async () => {
                if (taskError) return { data: null, error: taskError };
                return { data: applyEq(taskRows, filters), error: null };
              }),
            };
            return builder;
          }),
        };
      }
      if (table === "project_decision_owners") {
        return {
          select: vi.fn(() => {
            const filters: [string, unknown][] = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push([col, val]);
                return builder;
              }),
              then: (resolve: (v: { data: Row[] | null; error: unknown }) => void) => {
                if (ownerError) {
                  resolve({ data: null, error: ownerError });
                  return;
                }
                resolve({ data: applyEq(ownerRows, filters), error: null });
              },
            };
            return builder;
          }),
        };
      }
      if (table === "approval_requests") {
        return {
          select: vi.fn(() => {
            const filters: [string, unknown][] = [];
            const inFilters: [string, unknown[]][] = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push([col, val]);
                return builder;
              }),
              in: vi.fn(async (col: string, vals: unknown[]) => {
                inFilters.push([col, vals]);
                if (approvalError) return { data: null, error: approvalError };
                const rows = applyEq(approvalRows, filters).filter((row) =>
                  inFilters.every(([c, v]) => v.includes(row[c])),
                );
                return { data: rows, error: null };
              }),
            };
            return builder;
          }),
        };
      }
      if (table === "client_deliverables") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async (col: string, val: unknown) => {
              if (deliverableError) return { data: null, error: deliverableError };
              return { data: applyEq(deliverableRows, [[col, val]]), error: null };
            }),
          })),
        };
      }
      if (table === "project_accounts") {
        return {
          select: vi.fn(() => {
            const filters: [string, unknown][] = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push([col, val]);
                return builder;
              }),
              then: (resolve: (v: { data: Row[] | null; error: unknown }) => void) => {
                if (accountError) {
                  resolve({ data: null, error: accountError });
                  return;
                }
                resolve({ data: applyEq(accountRows, filters), error: null });
              },
            };
            return builder;
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

import { getPortalWaitingOnYouCount } from "@/lib/queries/portal";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  currentUserId = USER_ID;
  taskRows = [];
  taskError = null;
  ownerRows = [];
  ownerError = null;
  approvalRows = [];
  approvalError = null;
  deliverableRows = [];
  deliverableError = null;
  accountRows = [];
  accountError = null;
});

describe("getPortalWaitingOnYouCount (F085, missions/20260903-portal audit, defect 2)", () => {
  it("test_AS_085_unions_pending_tasks_owned_approvals_and_past_due_deliverables", async () => {
    taskRows = [
      { id: "task-1", project_id: PROJECT_ID, pending_client_approval: true, client_visible: true, deleted_at: null },
    ];
    ownerRows = [{ project_id: PROJECT_ID, user_id: USER_ID, decision_type: "brand" }];
    approvalRows = [
      // A doc-subject approval — the exact case the audit named as
      // present in the badge and absent from the old task-only tile.
      { id: "appr-1", project_id: PROJECT_ID, state: "pending", decision_type: "brand", subject_type: "doc", subject_id: "doc-1" },
    ];
    deliverableRows = [{ id: "del-1", project_id: PROJECT_ID, state: "in_progress", due_at: "2000-01-01" }];

    const result = await getPortalWaitingOnYouCount(PROJECT_ID);

    // 1 pending task + 1 doc-subject approval + 1 past-due deliverable.
    expect(result).toEqual({ ok: true, data: 3 });
  });

  // The dedup case: a task-subject approval keeps `pending_client_approval`
  // true on its task for exactly as long as it is open -- counting both
  // the task row AND the approval row would double-count one obligation.
  it("test_AS_085_a_task_subject_approval_and_its_pending_task_count_once", async () => {
    taskRows = [
      { id: "task-1", project_id: PROJECT_ID, pending_client_approval: true, client_visible: true, deleted_at: null },
    ];
    ownerRows = [{ project_id: PROJECT_ID, user_id: USER_ID, decision_type: "brand" }];
    approvalRows = [
      { id: "appr-1", project_id: PROJECT_ID, state: "pending", decision_type: "brand", subject_type: "task", subject_id: "task-1" },
    ];

    const result = await getPortalWaitingOnYouCount(PROJECT_ID);

    expect(result).toEqual({ ok: true, data: 1 });
  });

  it("test_AS_085_owning_no_decision_type_still_counts_pending_tasks_and_past_due_deliverables", async () => {
    taskRows = [
      { id: "task-1", project_id: PROJECT_ID, pending_client_approval: true, client_visible: true, deleted_at: null },
    ];
    ownerRows = [];
    deliverableRows = [{ id: "del-1", project_id: PROJECT_ID, state: "in_progress", due_at: "2000-01-01" }];

    const result = await getPortalWaitingOnYouCount(PROJECT_ID);

    expect(result).toEqual({ ok: true, data: 2 });
  });

  it("returns 0, honestly, when nothing is waiting", async () => {
    const result = await getPortalWaitingOnYouCount(PROJECT_ID);
    expect(result).toEqual({ ok: true, data: 0 });
  });

  it("reports a failed read instead of a fabricated number", async () => {
    taskError = { message: "boom" };
    const result = await getPortalWaitingOnYouCount(PROJECT_ID);
    expect(result).toEqual({ ok: false, error: "boom" });
  });
});
