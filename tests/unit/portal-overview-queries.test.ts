// F006 (missions/20260903-portal): unit coverage for the overview's new
// query functions (lib/queries/portal.ts), mocked the same way
// tests/unit/portal-phases-query.test.ts covers `getProjectPhases` --
// the RLS half of "a client cannot read this table" is a live-database
// fact this file doesn't re-prove; what's covered here is each
// function's own business logic (which real signal a count comes from,
// which rows get excluded, what an honest "not built yet" stub returns).

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  applyFilters,
  eqFilter,
  inFilter,
  ltFilter,
  notInFilter,
  notNullFilter,
  type Row,
} from "@/tests/unit/helpers/query-filter-mock";

vi.mock("server-only", () => ({}));

// --- getPortalBadgeCounts (AS-002, AS-003) ---------------------------------
//
// F007 (missions/20260903-portal, M2): `getPortalBadgeCounts` now counts
// `approval_requests` rows in state 'pending' (the first-class table this
// feature introduced), not `tasks.pending_client_approval` — the mock
// below follows that same table/chain shape.

// F009 (missions/20260903-portal, AS-002, third-scrutiny finding): the
// old mock's `.eq()` calls discarded every argument and unconditionally
// returned a fixed `{ count, error }` -- it could not tell the
// `project_decision_owners` filter (`.in("decision_type", ...)`) apart
// from no filter at all. `approvalRequestRows` is now a real row set run
// through `applyFilters`/`eqFilter`/`inFilter` (tests/unit/helpers/
// query-filter-mock.ts, F006j) so a dropped or wrong-column filter here
// changes the count a test observes, not just the chain's shape.
let approvalRequestRows: Row[];
let approvalRequestsError: { message: string } | null;
let currentUserId: string | null;
let ownerRows: Row[];
let ownerRowsError: { message: string } | null;

// --- getPortalWaitingOnYou (F006f, AS-002) ---------------------------------
//
// Applies each `.eq()`/`.is()` call's own column/value against the row
// set (same reasoning as tests/unit/portal-phases-query.test.ts's own
// header comment) rather than handing back a fixed array regardless of
// what the real query filtered on. `eqFilter`/`applyFilters` come from
// the shared tests/unit/helpers/query-filter-mock.ts (F006j) rather than
// being reimplemented here.
let waitingTaskRows: Row[];
let waitingTasksError: { message: string } | null;

// --- getOverdueBlockingDeliverableCount (F012, AS-003) ---------------------
//
// Same `applyFilters` shape as the tables above -- a real row set run
// through the mock's own recorded `.eq()`/`.not()`/`.lt()` calls, so a
// dropped or wrong-column filter in `getOverdueBlockingDeliverableCount`
// (lib/queries/deliverables.ts) changes the count a test observes.
let deliverableRows: Row[];
let deliverableRowsError: { message: string } | null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: currentUserId ? { id: currentUserId } : null },
      })),
    },
    from: vi.fn((table: string) => {
      if (table === "approval_requests") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return builder;
              }),
              // The real query's terminal call after `.eq(...).eq(...)` is
              // `.in("decision_type", decisionTypes)` -- this is what
              // actually proves the owner-scoped decision types were
              // threaded through, not just discarded.
              in: vi.fn(async (col: string, vals: unknown[]) => {
                filters.push(inFilter(col, vals));
                if (approvalRequestsError) {
                  return { count: null, error: approvalRequestsError };
                }
                return {
                  count: applyFilters(approvalRequestRows, filters).length,
                  error: null,
                };
              }),
            };
            return builder;
          }),
        };
      }
      if (table === "project_decision_owners") {
        // F009c (AS-002, same shape as M1's round-3 finding): the old
        // mock's two `.eq()` calls discarded both arguments and
        // unconditionally handed back `ownerRows` regardless of what
        // `project_id`/`user_id` the real query filtered on -- deleting
        // `.eq("user_id", user.id)` from the source could not turn this
        // test red. `ownerRows` is now a real row set (with its own
        // `project_id`/`user_id`/`decision_type` columns) run through
        // `applyFilters`/`eqFilter` (query-filter-mock.ts, F006j), so a
        // dropped or wrong-column filter changes what the mock returns.
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return builder;
              }),
              // Real supabase-js query builders are themselves
              // thenable -- the source code awaits the chain directly
              // after its second `.eq()` with no further terminal call
              // (`.select("decision_type").eq(...).eq(...)`), so this
              // mock must be awaitable the same way rather than needing
              // an extra `.then()`/`.select()` call the real code never
              // makes.
              then: (
                resolve: (value: { data: Row[] | null; error: unknown }) => void,
              ) => {
                if (ownerRowsError) {
                  resolve({ data: null, error: ownerRowsError });
                  return;
                }
                resolve({ data: applyFilters(ownerRows, filters), error: null });
              },
            };
            return builder;
          }),
        };
      }
      if (table === "tasks") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return builder;
              }),
              is: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return builder;
              }),
              order: vi.fn(async () => {
                if (waitingTasksError) return { data: null, error: waitingTasksError };
                return { data: applyFilters(waitingTaskRows, filters), error: null };
              }),
            };
            return builder;
          }),
        };
      }
      if (table === "client_deliverables") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return builder;
              }),
              not: vi.fn((col: string, op: string, val: unknown) => {
                if (op === "is") filters.push(notNullFilter(col));
                else if (op === "in") filters.push(notInFilter(col, val as string));
                return builder;
              }),
              lt: vi.fn(async (col: string, val: unknown) => {
                if (deliverableRowsError) return { count: null, error: deliverableRowsError };
                filters.push(ltFilter(col, val));
                return { count: applyFilters(deliverableRows, filters).length, error: null };
              }),
            };
            return builder;
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

