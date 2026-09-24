import { afterEach, describe, expect, it, vi } from "vitest";

const getOpenApprovalsForClient = vi.fn();
const getClientDeliverablesForPortal = vi.fn();

vi.mock("@/lib/queries/approvals", () => ({
  getOpenApprovalsForClient: (...args: unknown[]) => getOpenApprovalsForClient(...args),
}));

vi.mock("@/lib/queries/deliverables", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queries/deliverables")>(
    "@/lib/queries/deliverables",
  );
  return {
    ...actual,
    getClientDeliverablesForPortal: (...args: unknown[]) =>
      getClientDeliverablesForPortal(...args),
  };
});

import {
  getWaitingOnYouCount,
  getWaitingOnYouTotalsByProject,
} from "@/lib/portal/waiting-on-you-count";
import type { PortalApproval } from "@/lib/queries/approvals";
import type { PortalDeliverable } from "@/lib/queries/deliverables";

const TODAY = "2026-09-14";
const PROJECT_ID = "project-1";

function approval(overrides: Partial<PortalApproval>): PortalApproval {
  return {
    id: "approval-1",
    projectId: PROJECT_ID,
    title: "Approve homepage copy",
    description: null,
    decisionType: "content",
    subjectType: "doc",
    subjectId: null,
    artifactUrl: null,
    artifactSnapshotPath: null,
    state: "pending",
    requestedAt: TODAY,
    dueAt: null,
    decidedAt: null,
    decisionNote: null,
    decidedBy: null,
    round: 1,
    ...overrides,
  };
}

