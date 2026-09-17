// @vitest-environment jsdom
//
// F003/F044 (AS-001, AS-005, AS-006, AS-007, AS-127): the sidebar's
// "Webflow" nav item links to the converter tool page (F002). Rewritten per
// M1 scrutiny (missions/20260917-170249/M1-scrutiny.md): the previous
// version of this file used assertions that could never fail (e.g.
// `toContain("bg-accent")`, which is present in BOTH the active and
// inactive class strings, and `toContain("Webflow")`, which would pass even
// if the text only appeared in an href attribute). Every assertion below is
// mutation-verified: see the handoff for confirmation that reverting the
// relevant `app-sidebar.tsx` code turns each test red.
//
// Second scrutiny pass (F047, AS-007): every test previously rendered only
// `workspaceSlug: "acme"` and hardcoded href assertions as literal strings
// containing "acme". That meant hardcoding the href in app-sidebar.tsx
// (dropping `${workspaceSlug}` interpolation) left every test green. The
// suite below is parameterised with `describe.each` over multiple distinct
// slugs, and every href expectation is derived from the slug variable, so a
// mutation that drops the interpolation is caught.
//
// Switched from `renderToStaticMarkup` to jsdom + @testing-library/react
// (same pattern as app-sidebar-project-nav-list.test.tsx) specifically so
// the mobile <Sheet> can be genuinely opened (clicking its hamburger
// trigger) and its content asserted against -- the Sheet's Popup (Base UI
// Dialog) is only mounted in the DOM once open, so a static, non-interactive
// render only ever exercises the desktop <aside>.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const SLUGS = ["acme", "globex"] as const;

let currentPath = "/w/acme";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPath,
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    refresh: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
  }),
}));

// NotificationBell's realtime effect opens a genuine Supabase Realtime
// WebSocket on mount, which jsdom cannot support and which is unrelated to
// this feature -- stub it to a static marker, same convention as
// app-sidebar-project-nav-list.test.tsx's own NewProjectDialog stub.
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => createElement("div", { "data-testid": "notification-bell-stub" }),
}));

import { AppSidebar } from "@/components/nav/app-sidebar";

afterEach(() => {
  cleanup();
  currentPath = "/w/acme";
});

function makeProps(slug: string) {
  return {
    workspaceSlug: slug,
    workspaces: [{ id: "w1", name: "Acme", slug }],
    currentWorkspaceId: "w1",
    currentUser: { id: "u1", name: "Test User", email: "test@example.com", avatarUrl: null },
  };
}

// Every nav item link lives inside a <nav data-tour="sidebar-nav">. The
// desktop <aside> renders one copy; opening the mobile <Sheet> mounts a
// second, independent copy. `getAllByRole("link", { name: /Webflow/ })`
// resolves to one element per currently-mounted <nav>, so index 0 is
// always desktop, and (once opened) index 1 is always mobile.
async function openMobileSheet() {
  const trigger = screen.getByRole("button", { name: /open navigation/i });
  fireEvent.click(trigger);
  // Base UI's Dialog.Popup renders once `open` flips true; give it a tick.
  await screen.findByRole("dialog");
}