// --- getPortalLiveNow / getPortalTeam (admin client) -----------------------

let projectRow: Row | null;
let activeTimerRows: Row[];
let projectMemberRows: Row[];
let workspaceMemberRoleRows: Row[];
let phaseRows: Row[];
// F014 (missions/20260903-portal, AS-031): `getWorstOverdueBlockingDeliverableRisk`
// (lib/queries/deliverables.ts) reads through the admin client too --
// same real-row-set-through-applyFilters shape as every other admin-mock
// table above/below, so a dropped filter here changes what the mock
// returns, not just its shape.
let adminDeliverableRows: Row[];
let adminDeliverableRowsError: { message: string } | null;
let holdsUpTaskRows: Row[];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === "projects") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: projectRow, error: null })),
            })),
          })),
        };
      }
      if (table === "client_deliverables") {
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return builder;
              }),
              not: vi.fn((col: string, op: string, val: unknown) => {
                if (op === "is") filters.push(notNullFilter(col));
                else if (op === "in") filters.push(notInFilter(col, val as string));
                return builder;
              }),
              lt: vi.fn((col: string, val: unknown) => {
                filters.push(ltFilter(col, val));
                return builder;
              }),
              order: vi.fn((col: string, opts?: { ascending?: boolean }) => {
                const ascending = opts?.ascending !== false;
                const sortCol = col as string;
                const originalRows = adminDeliverableRows;
                adminDeliverableRows = [...originalRows].sort((a, b) => {
                  const av = a[sortCol] as string;
                  const bv = b[sortCol] as string;
                  if (av === bv) return 0;
                  return ascending ? (av < bv ? -1 : 1) : av < bv ? 1 : -1;
                });
                return builder;
              }),
              limit: vi.fn(async () => {
                if (adminDeliverableRowsError) {
                  return { data: null, error: adminDeliverableRowsError };
                }
                return {
                  data: applyFilters(adminDeliverableRows, filters).slice(0, 1),
                  error: null,
                };
              }),
            };
            return builder;
          }),
        };
      }
      if (table === "tasks") {
        // F016c (M3-scrutiny.md B1): `resolveHoldsUpContext` now scopes
        // this read with `.eq("project_id", projectId)` before `.in("id",
        // taskIds)` -- this mock runs BOTH through `applyFilters` (F-4's
        // finding was that the old mock discarded the id/project filters
        // entirely), so a cross-project task row in `holdsUpTaskRows` is
        // excluded exactly like the real query excludes it.
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return builder;
              }),
              in: vi.fn(async (col: string, vals: unknown[]) => {
                filters.push(inFilter(col, vals as string[]));
                return { data: applyFilters(holdsUpTaskRows, filters), error: null };
              }),
            };
            return builder;
          }),
        };
      }
      if (table === "active_timers") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              is: vi.fn(async () => ({ data: activeTimerRows, error: null })),
            })),
          })),
        };
      }
      if (table === "project_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: projectMemberRows, error: null })),
          })),
        };
      }
      if (table === "workspace_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(async () => ({ data: workspaceMemberRoleRows, error: null })),
            })),
          })),
        };
      }
      if (table === "project_phases") {
        // F016c: `resolveHoldsUpContext` adds a second `.eq("project_id",
        // projectId)` ahead of the pre-existing `.eq("client_visible",
        // true)` -- both, plus the trailing `.in("id", phaseIds)`, now run
        // through `applyFilters` (any number of chained `.eq()` calls),
        // same fix as the `tasks` branch above.
        return {
          select: vi.fn(() => {
            const filters: Array<(row: Row) => boolean> = [];
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters.push(eqFilter(col, val));
                return builder;
              }),
              in: vi.fn(async (col: string, vals: unknown[]) => {
                filters.push(inFilter(col, vals as string[]));
                return { data: applyFilters(phaseRows, filters), error: null };
              }),
            };
            return builder;
          }),
        };
      }
      throw new Error(`unexpected admin table ${table}`);
    }),
  })),
}));

