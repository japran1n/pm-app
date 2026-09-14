// @vitest-environment jsdom
//
// Mission 20260914-portal-simplify, F014 (AS-009, AS-010, AS-011): the M2
// scrutiny finding was that "For you" hid partial failures behind
// misleading UI -- a "0" count on a chip whose own source failed reads as
// "nothing outstanding" when the truth is "we don't know", the positive
// "Nothing is waiting on you" empty state could show even when a source
// failed to load, and a failed `getDecisionOwners` read silently disabled
// every decision's actions with no explanation (indistinguishable from
// "nobody is assigned yet"). This renders the actual page component (not
// a re-implementation) for each failure combination and asserts the
// resulting DOM directly.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("@/components/portal/approval-card", () => ({
  ApprovalCard: ({ approval }: { approval: { id: string } }) => (
    <div data-testid={`approval-card-${approval.id}`}>approval {approval.id}</div>
  ),
}));

vi.mock("@/components/portal/deliverable-row", () => ({
  DeliverableRow: ({ deliverable }: { deliverable: { id: string } }) => (
    <li data-testid={`deliverable-row-${deliverable.id}`}>deliverable {deliverable.id}</li>
  ),
}));

vi.mock("@/components/portal/approval-history", () => ({
  ApprovalHistory: () => <div data-testid="approval-history-stub" />,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { id: "ws-1", slug: "acme" } }),
        }),
      }),
    }),
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
  })),
}));

vi.mock("@/lib/queries/portal", () => ({
  getPortalProjects: vi.fn(async () => [{ id: "proj-1", name: "Website" }]),
}));

const okApproval = {
  ok: true,
  data: [
    {
      id: "appr-1",
      projectId: "proj-1",
      title: "Pick a homepage",
      description: null,
      decisionType: "design",
      subjectType: "task",
      subjectId: null,
      artifactUrl: null,
      artifactSnapshotPath: null,
      state: "pending",
      requestedAt: "2026-09-01T00:00:00.000Z",
      dueAt: null,
      decidedAt: null,
      decisionNote: null,
      decidedBy: null,
      round: 1,
    },
  ],
};
const failedResult = { ok: false, error: "boom" };
const emptyOk = { ok: true, data: [] };

async function mockQueries({
  approvals = emptyOk,
  deliverables = emptyOk,
  history = emptyOk,
  owners = emptyOk,
}: {
  approvals?: unknown;
  deliverables?: unknown;
  history?: unknown;
  owners?: unknown;
} = {}) {
  vi.doMock("@/lib/queries/approvals", () => ({
    getOpenApprovalsForClient: vi.fn(async () => approvals),
    getApprovalHistory: vi.fn(async () => history),
    getDecisionOwners: vi.fn(async () => owners),
  }));
  vi.doMock("@/lib/queries/deliverables", () => ({
    getClientDeliverablesForPortal: vi.fn(async () => deliverables),
  }));
  const { default: PortalForYouPage } = await import(
    "@/app/(portal)/portal/[workspaceSlug]/p/[projectId]/for-you/page"
  );
  return PortalForYouPage;
}

afterEach(() => {
  cleanup();
  vi.resetModules();
});

describe("F014 / AS-009: chip counts hide when their own source failed", () => {
  it("test_AS_009_decisions_chip_hides_its_count_when_approvals_failed", async () => {
    const PortalForYouPage = await mockQueries({ approvals: failedResult, deliverables: emptyOk });
    const element = await PortalForYouPage({
      params: Promise.resolve({ workspaceSlug: "acme", projectId: "proj-1" }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    const decisionsChip = screen.getByTestId("for-you-chip-decisions");
    expect(decisionsChip.querySelector(".font-mono")).toBeNull();

    // The unaffected "materials" chip still shows its (real) count.
    const materialsChip = screen.getByTestId("for-you-chip-materials");
    expect(materialsChip.querySelector(".font-mono")).not.toBeNull();
  });

  it("test_AS_009_all_chip_hides_its_count_when_either_source_failed", async () => {
    const PortalForYouPage = await mockQueries({ approvals: emptyOk, deliverables: failedResult });
    const element = await PortalForYouPage({
      params: Promise.resolve({ workspaceSlug: "acme", projectId: "proj-1" }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    const allChip = screen.getByTestId("for-you-chip-all");
    expect(allChip.querySelector(".font-mono")).toBeNull();
  });
});

describe("F014 / AS-011: the positive empty state never shows on a partial failure", () => {
  it("test_AS_011_no_positive_empty_state_when_approvals_failed_even_with_no_materials", async () => {
    const PortalForYouPage = await mockQueries({ approvals: failedResult, deliverables: emptyOk });
    const element = await PortalForYouPage({
      params: Promise.resolve({ workspaceSlug: "acme", projectId: "proj-1" }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    expect(screen.queryByTestId("for-you-empty")).toBeNull();
    expect(screen.getByTestId("for-you-decisions-error")).toBeInTheDocument();
  });

  it("test_AS_011_positive_empty_state_still_shows_when_both_sources_succeed_and_are_empty", async () => {
    const PortalForYouPage = await mockQueries({ approvals: emptyOk, deliverables: emptyOk });
    const element = await PortalForYouPage({
      params: Promise.resolve({ workspaceSlug: "acme", projectId: "proj-1" }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    expect(screen.getByTestId("for-you-empty")).toBeInTheDocument();
  });
});

describe("F014 / AS-010: a failed decision-owner read is surfaced, not silently applied", () => {
  it("test_AS_010_shows_an_error_hint_when_getDecisionOwners_fails_and_a_decision_is_visible", async () => {
    const PortalForYouPage = await mockQueries({
      approvals: okApproval,
      deliverables: emptyOk,
      owners: failedResult,
    });
    const element = await PortalForYouPage({
      params: Promise.resolve({ workspaceSlug: "acme", projectId: "proj-1" }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    expect(screen.getByTestId("for-you-owners-error")).toBeInTheDocument();
    expect(screen.getByTestId("approval-card-appr-1")).toBeInTheDocument();
  });

  it("test_AS_010_no_owners_error_hint_when_getDecisionOwners_succeeds", async () => {
    const PortalForYouPage = await mockQueries({
      approvals: okApproval,
      deliverables: emptyOk,
      owners: emptyOk,
    });
    const element = await PortalForYouPage({
      params: Promise.resolve({ workspaceSlug: "acme", projectId: "proj-1" }),
      searchParams: Promise.resolve({}),
    });
    render(element);

    expect(screen.queryByTestId("for-you-owners-error")).toBeNull();
  });
});