describe.each(SLUGS)("AppSidebar Webflow nav item (F003/F044) [slug=%s]", (slug) => {
  const baseProps = makeProps(slug);
  const expectedHref = `/w/${slug}/tools/webflow`;

  describe("AS-001 / AS-005: Webflow link renders with visible label + correct href, under the correct nav group, on both surfaces", () => {
    it("desktop <aside>: link has the correct href and visible label text (not merely present in the href)", () => {
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

      const link = screen.getByRole("link", { name: /^Webflow$/ });
      expect(link).toHaveAttribute("href", expectedHref);
      // getByRole("link", {name}) already requires an accessible name
      // match against real text content, not the href -- this second
      // check guards specifically against a regression where the text
      // node is removed but the href string still contains "webflow".
      expect(link.textContent).toContain("Webflow");
    });

    it("mobile <Sheet>: opening the hamburger sheet shows the same link with correct href and visible label", async () => {
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));
      await openMobileSheet();

      const dialog = screen.getByRole("dialog");
      const link = within(dialog).getByRole("link", { name: /^Webflow$/ });
      expect(link).toHaveAttribute("href", expectedHref);
      expect(link.textContent).toContain("Webflow");
    });

    it("Webflow sits in the same ungrouped primary band as Dashboard/My Tasks/Projects/Chat, not under a labelled section like 'Team' or 'Other'", () => {
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

      const nav = screen.getByRole("navigation");
      const link = within(nav).getByRole("link", { name: /^Webflow$/ });
      // The group wrapper is the link's direct parent (`<div class="flex
      // flex-col gap-0.5">` holding an optional label <p> + the item
      // links directly as siblings).
      const groupWrapper = link.parentElement;
      expect(groupWrapper).not.toBeNull();
      // A labelled group ("Plan"/"Team"/"Other") has a <p> heading as a
      // child; the ungrouped "Work" band does not.
      const heading = groupWrapper!.querySelector("p");
      expect(heading).toBeNull();
      // And Webflow is a sibling of Dashboard within that same wrapper.
      const dashboardLink = within(groupWrapper as HTMLElement).queryByRole("link", {
        name: /^Dashboard$/,
      });
      expect(dashboardLink).not.toBeNull();
    });
  });

  describe("AS-006: active-state highlighting is genuinely distinguishable from inactive state, both surfaces", () => {
    it("desktop: active route sets aria-current and the active-only class (font-medium), and omits the inactive-only class (text-muted-foreground) on the LINK element itself", () => {
      currentPath = `/w/${slug}/tools/webflow`;
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

      const link = screen.getByRole("link", { name: /^Webflow$/ });
      expect(link).toHaveAttribute("aria-current", "page");
      // font-medium only appears on the isActive branch of the className
      // ternary in app-sidebar.tsx -- unlike "bg-accent", which the
      // previous version of this test asserted and which is ALSO present
      // in the inactive branch's "hover:bg-accent", making it incapable of
      // ever failing.
      expect(link).toHaveClass("font-medium");
      // Checked on the <a> element's own classList, not its icon child --
      // the icon SVG always carries "text-muted-foreground" regardless of
      // active state, so this must be scoped to the link itself to be a
      // real assertion.
      expect(link.classList.contains("text-muted-foreground")).toBe(false);
    });

    it("mobile: opening the sheet at the active route shows the same active-only class and omits the inactive-only class on the link", async () => {
      currentPath = `/w/${slug}/tools/webflow`;
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));
      await openMobileSheet();

      const dialog = screen.getByRole("dialog");
      const link = within(dialog).getByRole("link", { name: /^Webflow$/ });
      expect(link).toHaveAttribute("aria-current", "page");
      expect(link).toHaveClass("font-medium");
      expect(link.classList.contains("text-muted-foreground")).toBe(false);
    });

    it("negative case: a different current route leaves the Webflow link inactive -- no aria-current, no font-medium, has text-muted-foreground", () => {
      currentPath = `/w/${slug}`; // Dashboard's own route, not Webflow's
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

      const link = screen.getByRole("link", { name: /^Webflow$/ });
      expect(link).not.toHaveAttribute("aria-current", "page");
      expect(link).not.toHaveClass("font-medium");
      expect(link.classList.contains("text-muted-foreground")).toBe(true);
    });
  });

  describe("AS-007: no per-workspace/role gating -- renders identically for a guest", () => {
    it("desktop: still renders the Webflow link for a guest", () => {
      render(createElement(AppSidebar, { ...baseProps, isGuest: true }));

      const link = screen.getByRole("link", { name: /^Webflow$/ });
      expect(link).toHaveAttribute("href", expectedHref);
    });

    it("mobile: still renders the Webflow link for a guest once the sheet is opened", async () => {
      render(createElement(AppSidebar, { ...baseProps, isGuest: true }));
      await openMobileSheet();

      const dialog = screen.getByRole("dialog");
      const link = within(dialog).getByRole("link", { name: /^Webflow$/ });
      expect(link).toHaveAttribute("href", expectedHref);
    });

    it("desktop: still renders the Webflow link for a standard (non-guest) member with no Webflow-specific flag on the membership", () => {
      // Regression guard: the item must be unconditional -- it must not be
      // gated behind any membership flag (guest or otherwise). Render with
      // a plain, standard member (isGuest: false, no other flags) and
      // confirm the link is still present.
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

      const link = screen.getByRole("link", { name: /^Webflow$/ });
      expect(link).toHaveAttribute("href", expectedHref);
    });
  });

  describe("AS-127: the Webflow item renders an actual icon element (Code2 SVG), not just token classes on the link", () => {
    it("desktop: renders an <svg> child inside the link, alongside the shared inactive token classes", () => {
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

      const link = screen.getByRole("link", { name: /^Webflow$/ });
      const icon = link.querySelector("svg");
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute("aria-hidden", "true");
      // The link itself (inactive at this path) still carries the shared
      // token so it themes correctly.
      expect(link).toHaveClass("text-muted-foreground");
    });

    it("mobile: renders the same <svg> icon child inside the link once the sheet is opened", async () => {
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));
      await openMobileSheet();

      const dialog = screen.getByRole("dialog");
      const link = within(dialog).getByRole("link", { name: /^Webflow$/ });
      const icon = link.querySelector("svg");
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute("aria-hidden", "true");
    });
  });
});
