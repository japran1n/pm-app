// @vitest-environment jsdom
//
// F054 (FU-M4-7, M4 scrutiny attempt 2, SB-054): the Inbox badge figure
// must apply the SAME gate the Inbox tabs themselves use
// (`getVisibleInboxTabs`/`lib/inbox/visible-tabs.ts`, F049), so a caller
// who can't reach the approvals/requests tabs never sees their counts
// inflate this badge. F060 replaced the earlier `isGuest || !hasClient`
// gate (which diverged from the tabs' own `role === "client"` rule) with
// a single `isClient` prop threaded straight into `getVisibleInboxTabs`.
// It must also be absent (no badge element at all) when the aggregate is
// 0, and must distinguish a failed reconcile from a legitimate zero.
//
// FU-M4-7: `getOpenApprovalCountForWorkspace` and
// `getOpenClientRequestCountForWorkspace` never reject -- like
// `getNotificationsForWorkspace`, they fail open internally and report a
// real fetch failure through a typed `error` field on their resolved
// value (`{ count, error }` / `{ list, unreadCount, error }`). The tests
// below force each source's REAL resolved error shape (never
// `mockRejectedValue`, which none of these functions ever produce) and
// assert the "unavailable" affordance appears -- a test that goes red if
// the error-field plumbing is deleted and the figure falls back to
// reading `.count`/`.unreadCount` off an `undefined` error.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { createElement } from "react";

vi.mock("@/lib/queries/notifications", () => ({
  getNotificationsForWorkspace: vi.fn(),
}));
vi.mock("@/lib/queries/approvals", () => ({
  getOpenApprovalCountForWorkspace: vi.fn(),
}));
vi.mock("@/lib/queries/client-requests", () => ({
  getOpenClientRequestCountForWorkspace: vi.fn(),
}));

async function renderFigure(props: { workspaceId: string; isClient: boolean }) {
  const { InboxBadgeFigure } = await import("@/components/nav/figures/inbox-badge-figure");
  const element = await InboxBadgeFigure(props);
  return render(createElement(() => element));
}