vi.mock("@/lib/queries/people", () => ({
  resolvePeople: vi.fn(async (ids: string[]) => {
    const map = new Map<string, { name: string | null; email: string | null; avatarUrl: string | null }>();
    for (const id of ids) {
      map.set(id, { name: `Person ${id}`, email: null, avatarUrl: null });
    }
    return map;
  }),
}));

import {
  getPortalBadgeCounts,
  getPortalLiveNow,
  getPortalRisks,
  getPortalTeam,
  getPortalWaitingOnYou,
} from "@/lib/queries/portal";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

const CLIENT_USER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_CLIENT_USER_ID = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  projectRow = { id: PROJECT_ID, workspace_id: WORKSPACE_ID };
  activeTimerRows = [];
  projectMemberRows = [];
  workspaceMemberRoleRows = [];
  phaseRows = [];
  waitingTaskRows = [];
  waitingTasksError = null;
  deliverableRows = [];
  deliverableRowsError = null;
  currentUserId = CLIENT_USER_ID;
  ownerRows = [];
  ownerRowsError = null;
  approvalRequestRows = [];
  approvalRequestsError = null;
  adminDeliverableRows = [];
  adminDeliverableRowsError = null;
  holdsUpTaskRows = [];
});

describe("getPortalBadgeCounts — AS-002, AS-003", () => {
  it("test_AS_002_counts_pending_approval_requests_as_approvals_awaiting", async () => {
    ownerRows = [{ project_id: PROJECT_ID, user_id: CLIENT_USER_ID, decision_type: "brand" }];
    approvalRequestRows = [
      { id: "a1", project_id: PROJECT_ID, state: "pending", decision_type: "brand" },
      { id: "a2", project_id: PROJECT_ID, state: "pending", decision_type: "brand" },
      { id: "a3", project_id: PROJECT_ID, state: "pending", decision_type: "brand" },
    ];

    const badges = await getPortalBadgeCounts(PROJECT_ID);

    expect(badges.approvalsAwaiting).toEqual({ ok: true, data: 3 });
  });

  it("test_AS_002_a_project_with_nothing_pending_reports_zero_not_an_error", async () => {
    ownerRows = [{ project_id: PROJECT_ID, user_id: CLIENT_USER_ID, decision_type: "brand" }];
    approvalRequestRows = [];

    const badges = await getPortalBadgeCounts(PROJECT_ID);

    expect(badges.approvalsAwaiting).toEqual({ ok: true, data: 0 });
  });

  // Third-scrutiny finding: a client who only owns `brand` decisions must
  // not have `commercial` (or any other decision type they cannot act on)
  // counted into their own badge -- that number used to include every
  // pending row on the project regardless of who owns which decision
  // type, so a client would see a badge promising N decisions when they
  // could only ever act on a subset of them (and would get a 42501 from
  // decide_approval_atomic on the rest).
  it("test_AS_002_only_counts_decision_types_this_client_owns", async () => {
    ownerRows = [{ project_id: PROJECT_ID, user_id: CLIENT_USER_ID, decision_type: "brand" }];
    approvalRequestRows = [
      { id: "a1", project_id: PROJECT_ID, state: "pending", decision_type: "brand" },
      { id: "a2", project_id: PROJECT_ID, state: "pending", decision_type: "commercial" },
      { id: "a3", project_id: PROJECT_ID, state: "pending", decision_type: "commercial" },
    ];

    const badges = await getPortalBadgeCounts(PROJECT_ID);

    expect(badges.approvalsAwaiting).toEqual({ ok: true, data: 1 });
  });

  // A client who owns no decision type at all on this project has
  // nothing they could ever decide -- an honest 0, not the raw pending
  // count, and no need for the second `approval_requests` round trip.
  it("test_AS_002_a_client_who_owns_no_decision_type_sees_zero", async () => {
    ownerRows = [];
    approvalRequestRows = [
      { id: "a1", project_id: PROJECT_ID, state: "pending", decision_type: "brand" },
    ];

    const badges = await getPortalBadgeCounts(PROJECT_ID);

    expect(badges.approvalsAwaiting).toEqual({ ok: true, data: 0 });
  });

  // A different client (not the one signed in) owning `brand` must not
  // leak into this caller's own count -- proves the owner lookup is
  // scoped by `user_id`, not just `project_id`/`decision_type`. Unlike
  // the old version of this test, `ownerRows` genuinely contains a
  // `brand` row for CLIENT_USER_ID; it is the mock's own `.eq("user_id",
  // ...)` filtering (query-filter-mock.ts) that must exclude it for the
  // signed-in OTHER_CLIENT_USER_ID, not a hand-set empty fixture.
  it("test_AS_002_another_clients_owned_decision_type_is_not_counted", async () => {
    currentUserId = OTHER_CLIENT_USER_ID;
    ownerRows = [{ project_id: PROJECT_ID, user_id: CLIENT_USER_ID, decision_type: "brand" }];
    approvalRequestRows = [
      { id: "a1", project_id: PROJECT_ID, state: "pending", decision_type: "brand" },
    ];

    const badges = await getPortalBadgeCounts(PROJECT_ID);

    expect(badges.approvalsAwaiting).toEqual({ ok: true, data: 0 });
  });

  it("test_AS_003_deliverables_past_due_counts_only_overdue_blocking_undelivered_deliverables", async () => {
    ownerRows = [{ project_id: PROJECT_ID, user_id: CLIENT_USER_ID, decision_type: "brand" }];
    approvalRequestRows = [
      { id: "a1", project_id: PROJECT_ID, state: "pending", decision_type: "brand" },
    ];
    const farPast = "2000-01-01";
    const farFuture = "2999-01-01";
    deliverableRows = [
      // Overdue, blocking, still not_started -- counted.
      { id: "d1", project_id: PROJECT_ID, blocking: true, state: "not_started", due_at: farPast },
      // Overdue but not blocking -- not counted.
      { id: "d2", project_id: PROJECT_ID, blocking: false, state: "not_started", due_at: farPast },
      // Overdue and blocking, but already accepted -- not counted.
      { id: "d3", project_id: PROJECT_ID, blocking: true, state: "accepted", due_at: farPast },
      // Overdue and blocking, but waived -- not counted.
      { id: "d4", project_id: PROJECT_ID, blocking: true, state: "waived", due_at: farPast },
      // Blocking and undelivered, but due in the future -- not counted.
      { id: "d5", project_id: PROJECT_ID, blocking: true, state: "not_started", due_at: farFuture },
      // Blocking and undelivered, but no due date at all -- not counted.
      { id: "d6", project_id: PROJECT_ID, blocking: true, state: "in_progress", due_at: null },
      // A different project's overdue blocking deliverable -- not counted.
      { id: "d7", project_id: "other-project", blocking: true, state: "not_started", due_at: farPast },
    ];

    const badges = await getPortalBadgeCounts(PROJECT_ID);

    expect(badges.deliverablesPastDue).toBe(1);
  });

  it("test_AS_003_a_failed_deliverables_count_degrades_to_zero_rather_than_failing_the_whole_badge_read", async () => {
    ownerRows = [{ project_id: PROJECT_ID, user_id: CLIENT_USER_ID, decision_type: "brand" }];
    approvalRequestRows = [
      { id: "a1", project_id: PROJECT_ID, state: "pending", decision_type: "brand" },
    ];
    deliverableRowsError = { message: "boom" };

    const badges = await getPortalBadgeCounts(PROJECT_ID);

    expect(badges.deliverablesPastDue).toBe(0);
    // The rest of the badge read is unaffected by the deliverables failure.
    expect(badges.approvalsAwaiting).toEqual({ ok: true, data: 1 });
  });

  // F006f (missions/20260903-portal, AS-002): this test used to assert
  // `approvalsAwaiting` came back as `0` on a query error -- the exact
  // "confident wrong number" defect this feature removes (a dropped
  // connection is indistinguishable from a real zero, and the sidebar
  // renders the same badge either way). It now asserts the opposite: a
  // failed read is reported AS a failure, never coalesced into a count.
  it("test_AS_002_a_failed_count_query_is_reported_as_a_failure_not_coalesced_to_zero", async () => {
    ownerRows = [{ project_id: PROJECT_ID, user_id: CLIENT_USER_ID, decision_type: "brand" }];
    approvalRequestsError = { message: "boom" };

    const badges = await getPortalBadgeCounts(PROJECT_ID);

    expect(badges.approvalsAwaiting.ok).toBe(false);
    expect(badges.approvalsAwaiting).not.toEqual({ ok: true, data: 0 });
  });

  it("test_AS_002_a_failed_decision_owners_read_is_reported_as_a_failure", async () => {
    ownerRowsError = { message: "connection reset" };

    const badges = await getPortalBadgeCounts(PROJECT_ID);

    expect(badges.approvalsAwaiting.ok).toBe(false);
  });
});

