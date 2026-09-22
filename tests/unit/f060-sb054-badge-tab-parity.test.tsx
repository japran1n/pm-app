// @vitest-environment jsdom
//
// F060 (SB-054): the Inbox badge's approvals/requests gating must use the
// SAME predicate as `getVisibleInboxTabs` (lib/inbox/visible-tabs.ts, F049)
// -- not the sidebar nav item's own `isGuest || !hasClient` gate, which
// diverged from what the tabs themselves actually allow (a guest, or a
// caller in a client-less workspace, could always open the approvals/
// requests tabs; only an actual `client` role -- which never reaches this
// component, the workspace layout redirects it away first -- cannot).
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { createElement } from "react";

import { getVisibleInboxTabs } from "@/lib/inbox/visible-tabs";

vi.mock("@/lib/queries/notifications", () => ({
  getNotificationsForWorkspace: vi.fn(),
}));
vi.mock("@/lib/queries/approvals", () => ({
  getOpenApprovalCountForWorkspace: vi.fn(),
}));
vi.mock("@/lib/queries/client-requests", () => ({
  getOpenClientRequestCountForWorkspace: vi.fn(),
}));

async function renderFigure(isClient: boolean) {
  const { getNotificationsForWorkspace } = await import("@/lib/queries/notifications");
  const { getOpenApprovalCountForWorkspace } = await import("@/lib/queries/approvals");
  const { getOpenClientRequestCountForWorkspace } = await import("@/lib/queries/client-requests");
  vi.mocked(getNotificationsForWorkspace).mockResolvedValueOnce({
    list: [],
    unreadCount: 1,
  } as never);
  vi.mocked(getOpenApprovalCountForWorkspace).mockResolvedValueOnce({ count: 10 });
  vi.mocked(getOpenClientRequestCountForWorkspace).mockResolvedValueOnce({ count: 10 });

  const { InboxBadgeFigure } = await import("@/components/nav/figures/inbox-badge-figure");
  const element = await InboxBadgeFigure({ workspaceId: "w1", isClient });
  const { container } = render(createElement(() => element));
  return container;
}

describe("F060 (SB-054): InboxBadgeFigure gates approvals/requests with getVisibleInboxTabs, not isGuest/hasClient", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("test_SB_054_badge_gate_matches_getVisibleInboxTabs_for_a_client_caller (approvals excluded, same as the tabs list)", async () => {
    // Sanity: for a client caller, the real tab-visibility rule excludes
    // "approvals"/"requests".
    expect(getVisibleInboxTabs(true)).not.toContain("approvals");
    expect(getVisibleInboxTabs(true)).not.toContain("requests");

    const container = await renderFigure(true);
    // Only the notifications count (1) should show -- approvals/requests
    // (10 + 10) must be excluded because the tabs themselves exclude them.
    expect(container.textContent).toBe("1");
  });

  it("test_SB_054_badge_gate_matches_getVisibleInboxTabs_for_a_non_client_caller (approvals included, same as the tabs list)", async () => {
    expect(getVisibleInboxTabs(false)).toContain("approvals");
    expect(getVisibleInboxTabs(false)).toContain("requests");

    const container = await renderFigure(false);
    // 1 + 10 + 10 = 21.
    expect(container.textContent).toBe("21");
  });

  it("test_SB_054_diverges_if_badge_reintroduces_isGuest_or_hasClient_instead_of_isClient (guest, non-client caller still gets approvals/requests counted)", async () => {
    // A "guest" is never a client -- getVisibleInboxTabs has no guest
    // concept at all, only `isClient`. If the badge reintroduced an
    // isGuest-based gate it would wrongly exclude approvals/requests for a
    // guest even though the tabs' own rule (role !== "client") lets a
    // guest see them. isClient=false is the correct predicate for a guest.
    const container = await renderFigure(false);
    expect(container.textContent).toBe("21");
  });
});
