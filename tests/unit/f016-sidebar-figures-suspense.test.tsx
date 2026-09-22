import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// F016 (AS-017): every sidebar figure that is not required to render the
// navigation resolves inside a Suspense boundary. This suite asserts two
// things: (1) AppSidebar accepts the new streamed slot props and renders
// them verbatim in place of its own default rendering for that figure
// (no visual change -- the badge/bell/switcher markup is unchanged either
// way), and (2) each new figure component in components/nav/figures/ is
// itself an async function, i.e. always returns a Promise -- the shape
// that requires a Suspense boundary around it to resolve.

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

vi.mock("@/components/auth/membership-provider", () => ({
  useMembership: () => ({ role: "member", hasClient: true, projectRoles: {} }),
}));

import { AppSidebar } from "@/components/nav/app-sidebar";

const baseProps = {
  workspaceSlug: "acme",
  workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
  currentWorkspaceId: "w1",
  currentUser: { id: "u1", name: "Test User", email: "test@example.com", avatarUrl: null },
  isGuest: false,
};

describe("AS-017: sidebar figures stream in via slot props", () => {
  it("renders approvalsBadge/requestsBadge/chatUnreadBadge slots verbatim instead of the count-derived fallback", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, {
        ...baseProps,
        // Even though the legacy `*Count` props are also provided, the
        // slot node -- exactly what a resolved figure would render --
        // must win, proving the real layout's streamed values are what
        // actually reaches the DOM.
        approvalsCount: 999,
        requestsCount: 999,
        chatUnreadCount: 999,
        approvalsBadge: createElement("span", { "data-testid": "approvals-slot" }, "7"),
        requestsBadge: createElement("span", { "data-testid": "requests-slot" }, "8"),
        chatUnreadBadge: createElement("span", { "data-testid": "chat-slot" }, "9"),
      }),
    );

    expect(html).toContain("data-testid=\"approvals-slot\"");
    expect(html).toContain("data-testid=\"requests-slot\"");
    expect(html).toContain("data-testid=\"chat-slot\"");
    // The stale 999 counts must never leak through once a slot is provided.
    expect(html).not.toMatch(/>999</);
  });

  it("renders inboxBadge/workspaceSwitcherSlot verbatim in place of the default badge/switcher", () => {
    // F014 (SB-053, SB-054, SB-055): notificationBellSlot no longer
    // exists -- the bell was removed, replaced by the "Inbox" nav item's
    // own inboxBadge slot (same F016 streamed-slot shape).
    const html = renderToStaticMarkup(
      createElement(AppSidebar, {
        ...baseProps,
        inboxBadge: createElement("div", { "data-testid": "inbox-badge-slot" }),
        workspaceSwitcherSlot: createElement("div", { "data-testid": "switcher-slot" }),
      }),
    );

    expect(html).toContain("data-testid=\"inbox-badge-slot\"");
    expect(html).toContain("data-testid=\"switcher-slot\"");
  });

  it("falls back to the original synchronous rendering when no slots are provided (back-compat, no visual change for existing callers)", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, approvalsCount: 0, requestsCount: 3 }),
    );

    expect(html).toContain("Client requests");
    expect(html).toMatch(/Client requests[\s\S]*?3/);
  });
});

describe("AS-017: each sidebar figure is its own async server component", () => {
  it("InboxBadgeFigure, NotificationsRealtimeFigure, TourFigure, ApprovalsBadgeFigure, RequestsBadgeFigure, ChatUnreadBadgeFigure, and WorkspaceSwitcherFigure all return a Promise (require a Suspense boundary to resolve)", async () => {
    // This test only imports each figure and inspects its function shape
    // (`AsyncFunction`) -- it does not invoke or render any of them, so no
    // data-layer mocking is needed.
    // F014: NotificationBellFigure was replaced by InboxBadgeFigure (the
    // Inbox nav item's own aggregate badge) and NotificationsRealtimeFigure
    // (the bell's relocated realtime side effects) -- see those files' own
    // header comments.
    const { InboxBadgeFigure } = await import(
      "@/components/nav/figures/inbox-badge-figure"
    );
    const { NotificationsRealtimeFigure } = await import(
      "@/components/nav/figures/notifications-realtime-figure"
    );
    const { TourFigure } = await import("@/components/nav/figures/tour-figure");
    const { ApprovalsBadgeFigure } = await import(
      "@/components/nav/figures/approvals-badge-figure"
    );
    const { RequestsBadgeFigure } = await import(
      "@/components/nav/figures/requests-badge-figure"
    );
    const { ChatUnreadBadgeFigure } = await import(
      "@/components/nav/figures/chat-unread-badge-figure"
    );
    const { WorkspaceSwitcherFigure } = await import(
      "@/components/nav/figures/workspace-switcher-figure"
    );

    for (const Figure of [
      InboxBadgeFigure,
      NotificationsRealtimeFigure,
      TourFigure,
      ApprovalsBadgeFigure,
      RequestsBadgeFigure,
      ChatUnreadBadgeFigure,
      WorkspaceSwitcherFigure,
    ]) {
      expect(Figure.constructor.name).toBe("AsyncFunction");
    }
  });
});