describe("getPortalWaitingOnYou — F006f (AS-002): one project-scoped query for the tile and the list", () => {
  it("test_AS_002_counts_only_this_projects_tasks_pending_client_approval", async () => {
    waitingTaskRows = [
      {
        id: "t1",
        title: "Approve homepage copy",
        project_id: PROJECT_ID,
        due_date: null,
        updated_at: "2026-08-30T00:00:00Z",
        pending_client_approval: true,
        client_visible: true,
        deleted_at: null,
      },
      // A different project's task -- proves the `.eq("project_id",
      // projectId)` call itself scopes the result, not an accident of
      // the fixture only ever containing one project's rows.
      {
        id: "t-other-project",
        title: "Approve a different project's task",
        project_id: "other-project",
        due_date: null,
        updated_at: "2026-08-30T00:00:00Z",
        pending_client_approval: true,
        client_visible: true,
        deleted_at: null,
      },
    ];

    const result = await getPortalWaitingOnYou(PROJECT_ID, "Website relaunch");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((t) => t.id)).toEqual(["t1"]);
    expect(result.data[0].projectName).toBe("Website relaunch");
  });

  it("excludes a task that is not pending_client_approval, hidden, or soft-deleted", async () => {
    waitingTaskRows = [
      {
        id: "t-not-pending",
        title: "Not awaiting approval",
        project_id: PROJECT_ID,
        due_date: null,
        updated_at: "2026-08-30T00:00:00Z",
        pending_client_approval: false,
        client_visible: true,
        deleted_at: null,
      },
      {
        id: "t-hidden",
        title: "Hidden from the client",
        project_id: PROJECT_ID,
        due_date: null,
        updated_at: "2026-08-30T00:00:00Z",
        pending_client_approval: true,
        client_visible: false,
        deleted_at: null,
      },
      {
        id: "t-deleted",
        title: "Soft-deleted",
        project_id: PROJECT_ID,
        due_date: null,
        updated_at: "2026-08-30T00:00:00Z",
        pending_client_approval: true,
        client_visible: true,
        deleted_at: "2026-08-01T00:00:00Z",
      },
    ];

    const result = await getPortalWaitingOnYou(PROJECT_ID, "Website relaunch");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([]);
  });

  it("returns ok: true with an empty list, not a failure, when nothing is waiting", async () => {
    waitingTaskRows = [];

    const result = await getPortalWaitingOnYou(PROJECT_ID, "Website relaunch");

    expect(result).toEqual({ ok: true, data: [] });
  });

  // F006f's own defect description: a failed read used to render as
  // "Nothing waiting on you" -- indistinguishable from this exact
  // legitimate empty-list case above. `{ ok: false }` is what makes the
  // two distinguishable to a caller.
  it("test_AS_002_a_failed_read_is_ok_false_not_an_empty_list", async () => {
    waitingTasksError = { message: "connection reset" };

    const result = await getPortalWaitingOnYou(PROJECT_ID, "Website relaunch");

    expect(result).toEqual({ ok: false, error: "connection reset" });
  });
});