describe("F054 FU-M4-7 (SB-054): Inbox badge hasClient gate + real error-state reconcile", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("test_SB_054_badge_is_absent_when_aggregate_count_is_zero", async () => {
    const { getNotificationsForWorkspace } = await import("@/lib/queries/notifications");
    const { getOpenApprovalCountForWorkspace } = await import("@/lib/queries/approvals");
    const { getOpenClientRequestCountForWorkspace } = await import("@/lib/queries/client-requests");
    vi.mocked(getNotificationsForWorkspace).mockResolvedValueOnce({
      list: [],
      unreadCount: 0,
    } as never);
    vi.mocked(getOpenApprovalCountForWorkspace).mockResolvedValueOnce({ count: 0 });
    vi.mocked(getOpenClientRequestCountForWorkspace).mockResolvedValueOnce({ count: 0 });

    const { container } = await renderFigure({
      workspaceId: "w1",
      isClient: false,
    });

    expect(container.textContent).toBe("");
    expect(container.querySelector('[aria-label="Inbox count unavailable"]')).toBeNull();
  });

  it("test_SB_054_client_caller_excludes_approvals_and_requests_from_the_badge", async () => {
    const { getNotificationsForWorkspace } = await import("@/lib/queries/notifications");
    const { getOpenApprovalCountForWorkspace } = await import("@/lib/queries/approvals");
    const { getOpenClientRequestCountForWorkspace } = await import("@/lib/queries/client-requests");
    vi.mocked(getNotificationsForWorkspace).mockResolvedValueOnce({
      list: [],
      unreadCount: 2,
    } as never);
    // These two would blow the count up to 2 + 5 + 5 = 12 if wrongly
    // included for a caller whose visible-tabs list omits "approvals" --
    // they must never even be called/counted when isClient is true.
    vi.mocked(getOpenApprovalCountForWorkspace).mockResolvedValueOnce({ count: 5 });
    vi.mocked(getOpenClientRequestCountForWorkspace).mockResolvedValueOnce({ count: 5 });

    const { container } = await renderFigure({
      workspaceId: "w1",
      isClient: true,
    });

    // Only the notifications count (2) should show -- not 12.
    expect(container.textContent).toBe("2");
  });

  it("test_SB_054_non_client_caller_still_includes_approvals_and_requests", async () => {
    const { getNotificationsForWorkspace } = await import("@/lib/queries/notifications");
    const { getOpenApprovalCountForWorkspace } = await import("@/lib/queries/approvals");
    const { getOpenClientRequestCountForWorkspace } = await import("@/lib/queries/client-requests");
    vi.mocked(getNotificationsForWorkspace).mockResolvedValueOnce({
      list: [],
      unreadCount: 1,
    } as never);
    vi.mocked(getOpenApprovalCountForWorkspace).mockResolvedValueOnce({ count: 2 });
    vi.mocked(getOpenClientRequestCountForWorkspace).mockResolvedValueOnce({ count: 3 });

    const { container } = await renderFigure({
      workspaceId: "w1",
      isClient: false,
    });

    expect(container.textContent).toBe("6");
  });

  it("test_SB_054_notifications_real_error_value_renders_the_unavailable_affordance", async () => {
    const { getNotificationsForWorkspace } = await import("@/lib/queries/notifications");
    const { getOpenApprovalCountForWorkspace } = await import("@/lib/queries/approvals");
    const { getOpenClientRequestCountForWorkspace } = await import("@/lib/queries/client-requests");
    // The REAL shape getNotificationsForWorkspace resolves to on a fetch
    // failure -- it never rejects (lib/queries/notifications.ts).
    vi.mocked(getNotificationsForWorkspace).mockResolvedValueOnce({
      list: [],
      unreadCount: 0,
      error: "Couldn't load notifications.",
    } as never);
    vi.mocked(getOpenApprovalCountForWorkspace).mockResolvedValueOnce({ count: 0 });
    vi.mocked(getOpenClientRequestCountForWorkspace).mockResolvedValueOnce({ count: 0 });

    const { container } = await renderFigure({
      workspaceId: "w1",
      isClient: false,
    });

    expect(container.querySelector('[aria-label="Inbox count unavailable"]')).not.toBeNull();
    expect(container.textContent).toBe("");
  });

  it("test_SB_054_approvals_real_error_value_renders_the_unavailable_affordance", async () => {
    const { getNotificationsForWorkspace } = await import("@/lib/queries/notifications");
    const { getOpenApprovalCountForWorkspace } = await import("@/lib/queries/approvals");
    const { getOpenClientRequestCountForWorkspace } = await import("@/lib/queries/client-requests");
    vi.mocked(getNotificationsForWorkspace).mockResolvedValueOnce({
      list: [],
      unreadCount: 0,
    } as never);
    // The REAL shape getOpenApprovalCountForWorkspace resolves to on a
    // fetch failure -- it never rejects (lib/queries/approvals.ts).
    vi.mocked(getOpenApprovalCountForWorkspace).mockResolvedValueOnce({
      count: 0,
      error: "Couldn't load approval count.",
    });
    vi.mocked(getOpenClientRequestCountForWorkspace).mockResolvedValueOnce({ count: 0 });

    const { container } = await renderFigure({
      workspaceId: "w1",
      isClient: false,
    });

    expect(container.querySelector('[aria-label="Inbox count unavailable"]')).not.toBeNull();
    expect(container.textContent).toBe("");
  });

  it("test_SB_054_client_requests_real_error_value_renders_the_unavailable_affordance", async () => {
    const { getNotificationsForWorkspace } = await import("@/lib/queries/notifications");
    const { getOpenApprovalCountForWorkspace } = await import("@/lib/queries/approvals");
    const { getOpenClientRequestCountForWorkspace } = await import("@/lib/queries/client-requests");
    vi.mocked(getNotificationsForWorkspace).mockResolvedValueOnce({
      list: [],
      unreadCount: 0,
    } as never);
    vi.mocked(getOpenApprovalCountForWorkspace).mockResolvedValueOnce({ count: 0 });
    // The REAL shape getOpenClientRequestCountForWorkspace resolves to on
    // a fetch failure -- it never rejects (lib/queries/client-requests.ts).
    vi.mocked(getOpenClientRequestCountForWorkspace).mockResolvedValueOnce({
      count: 0,
      error: "Couldn't load client request count.",
    });

    const { container } = await renderFigure({
      workspaceId: "w1",
      isClient: false,
    });

    expect(container.querySelector('[aria-label="Inbox count unavailable"]')).not.toBeNull();
    expect(container.textContent).toBe("");
  });

  it("test_SB_054_a_real_error_does_not_render_as_a_hidden_or_zero_badge", async () => {
    const { getNotificationsForWorkspace } = await import("@/lib/queries/notifications");
    const { getOpenApprovalCountForWorkspace } = await import("@/lib/queries/approvals");
    const { getOpenClientRequestCountForWorkspace } = await import("@/lib/queries/client-requests");
    vi.mocked(getNotificationsForWorkspace).mockResolvedValueOnce({
      list: [],
      unreadCount: 0,
      error: "Couldn't load notifications.",
    } as never);
    vi.mocked(getOpenApprovalCountForWorkspace).mockResolvedValueOnce({ count: 0 });
    vi.mocked(getOpenClientRequestCountForWorkspace).mockResolvedValueOnce({ count: 0 });

    const { container } = await renderFigure({
      workspaceId: "w1",
      isClient: false,
    });

    // Must not render as if it were a legitimate zero (absent/no textContent)
    // and must not render a numeric badge -- a distinct indicator element.
    expect(container.querySelector('[aria-label="Inbox count unavailable"]')).not.toBeNull();
    expect(container.querySelector(".shrink-0.px-1\\.5")).toBeNull();
  });

  // F055 (FU-M4-8, SB-054): render-level case for an aggregate over 99.
  it("test_SB_054_aggregate_over_99_renders_as_99_plus", async () => {
    const { getNotificationsForWorkspace } = await import("@/lib/queries/notifications");
    const { getOpenApprovalCountForWorkspace } = await import("@/lib/queries/approvals");
    const { getOpenClientRequestCountForWorkspace } = await import("@/lib/queries/client-requests");
    vi.mocked(getNotificationsForWorkspace).mockResolvedValueOnce({
      list: [],
      unreadCount: 80,
    } as never);
    vi.mocked(getOpenApprovalCountForWorkspace).mockResolvedValueOnce({ count: 15 });
    vi.mocked(getOpenClientRequestCountForWorkspace).mockResolvedValueOnce({ count: 10 });

    const { container } = await renderFigure({
      workspaceId: "w1",
      isClient: false,
    });

    // 80 + 15 + 10 = 105 > 99.
    expect(container.textContent).toBe("99+");
  });

  it("test_SB_054_aggregate_of_exactly_99_renders_the_real_number_not_capped", async () => {
    const { getNotificationsForWorkspace } = await import("@/lib/queries/notifications");
    const { getOpenApprovalCountForWorkspace } = await import("@/lib/queries/approvals");
    const { getOpenClientRequestCountForWorkspace } = await import("@/lib/queries/client-requests");
    vi.mocked(getNotificationsForWorkspace).mockResolvedValueOnce({
      list: [],
      unreadCount: 99,
    } as never);
    vi.mocked(getOpenApprovalCountForWorkspace).mockResolvedValueOnce({ count: 0 });
    vi.mocked(getOpenClientRequestCountForWorkspace).mockResolvedValueOnce({ count: 0 });

    const { container } = await renderFigure({
      workspaceId: "w1",
      isClient: false,
    });

    expect(container.textContent).toBe("99");
  });
});
