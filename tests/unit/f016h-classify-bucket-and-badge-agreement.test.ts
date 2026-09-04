// F016h (missions/20260903-portal, M3 remediation, AS-003): tests for
// the Your list view's `classifyBucket` (app/(portal)/portal/
// [workspaceSlug]/p/[projectId]/your-list/page.tsx) — which had ZERO
// tests before this feature (M3-scrutiny round 2's own finding: changing
// `your-list/page.tsx:40` to `return "waiting"` kept the whole suite
// green) — plus a joint test proving the sidebar badge
// (`getDeliverablesPastDueCount`, lib/queries/deliverables.ts) and the
// view now agree on a past-due `delivered` row, the one axis round 2
// found them disagreeing on.

import { describe, expect, it, vi } from "vitest";

import { classifyBucket } from "@/app/(portal)/portal/[workspaceSlug]/p/[projectId]/your-list/page";
import {
  getDeliverablesPastDueCount,
  type PortalDeliverable,
  type DeliverableState,
} from "@/lib/queries/deliverables";

// F016k (M3 remediation round 2, AS-003): the joint test below used to
// compute "the badge's count" by calling `isDeliverablePastDue` a SECOND
// time inline, then compare that to `classifyBucket` (which also calls
// `isDeliverablePastDue`) -- a tautology dressed up as an agreement
// test, since both sides were the same function applied twice. It could
// not fail: changing the real badge (`getDeliverablesPastDueCount`,
// lib/queries/deliverables.ts) to something that disagreed with
// `isDeliverablePastDue` would never be exercised by this test at all.
//
// This mocks `@/lib/supabase/server` (the one seam `getDeliverablesPastDueCount`
// reads through) with a real row set, and calls the REAL function --
// the same one `getPortalBadgeCounts` calls in production -- rather than
// re-deriving its own count from the shared predicate. `classifyBucket`
// is also called for real, unmocked. Two independent code paths, one
// row set, one number.
let deliverableTableRows: { state: DeliverableState; due_at: string | null }[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table !== "client_deliverables") throw new Error(`unexpected table ${table}`);
      return {
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: deliverableTableRows, error: null })),
        })),
      };
    }),
  })),
}));


const TODAY = "2026-06-15";
const PAST = "2020-01-01";
const FUTURE = "2999-01-01";

const NO_HOLDS_UP = { label: null, kind: "none" as const, value: null };

function makeDeliverable(state: DeliverableState, dueAt: string | null): PortalDeliverable {
  return {
    id: `d-${state}-${dueAt ?? "none"}`,
    projectId: "project-1",
    phaseId: null,
    taskId: null,
    title: "Deliverable",
    description: null,
    kind: "copy",
    ownerName: "Client contact",
    dueAt,
    blocking: true,
    state,
    deliveredAt: null,
    acceptedAt: null,
    acceptedBy: null,
    reviewNote: null,
    position: 0,
    holdsUp: NO_HOLDS_UP,
  };
}

describe("classifyBucket (F016h, AS-003)", () => {
  it("test_AS_003_accepted_is_done", () => {
    expect(classifyBucket(makeDeliverable("accepted", PAST), TODAY)).toBe("done");
  });

  it("test_AS_003_waived_is_done", () => {
    expect(classifyBucket(makeDeliverable("waived", PAST), TODAY)).toBe("done");
  });

  it("test_AS_003_not_started_past_due_is_blocked", () => {
    expect(classifyBucket(makeDeliverable("not_started", PAST), TODAY)).toBe("blocked");
  });

  it("test_AS_003_in_progress_past_due_is_blocked", () => {
    expect(classifyBucket(makeDeliverable("in_progress", PAST), TODAY)).toBe("blocked");
  });

  // The defect round 2 found: `delivered` used to route straight to
  // "progress" regardless of due date, disagreeing with the badge's
  // count (which has no state carve-out beyond accepted/waived).
  it("test_AS_003_delivered_past_due_is_blocked_not_progress", () => {
    expect(classifyBucket(makeDeliverable("delivered", PAST), TODAY)).toBe("blocked");
  });

  it("test_AS_003_delivered_not_past_due_is_progress", () => {
    expect(classifyBucket(makeDeliverable("delivered", FUTURE), TODAY)).toBe("progress");
  });

  it("test_AS_003_delivered_with_no_due_date_is_progress", () => {
    expect(classifyBucket(makeDeliverable("delivered", null), TODAY)).toBe("progress");
  });

  it("test_AS_003_not_started_not_yet_due_is_waiting", () => {
    expect(classifyBucket(makeDeliverable("not_started", FUTURE), TODAY)).toBe("waiting");
  });

  it("test_AS_003_not_started_with_no_due_date_is_waiting", () => {
    expect(classifyBucket(makeDeliverable("not_started", null), TODAY)).toBe("waiting");
  });
});

// F016h/F016k: the badge (`getDeliverablesPastDueCount`) and the view
// (`classifyBucket`'s "blocked" bucket) must land on the same number for
// the same project. This calls the REAL badge function (through a mocked
// database seam) and the REAL view function against the same row set,
// including a past-due `delivered` row (the exact case that used to
// diverge) — proving the two independently-written surfaces agree,
// rather than comparing one predicate to itself.
describe("badge/view agreement (F016h/F016k, AS-003)", () => {
  it("test_AS_003_badge_count_equals_view_blocked_count_for_a_project_with_delivered_but_unaccepted_items", async () => {
    const rows: { state: DeliverableState; due_at: string | null }[] = [
      { state: "delivered", due_at: PAST }, // past due, delivered -- the disagreement case
      { state: "not_started", due_at: PAST }, // past due, never started
      { state: "accepted", due_at: PAST }, // settled, must not count either way
      { state: "in_progress", due_at: FUTURE }, // not yet due
    ];
    deliverableTableRows = rows;

    const deliverables: PortalDeliverable[] = rows.map((r) => makeDeliverable(r.state, r.due_at));

    const badgeResult = await getDeliverablesPastDueCount("project-1");
    const viewBlockedCount = deliverables.filter(
      (d) => classifyBucket(d, TODAY) === "blocked",
    ).length;

    expect(badgeResult).toEqual({ ok: true, data: 2 });
    expect(viewBlockedCount).toBe(2);
    if (badgeResult.ok) {
      expect(badgeResult.data).toBe(viewBlockedCount);
    }
  });
});