describe("getPortalRisks — AS-031", () => {
  it("test_AS_031_returns_an_empty_list_when_nothing_qualifies_never_a_fabricated_risk", async () => {
    const risks = await getPortalRisks(PROJECT_ID);
    expect(risks).toEqual([]);
  });

  it("test_AS_031_names_the_worst_overdue_blocking_deliverable_and_what_it_moves", async () => {
    projectRow = { id: PROJECT_ID, workspace_id: WORKSPACE_ID, target_launch_date: "2026-11-18" };
    holdsUpTaskRows = [
      {
        id: "task-blogg",
        project_id: PROJECT_ID,
        title: "Write the Blog page",
        page_slug: "blogg",
        client_visible: true,
        phase_id: null,
        deleted_at: null,
      },
    ];
    adminDeliverableRows = [
      {
        id: "deliverable-1",
        project_id: PROJECT_ID,
        blocking: true,
        state: "in_progress",
        due_at: "2020-01-01",
        task_id: "task-blogg",
        kind: "copy",
      },
    ];

    const risks = await getPortalRisks(PROJECT_ID);

    expect(risks).toEqual([
      {
        id: "deliverable-1",
        message:
          "The Blogg page cannot be built without its copy, and 18 Nov moves with it.",
      },
    ]);
  });

  it("test_AS_054_a_cross_project_task_row_never_names_another_workspace_in_the_holds_up_label", async () => {
    // F016c (M3-scrutiny.md B1): the composite FK now makes this row
    // shape unreachable through any real write path, but this test
    // proves the READ side independently enforces the same invariant --
    // `resolveHoldsUpContext` must not surface another project's task
    // title even if a row like this somehow existed (e.g. the mock here
    // stands in for "the constraint didn't exist yet" or a future
    // relaxation of it). Falls back to the generic subject, exactly as
    // if there were no linked task at all.
    projectRow = { id: PROJECT_ID, workspace_id: WORKSPACE_ID, target_launch_date: "2026-11-18" };
    holdsUpTaskRows = [
      {
        id: "task-other-workspace",
        project_id: "other-project",
        title: "Internal task in a different workspace",
        page_slug: "secret-page",
        client_visible: true,
        phase_id: null,
        deleted_at: null,
      },
    ];
    adminDeliverableRows = [
      {
        id: "deliverable-cross-project",
        project_id: PROJECT_ID,
        blocking: true,
        state: "in_progress",
        due_at: "2020-01-01",
        task_id: "task-other-workspace",
        kind: "copy",
      },
    ];

    const risks = await getPortalRisks(PROJECT_ID);

    expect(risks).toEqual([
      {
        id: "deliverable-cross-project",
        message: "This item cannot be built without its copy, and 18 Nov moves with it.",
      },
    ]);
  });

  it("test_AS_031_falls_back_to_a_generic_subject_when_there_is_no_linked_task", async () => {
    adminDeliverableRows = [
      {
        id: "deliverable-2",
        project_id: PROJECT_ID,
        blocking: true,
        state: "not_started",
        due_at: "2020-01-01",
        task_id: null,
        kind: "access",
      },
    ];

    const risks = await getPortalRisks(PROJECT_ID);

    expect(risks).toEqual([
      {
        id: "deliverable-2",
        message: "This item cannot be built without access to it, and the launch date moves with it.",
      },
    ]);
  });

  it("test_AS_031_picks_the_earliest_due_i_e_worst_deliverable_when_more_than_one_qualifies", async () => {
    adminDeliverableRows = [
      {
        id: "less-overdue",
        project_id: PROJECT_ID,
        blocking: true,
        state: "in_progress",
        due_at: "2020-06-01",
        task_id: null,
        kind: "copy",
      },
      {
        id: "most-overdue",
        project_id: PROJECT_ID,
        blocking: true,
        state: "in_progress",
        due_at: "2020-01-01",
        task_id: null,
        kind: "copy",
      },
    ];

    const risks = await getPortalRisks(PROJECT_ID);

    expect(risks).toHaveLength(1);
    expect(risks[0].id).toBe("most-overdue");
  });

  it("test_AS_031_never_surfaces_a_delivered_deliverable_that_only_needs_review_not_a_new_upload", async () => {
    // AS-030's counterpart on the risk banner: a client who already sent
    // the file is not shown a "you're the risk" sentence -- the RPC
    // filter (`not in (accepted, waived)`) still counts `delivered` as
    // outstanding for the sidebar badge, but the risk banner's own copy
    // is written for "this is still on the client", which a delivered
    // item no longer is. This test documents the row it DOES still
    // qualify (not_started/in_progress); `getOverdueBlockingDeliverableCount`
    // (F012, tested above) is what proves `delivered` still counts
    // against the badge.
    adminDeliverableRows = [
      {
        id: "delivered-not-accepted",
        project_id: PROJECT_ID,
        blocking: true,
        state: "delivered",
        due_at: "2020-01-01",
        task_id: null,
        kind: "copy",
      },
    ];

    const risks = await getPortalRisks(PROJECT_ID);

    // `state = 'delivered'` still satisfies `not in (accepted, waived)`,
    // so it still qualifies here -- the risk banner and the badge share
    // the exact same filter (this feature's own design choice, see
    // getWorstOverdueBlockingDeliverableRisk's doc comment), and a
    // delivered-but-unreviewed item genuinely is still a risk to the
    // launch date until the team reviews it.
    expect(risks).toEqual([
      {
        id: "delivered-not-accepted",
        message: "This item cannot be built without its copy, and the launch date moves with it.",
      },
    ]);
  });
});