function deliverable(overrides: Partial<PortalDeliverable>): PortalDeliverable {
  return {
    id: "deliverable-1",
    projectId: PROJECT_ID,
    phaseId: null,
    taskId: null,
    title: "Homepage copy",
    description: null,
    kind: "copy",
    ownerName: "Client",
    dueAt: null,
    blocking: false,
    state: "not_started",
    deliveredAt: null,
    acceptedAt: null,
    acceptedBy: null,
    reviewNote: null,
    position: 0,
    holdsUp: { label: null, kind: "none", value: null },
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("AS-007: single waiting-on-you count", () => {
  it("AS-007_sums_open_approvals_and_outstanding_deliverables", async () => {
    getOpenApprovalsForClient.mockResolvedValue({
      ok: true,
      data: [approval({ id: "a1" }), approval({ id: "a2" })],
    });
    getClientDeliverablesForPortal.mockResolvedValue({
      ok: true,
      data: [
        deliverable({ id: "d1", state: "not_started" }),
        deliverable({ id: "d2", state: "accepted" }),
        deliverable({ id: "d3", state: "waived" }),
        deliverable({ id: "d4", state: "delivered" }),
      ],
    });

    const result = await getWaitingOnYouCount(PROJECT_ID, TODAY);

    // F017 (portal-simplify, M2 scrutiny): `d4` (state "delivered") is
    // waiting on the TEAM to review it, not on the client -- it must NOT
    // inflate this "waiting on you" count. Only `d1` (not_started)
    // counts as an outstanding material here.
    expect(result).toEqual({
      ok: true,
      data: { decisions: 2, materials: 1, total: 3, overdue: 0 },
    });
  });

  it("AS-007_excludes_accepted_and_waived_deliverables_from_materials", async () => {
    getOpenApprovalsForClient.mockResolvedValue({ ok: true, data: [] });
    getClientDeliverablesForPortal.mockResolvedValue({
      ok: true,
      data: [
        deliverable({ id: "d1", state: "accepted" }),
        deliverable({ id: "d2", state: "waived" }),
      ],
    });

    const result = await getWaitingOnYouCount(PROJECT_ID, TODAY);

    expect(result).toEqual({
      ok: true,
      data: { decisions: 0, materials: 0, total: 0, overdue: 0 },
    });
  });

  it("AS-007_counts_overdue_materials_via_shared_past_due_predicate", async () => {
    getOpenApprovalsForClient.mockResolvedValue({ ok: true, data: [] });
    getClientDeliverablesForPortal.mockResolvedValue({
      ok: true,
      data: [
        deliverable({ id: "d1", state: "not_started", dueAt: "2026-09-01" }),
        deliverable({ id: "d2", state: "in_progress", dueAt: "2026-09-30" }),
        deliverable({ id: "d3", state: "delivered", dueAt: "2026-09-01" }),
      ],
    });

    const result = await getWaitingOnYouCount(PROJECT_ID, TODAY);

    // F017: `d3` is delivered (awaiting the team, not the client) and a
    // past-due delivered item is no longer "overdue FOR THE CLIENT" --
    // only `d1` (not_started, past due) counts.
    expect(result).toEqual({
      ok: true,
      data: { decisions: 0, materials: 2, total: 2, overdue: 1 },
    });
  });

  it("AS-007_counts_overdue_decisions_with_a_past_due_date", async () => {
    getOpenApprovalsForClient.mockResolvedValue({
      ok: true,
      data: [
        approval({ id: "a1", dueAt: "2026-09-01" }),
        approval({ id: "a2", dueAt: "2026-09-30" }),
        approval({ id: "a3", dueAt: null }),
      ],
    });
    getClientDeliverablesForPortal.mockResolvedValue({ ok: true, data: [] });

    const result = await getWaitingOnYouCount(PROJECT_ID, TODAY);

    expect(result).toEqual({
      ok: true,
      data: { decisions: 3, materials: 0, total: 3, overdue: 1 },
    });
  });

  it("AS-007_returns_zero_total_with_no_open_items", async () => {
    getOpenApprovalsForClient.mockResolvedValue({ ok: true, data: [] });
    getClientDeliverablesForPortal.mockResolvedValue({ ok: true, data: [] });

    const result = await getWaitingOnYouCount(PROJECT_ID, TODAY);

    expect(result).toEqual({
      ok: true,
      data: { decisions: 0, materials: 0, total: 0, overdue: 0 },
    });
  });

  it("AS-007_propagates_failure_when_approvals_read_fails_no_number_shown", async () => {
    getOpenApprovalsForClient.mockResolvedValue({ ok: false, error: "boom" });
    getClientDeliverablesForPortal.mockResolvedValue({ ok: true, data: [] });

    const result = await getWaitingOnYouCount(PROJECT_ID, TODAY);

    expect(result).toEqual({ ok: false, error: "boom" });
  });

  it("AS-007_propagates_failure_when_deliverables_read_fails_no_number_shown", async () => {
    getOpenApprovalsForClient.mockResolvedValue({ ok: true, data: [] });
    getClientDeliverablesForPortal.mockResolvedValue({ ok: false, error: "boom" });

    const result = await getWaitingOnYouCount(PROJECT_ID, TODAY);

    expect(result).toEqual({ ok: false, error: "boom" });
  });
});

describe("REUSE-PORTAL-04: chooser badge uses the same count", () => {
  it("returns each project's For-you total and omits failed reads", async () => {
    getOpenApprovalsForClient.mockImplementation(async (projectId: string) =>
      projectId === "broken"
        ? { ok: false, error: "boom" }
        : { ok: true, data: [approval({ projectId })] },
    );
    getClientDeliverablesForPortal.mockImplementation(async (projectId: string) => ({
      ok: true,
      data: [
        deliverable({ projectId, state: "in_progress" }),
        deliverable({ id: "d2", projectId, state: "delivered" }),
      ],
    }));

    const totals = await getWaitingOnYouTotalsByProject(["a", "b", "broken"], TODAY);
    const single = await getWaitingOnYouCount("a", TODAY);

    expect(single.ok && single.data.total).toBe(2);
    expect(totals.get("a")).toBe(2);
    expect(totals.get("b")).toBe(2);
    expect(totals.has("broken")).toBe(false);
  });
});
