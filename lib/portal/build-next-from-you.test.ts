// F115 (missions/20260903-portal, docs/client-portal-phase-2-plan.md C):
// the four priority cases, each with a dated and a dateless variant, plus
// the honesty rule (never state a date the data doesn't support) and the
// "first match wins" ordering across cases.
import { describe, expect, it } from "vitest";

import { buildNextFromYouAnswer } from "@/lib/portal/build-next-from-you";
import type { PortalApproval } from "@/lib/queries/approvals";
import type { ClientDeliverable } from "@/lib/queries/deliverables";
import type { PortalPhase } from "@/lib/queries/portal";

const TODAY = "2026-09-05";

function approval(overrides: Partial<PortalApproval> = {}): PortalApproval {
  return {
    id: "app-1",
    projectId: "proj-1",
    title: "the About page",
    description: null,
    decisionType: "brand",
    subjectType: "doc",
    subjectId: null,
    artifactUrl: null,
    artifactSnapshotPath: null,
    state: "pending",
    requestedAt: "2026-09-01",
    dueAt: null,
    decidedAt: null,
    decisionNote: null,
    decidedBy: null,
    round: 1,
    ...overrides,
  } as PortalApproval;
}

function deliverable(overrides: Partial<ClientDeliverable> = {}): ClientDeliverable {
  return {
    id: "del-1",
    projectId: "proj-1",
    phaseId: null,
    taskId: null,
    title: "homepage copy",
    description: null,
    kind: "copy",
    ownerName: "Nina",
    dueAt: null,
    blocking: false,
    state: "not_started",
    deliveredAt: null,
    acceptedAt: null,
    acceptedBy: null,
    reviewNote: null,
    position: 0,
    ...overrides,
  };
}

function phase(overrides: Partial<PortalPhase> = {}): PortalPhase {
  return {
    id: "phase-1",
    name: "QA",
    clientDescription: null,
    state: "not_started",
    plannedStart: null,
    plannedEnd: null,
    actualStart: null,
    actualEnd: null,
    position: 0,
    totalClientVisibleTasks: 0,
    doneClientVisibleTasks: 0,
    progressPercent: 0,
    inFlightTaskTitle: null,
    blockedReason: null,
    ...overrides,
  };
}