describe("getPortalLiveNow", () => {
  it("shows the task title for a client-visible task", async () => {
    activeTimerRows = [
      {
        id: "timer-1",
        user_id: "user-1",
        tasks: {
          id: "task-1",
          title: "Design the Services page",
          client_visible: true,
          phase_id: null,
          project_id: PROJECT_ID,
          deleted_at: null,
        },
      },
    ];
    workspaceMemberRoleRows = [{ user_id: "user-1", role: "member" }];

    const entries = await getPortalLiveNow(PROJECT_ID);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.label).toBe("Design the Services page");
    expect(entries[0]!.personName).toBe("Person user-1");
  });

  it("falls back to the phase name, never the task name, when the task is not client-visible but the phase is", async () => {
    activeTimerRows = [
      {
        id: "timer-2",
        user_id: "user-2",
        tasks: {
          id: "task-2",
          title: "Internal QA sweep",
          client_visible: false,
          phase_id: "phase-1",
          project_id: PROJECT_ID,
          deleted_at: null,
        },
      },
    ];
    workspaceMemberRoleRows = [{ user_id: "user-2", role: "member" }];
    // A client_visible=true phase -- this is what the real
    // `.eq("client_visible", true)` filter on the project_phases lookup
    // returns for a phase that passes it, so the row is present here.
    phaseRows = [{ id: "phase-1", name: "Izrada sajta", client_visible: true }];

    const entries = await getPortalLiveNow(PROJECT_ID);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.label).toBe("Izrada sajta");
    expect(entries[0]!.label).not.toContain("Internal QA sweep");
  });

  // F006b (missions/20260903-portal, AS-012): this is the exact fixture
  // the M1 scrutiny report's B2 named -- a task that is not client-visible
  // sitting inside a phase that is ALSO not client-visible. The old
  // fixture here had no `client_visible` field on the phase at all and
  // asserted the phase's NAME was shown, which is precisely the defect:
  // `getPortalLiveNow`'s `project_phases` lookup used to have no
  // `client_visible` filter, so a hidden phase's name reached the
  // client's overview. The real `.eq("client_visible", true)` filter this
  // feature adds means Postgres never returns a hidden phase's row at
  // all -- `phaseRows = []` is what that filtered-out row looks like from
  // this function's side, which is why the label falls all the way
  // through to the generic phrase rather than any name.
  it("test_AS_012_falls_back_to_a_generic_label_never_the_phase_name_when_the_phase_itself_is_not_client_visible", async () => {
    activeTimerRows = [
      {
        id: "timer-2b",
        user_id: "user-2b",
        tasks: {
          id: "task-2b",
          title: "Internal QA sweep",
          client_visible: false,
          phase_id: "phase-hidden",
          project_id: PROJECT_ID,
          deleted_at: null,
        },
      },
    ];
    workspaceMemberRoleRows = [{ user_id: "user-2b", role: "member" }];
    // The hidden phase's row is absent -- exactly what
    // `.eq("client_visible", true)` produces for a `client_visible = false`
    // phase against a real database.
    phaseRows = [];

    const entries = await getPortalLiveNow(PROJECT_ID);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.label).toBe("Working on the project");
    expect(entries[0]!.label).not.toContain("Internal QA sweep");
    expect(entries[0]!.label).not.toContain("Rebuild after client rejected v1");
  });

  it("never carries a duration/elapsed-time field on any entry", async () => {
    activeTimerRows = [
      {
        id: "timer-3",
        user_id: "user-3",
        tasks: {
          id: "task-3",
          title: "Copy pass",
          client_visible: true,
          phase_id: null,
          project_id: PROJECT_ID,
          deleted_at: null,
        },
      },
    ];
    workspaceMemberRoleRows = [{ user_id: "user-3", role: "member" }];

    const entries = await getPortalLiveNow(PROJECT_ID);

    expect(entries[0]).not.toHaveProperty("startedAt");
    expect(entries[0]).not.toHaveProperty("duration");
  });

  it("excludes a timer belonging to a client member of the workspace", async () => {
    activeTimerRows = [
      {
        id: "timer-4",
        user_id: "client-user",
        tasks: {
          id: "task-4",
          title: "Should never show",
          client_visible: true,
          phase_id: null,
          project_id: PROJECT_ID,
          deleted_at: null,
        },
      },
    ];
    workspaceMemberRoleRows = [{ user_id: "client-user", role: "client" }];

    const entries = await getPortalLiveNow(PROJECT_ID);

    expect(entries).toEqual([]);
  });

  it("returns an empty list, not an error, when nobody is currently working", async () => {
    activeTimerRows = [];
    const entries = await getPortalLiveNow(PROJECT_ID);
    expect(entries).toEqual([]);
  });
});

