// @vitest-environment jsdom
//
// F012 (TH-008) originally asserted that a guest sees the "Tools" group.
// Superseded by the audit 2026-09-24 authorization decision: the Tools are
// team tools (the converter action and tools/** route layouts refuse
// guests, sitemaps are team + viewer), so the sidebar no longer offers a
// guest any Tools entry. A member still sees every tool.

import { createElement } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    refresh: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
  }),
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

describe("TH-008 (superseded): a guest sees no Tools group", () => {
  it("a guest sees no 'Tools' section heading in the rendered nav", () => {
    render(createElement(AppSidebar, makeProps(true)));

    const nav = screen.getByRole("navigation");
    expect(within(nav).queryAllByText(/^Tools$/)).toHaveLength(0);
  });

  it("a guest sees none of the tool links", () => {
    render(createElement(AppSidebar, makeProps(true)));

    const nav = screen.getByRole("navigation");
    expect(within(nav).queryByRole("link", { name: /^HTML → Webflow$/ })).toBeNull();
    expect(within(nav).queryByRole("link", { name: /^Webflow Code Editor$/ })).toBeNull();
    expect(within(nav).queryByRole("link", { name: /^Sitemap Builder$/ })).toBeNull();
  });

  it("control: a non-guest member still sees the Tools items", () => {
    render(createElement(AppSidebar, makeProps(false)));

    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("link", { name: /^HTML → Webflow$/ })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: /^Webflow Code Editor$/ })).toBeInTheDocument();
  });
});
