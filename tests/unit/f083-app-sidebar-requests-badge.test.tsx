import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// F083: "Client requests" carries an unread-count badge, same as
// "Approvals" directly below it — see components/nav/app-sidebar.tsx's
// F083 comments for the threading. Mirrors
// tests/unit/app-sidebar-archive-nav.test.tsx's established shape for a
// hasClient-gated item, plus a mocked useMembership so the client-gated
// items ("Client requests"/"Approvals") actually render.
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

describe("AppSidebar 'Client requests' badge (F083)", () => {
  it("renders a count badge next to 'Client requests' when requestsCount > 0", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, requestsCount: 3 }),
    );

    expect(html).toContain("Client requests");
    // The count renders as visible text content next to the label — same
    // assertion shape a badge test would use for "Approvals" (no existing
    // test file for that one to mirror byte-for-byte, but the component's
    // rendering path — `{typeof count === "number" && count > 0 && ...}`
    // — is identical for both items).
    expect(html).toMatch(/Client requests[\s\S]*?3/);
  });

  it("renders no badge next to 'Client requests' when requestsCount is 0", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, requestsCount: 0 }),
    );

    expect(html).toContain("Client requests");
    // No stray ">0<" badge markup should follow the label immediately —
    // absence is asserted by checking the count isn't rendered at all
    // between "Client requests" and the next nav item's label.
    const afterLabel = html.slice(html.indexOf("Client requests"));
    const beforeNextItem = afterLabel.slice(0, afterLabel.indexOf("Approvals"));
    expect(beforeNextItem).not.toMatch(/>\d+</);
  });

  it("defaults requestsCount to 0 (no badge) when the prop is omitted", () => {
    const html = renderToStaticMarkup(createElement(AppSidebar, baseProps));

    expect(html).toContain("Client requests");
    const afterLabel = html.slice(html.indexOf("Client requests"));
    const beforeNextItem = afterLabel.slice(0, afterLabel.indexOf("Approvals"));
    expect(beforeNextItem).not.toMatch(/>\d+</);
  });
});