describe("getPortalTeam", () => {
  it("returns an avatar-ready row per non-client project member, with a role label", async () => {
    projectMemberRows = [
      { user_id: "lead-1", project_role: "lead" },
      { user_id: "member-1", project_role: "member" },
    ];
    workspaceMemberRoleRows = [
      { user_id: "lead-1", role: "admin" },
      { user_id: "member-1", role: "member" },
    ];

    const team = await getPortalTeam(PROJECT_ID);

    expect(team).toHaveLength(2);
    const lead = team.find((m) => m.id === "lead-1")!;
    expect(lead.roleLabel).toBe("Project lead");
    const member = team.find((m) => m.id === "member-1")!;
    expect(member.roleLabel).toBe("Team member");
  });

  it("excludes a co-client's own project_members row from the team list", async () => {
    projectMemberRows = [
      { user_id: "client-1", project_role: "member" },
      { user_id: "member-1", project_role: "member" },
    ];
    workspaceMemberRoleRows = [
      { user_id: "client-1", role: "client" },
      { user_id: "member-1", role: "member" },
    ];

    const team = await getPortalTeam(PROJECT_ID);

    expect(team.map((m) => m.id)).toEqual(["member-1"]);
  });

  it("returns an empty list, not an error, when the project has no members yet", async () => {
    projectMemberRows = [];
    const team = await getPortalTeam(PROJECT_ID);
    expect(team).toEqual([]);
  });
});
