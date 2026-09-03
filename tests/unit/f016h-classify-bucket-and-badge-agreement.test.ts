// F016h (missions/20260903-portal, M3 remediation, AS-003): tests for
// the Your list view's `classifyBucket` (app/(portal)/portal/
// [workspaceSlug]/p/[projectId]/your-list/page.tsx) — which had ZERO
// tests before this feature (M3-scrutiny round 2's own finding: changing
// `your-list/page.tsx:40` to `return "waiting"` kept the whole suite
// green) — plus a joint test proving the sidebar badge
// (`getDeliverablesPastDueCount`, lib/queries/deliverables.ts) and the
// view now agree on a past-due `delivered` row, the one axis round 2
// found them disagreeing on.

import { describe, expect, it } from "vitest";

import { classifyBucket } from "@/app/(portal)/portal/[workspaceSlug]/p/[projectId]/your-list/page";
import { isDeliverablePastDue, type PortalDeliverable, type DeliverableState } from "@/lib/queries/deliverables";

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

// F016h: the badge (`getDeliverablesPastDueCount`) and the view
// (`classifyBucket`'s "blocked" bucket) must land on the same number for
// the same project. Both now call the one shared `isDeliverablePastDue`
// predicate — this test proves that for a mixed set including a past-due
// `delivered` row (the exact case that used to diverge) and a past-due
// `not_started` row, the count the badge's own predicate would produce
// equals the count of rows the view classifies as "blocked".
describe("badge/view agreement (F016h, AS-003)", () => {
  it("test_AS_003_badge_count_equals_view_blocked_count_for_a_project_with_delivered_but_unaccepted_items", () => {
    const deliverables: PortalDeliverable[] = [
      makeDeliverable("delivered", PAST), // past due, delivered -- the disagreement case
      makeDeliverable("not_started", PAST), // past due, never started
      makeDeliverable("accepted", PAST), // settled, must not count either way
      makeDeliverable("in_progress", FUTURE), // not yet due
    ];

    const badgeCount = deliverables.filter((d) =>
      isDeliverablePastDue(d.state, d.dueAt, TODAY),
    ).length;

    const viewBlockedCount = deliverables.filter(
      (d) => classifyBucket(d, TODAY) === "blocked",
    ).length;

    expect(badgeCount).toBe(2);
    expect(viewBlockedCount).toBe(2);
    expect(badgeCount).toBe(viewBlockedCount);
  });
});
