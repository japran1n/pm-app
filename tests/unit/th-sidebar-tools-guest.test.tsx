// @vitest-environment jsdom
//
// F012 (TH-008): "A user with the guest role sees the 'Tools' group and both
// its items." validation-contract.md's own wording for TH-008 is the
// authoritative assertion text this test derives from -- the "Tools" band
// (F010/F011) is deliberately NOT run through `filterGuest` in
// components/nav/app-sidebar.tsx's `navGroups()` (same "no per-workspace
// data to leak" reasoning as "How this works"), so a guest sees the exact
// same "Tools" section, with both "HTML → Webflow" and "Webflow Code
// Editor", as any other role.
//
// This is a dedicated, standalone assertion file for TH-008 (as the
// feature spec's own "Files (approximate)" names it), independent of
// app-sidebar-webflow-nav.test.tsx's own broader AS-007 guest-rendering
// coverage -- kept separate so a future change to that file's scope can't
// silently drop TH-008's own explicit guest coverage.

import { createElement } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme",
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    refresh: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
  }),
}));

// NotificationBell opens a genuine Supabase Realtime WebSocket on mount,
// which jsdom cannot support -- stub it, same convention as the other
// app-sidebar test files in this suite.
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => createElement("div", { "data-testid": "notification-bell-stub" }),
}));

import { AppSidebar } from "@/components/nav/app-sidebar";

afterEach(() => {
  cleanup();
});

function makeProps(isGuest: boolean) {
  return {
    workspaceSlug: "acme",
    workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
    currentWorkspaceId: "w1",
    currentUser: { id: "u1", name: "Test User", email: "test@example.com", avatarUrl: null },
    isGuest,
  };
}

describe("TH-008: guest role sees the Tools group and both its items", () => {
  it("a guest sees the 'Tools' section heading in the rendered nav", () => {
    render(createElement(AppSidebar, makeProps(true)));

    const nav = screen.getByRole("navigation");
    const heading = within(nav)
      .getAllByText(/^Tools$/)
      .find((el) => el.tagName === "P");
    expect(heading).not.toBeUndefined();
  });

  it("a guest sees both the 'HTML → Webflow' and 'Webflow Code Editor' links, under the Tools heading", () => {
    render(createElement(AppSidebar, makeProps(true)));

    const nav = screen.getByRole("navigation");
    const converterLink = within(nav).getByRole("link", { name: /^HTML → Webflow$/ });
    const editorLink = within(nav).getByRole("link", { name: /^Webflow Code Editor$/ });

    expect(converterLink).toHaveAttribute("href", "/w/acme/tools/webflow");
    expect(editorLink).toHaveAttribute("href", "/w/acme/tools/code-editor");

    // Both items share the same "Tools" group wrapper as a non-guest would
    // see -- confirms the band is not filtered/hidden for the guest role.
    expect(converterLink.parentElement).toBe(editorLink.parentElement);
    const heading = converterLink.parentElement!.querySelector("p");
    expect(heading!.textContent).toBe("Tools");
  });

  it("negative-case control: a non-guest member sees the exact same two Tools items, confirming the guest render is not a coincidental subset", () => {
    render(createElement(AppSidebar, makeProps(false)));

    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("link", { name: /^HTML → Webflow$/ })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: /^Webflow Code Editor$/ })).toBeInTheDocument();
  });
});