describe("buildNextFromYouAnswer", () => {
  it("test_AS_next_from_you_case1_open_approval_with_due_date", () => {
    const result = buildNextFromYouAnswer({
      approvals: [approval({ title: "the About page", dueAt: "2026-09-12" })],
      deliverables: [],
      phases: [],
      todayIso: TODAY,
    });
    expect(result).toBe("Next from you: sign off the About page — expected around 12 Sept.");
  });

  it("test_AS_next_from_you_case1_open_approval_without_due_date_names_thing_only", () => {
    const result = buildNextFromYouAnswer({
      approvals: [approval({ title: "the About page", dueAt: null })],
      deliverables: [],
      phases: [],
      todayIso: TODAY,
    });
    expect(result).toBe("Next from you: sign off the About page.");
  });

  it("test_AS_next_from_you_case1_past_due_deliverable", () => {
    const result = buildNextFromYouAnswer({
      approvals: [],
      deliverables: [
        deliverable({ title: "brand logo files", state: "in_progress", dueAt: "2026-09-01" }),
      ],
      phases: [],
      todayIso: TODAY,
    });
    expect(result).toBe(
      "Next from you: send over brand logo files — expected around 1 Sept.",
    );
  });

  it("test_AS_next_from_you_case1_prefers_the_most_urgent_dated_item", () => {
    const result = buildNextFromYouAnswer({
      approvals: [approval({ title: "the About page", dueAt: "2026-09-20" })],
      deliverables: [
        deliverable({ title: "brand logo files", state: "in_progress", dueAt: "2026-09-01" }),
      ],
      phases: [],
      todayIso: TODAY,
    });
    expect(result).toBe(
      "Next from you: send over brand logo files — expected around 1 Sept.",
    );
  });

  it("test_AS_next_from_you_case2_next_scheduled_deliverable_with_due_date", () => {
    const result = buildNextFromYouAnswer({
      approvals: [],
      deliverables: [
        deliverable({
          title: "homepage copy",
          kind: "copy",
          state: "not_started",
          dueAt: "2026-09-12",
        }),
      ],
      phases: [],
      todayIso: TODAY,
    });
    expect(result).toBe("Next from you: homepage copy — expected around 12 Sept.");
  });

  it("test_AS_next_from_you_case2_next_scheduled_deliverable_without_due_date", () => {
    const result = buildNextFromYouAnswer({
      approvals: [],
      deliverables: [
        deliverable({ title: "homepage copy", kind: "copy", state: "not_started", dueAt: null }),
      ],
      phases: [],
      todayIso: TODAY,
    });
    expect(result).toBe("Next from you: homepage copy.");
  });

  it("test_AS_next_from_you_case2_ignores_already_delivered_and_past_due_rows", () => {
    const result = buildNextFromYouAnswer({
      approvals: [],
      deliverables: [
        deliverable({ title: "delivered copy", kind: "copy", state: "delivered", dueAt: "2026-09-12" }),
        deliverable({
          id: "del-2",
          title: "next copy batch",
          kind: "copy",
          state: "not_started",
          dueAt: "2026-09-20",
        }),
      ],
      phases: [],
      todayIso: TODAY,
    });
    expect(result).toBe("Next from you: next copy batch — expected around 20 Sept.");
  });

  it("test_AS_next_from_you_case3_next_phase_decision_with_due_date", () => {
    const result = buildNextFromYouAnswer({
      approvals: [],
      deliverables: [
        deliverable({
          title: "checkout flow direction",
          kind: "decision",
          state: "not_started",
          dueAt: "2026-09-15",
        }),
      ],
      phases: [],
      todayIso: TODAY,
    });
    expect(result).toBe(
      "Next from you: a decision on checkout flow direction — expected around 15 Sept.",
    );
  });

  it("test_AS_next_from_you_case3_next_phase_decision_without_due_date", () => {
    const result = buildNextFromYouAnswer({
      approvals: [],
      deliverables: [
        deliverable({ title: "checkout flow direction", kind: "decision", state: "not_started", dueAt: null }),
      ],
      phases: [],
      todayIso: TODAY,
    });
    expect(result).toBe("Next from you: a decision on checkout flow direction.");
  });

  it("test_AS_next_from_you_case4_nothing_pending_with_planned_start", () => {
    const result = buildNextFromYouAnswer({
      approvals: [],
      deliverables: [],
      phases: [phase({ name: "QA", state: "not_started", plannedStart: "2026-09-18" })],
      todayIso: TODAY,
    });
    expect(result).toBe(
      "Nothing needed from you right now — next check-in around the start of QA, week of 18 Sept.",
    );
  });

  it("test_AS_next_from_you_case4_nothing_pending_without_planned_start", () => {
    const result = buildNextFromYouAnswer({
      approvals: [],
      deliverables: [],
      phases: [phase({ name: "QA", state: "not_started", plannedStart: null })],
      todayIso: TODAY,
    });
    expect(result).toBe("Nothing needed from you right now — next check-in around the start of QA.");
  });

  it("test_AS_next_from_you_case4_nothing_pending_and_no_upcoming_phase_at_all", () => {
    const result = buildNextFromYouAnswer({
      approvals: [],
      deliverables: [],
      phases: [phase({ name: "Launch", state: "done", plannedStart: "2026-08-01" })],
      todayIso: TODAY,
    });
    expect(result).toBe("Nothing needed from you right now.");
  });

  it("test_AS_next_from_you_decided_approvals_and_accepted_deliverables_do_not_count_as_owed", () => {
    const result = buildNextFromYouAnswer({
      approvals: [approval({ state: "approved", dueAt: "2026-09-01" })],
      deliverables: [
        deliverable({ title: "accepted item", state: "accepted", dueAt: "2026-08-01" }),
        deliverable({ id: "del-2", title: "waived item", state: "waived", dueAt: "2026-08-01" }),
      ],
      phases: [],
      todayIso: TODAY,
    });
    expect(result).toBe("Nothing needed from you right now.");
  });
});
