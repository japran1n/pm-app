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

      const link = screen.getByRole("link", { name: /^HTML → Webflow$/ });
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
      const link = within(dialog).getByRole("link", { name: /^HTML → Webflow$/ });
      expect(link).toHaveAttribute("href", expectedHref);
      expect(link.textContent).toContain("Webflow");
    });

    // F010 (TH-001, TH-002, TH-003): the item was moved out of the
    // ungrouped primary band into its own labelled "Tools" section,
    // positioned between "Team" and "Other".
    it("HTML → Webflow sits under its own labelled 'Tools' section, not in the ungrouped primary band with Dashboard", () => {
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

      const nav = screen.getByRole("navigation");
      const link = within(nav).getByRole("link", { name: /^HTML → Webflow$/ });
      // The group wrapper is the link's direct parent (`<div class="flex
      // flex-col gap-0.5">` holding an optional label <p> + the item
      // links directly as siblings).
      const groupWrapper = link.parentElement;
      expect(groupWrapper).not.toBeNull();
      const heading = groupWrapper!.querySelector("p");
      expect(heading).not.toBeNull();
      expect(heading!.textContent).toBe("Tools");
      // Dashboard is NOT a sibling of HTML → Webflow anymore -- it stayed
      // behind in the ungrouped primary band.
      const dashboardLink = within(groupWrapper as HTMLElement).queryByRole("link", {
        name: /^Dashboard$/,
      });
      expect(dashboardLink).toBeNull();
    });

    // TH-003 / TH-007: "Tools" is positioned after "Team" among the
    // labelled group headings, in document order. F003 (SB-016): "Other"
    // itself no longer exists as a group -- it was dissolved (Templates,
    // Archive, Trash, Help moved into AccountMenu; Watching moved into the
    // primary band) -- so "Tools" is now simply the last labelled group,
    // with nothing after it.
    it("TH-003/TH-007: the 'Tools' section heading appears after 'Team' (the last labelled group -- 'Other' no longer exists, F003/SB-016)", () => {
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

      const nav = screen.getByRole("navigation");
      const headings = within(nav)
        .getAllByText(/^(Plan|Team|Tools|Other)$/)
        .map((el) => el.textContent);
      const teamIndex = headings.indexOf("Team");
      const toolsIndex = headings.indexOf("Tools");
      expect(teamIndex).toBeGreaterThanOrEqual(0);
      expect(toolsIndex).toBeGreaterThan(teamIndex);
      expect(headings.indexOf("Other")).toBe(-1);
      expect(toolsIndex).toBe(headings.length - 1);
    });
  });

  describe("AS-006: active-state highlighting is genuinely distinguishable from inactive state, both surfaces", () => {
    it("desktop: active route sets aria-current and the active-only class (font-medium), and omits the inactive-only class (text-muted-foreground) on the LINK element itself", () => {
      currentPath = `/w/${slug}/tools/webflow`;
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

      const link = screen.getByRole("link", { name: /^HTML → Webflow$/ });
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
      const link = within(dialog).getByRole("link", { name: /^HTML → Webflow$/ });
      expect(link).toHaveAttribute("aria-current", "page");
      expect(link).toHaveClass("font-medium");
      expect(link.classList.contains("text-muted-foreground")).toBe(false);
    });

    it("negative case: a different current route leaves the Webflow link inactive -- no aria-current, no font-medium, has text-muted-foreground", () => {
      currentPath = `/w/${slug}`; // Dashboard's own route, not Webflow's
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

      const link = screen.getByRole("link", { name: /^HTML → Webflow$/ });
      expect(link).not.toHaveAttribute("aria-current", "page");
      expect(link).not.toHaveClass("font-medium");
      expect(link.classList.contains("text-muted-foreground")).toBe(true);
    });

    // F048 (M1 scrutiny-2): F044's clarified spec called for nested-subpath
    // active highlighting to be covered, but no such case existed -- 10/10
    // tests stayed green even after adding `exact: true` to the Webflow nav
    // entry, or replacing the isActive expression with a bare
    // `pathname === href`. Both mutations collapse prefix matching to exact
    // matching, so a sub-route under the converter (e.g. its results page)
    // must be asserted active to catch them.
    it("desktop: a nested sub-route under the converter (prefix match, not exact) still highlights Webflow as active", () => {
      currentPath = `${expectedHref}/results`;
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

      const link = screen.getByRole("link", { name: /^HTML → Webflow$/ });
      expect(link).toHaveAttribute("aria-current", "page");
      expect(link).toHaveClass("font-medium");
      expect(link.classList.contains("text-muted-foreground")).toBe(false);
    });

    it("the Webflow item's active-state class token is the same token used by another prefix-matched sidebar item (Projects) at its own active route, confirming shared active-route styling, not a bespoke one-off", () => {
      // Webflow active via its own sub-route.
      currentPath = `${expectedHref}/results`;
      const { unmount } = render(createElement(AppSidebar, { ...baseProps, isGuest: false }));
      const webflowLink = screen.getByRole("link", { name: /^HTML → Webflow$/ });
      const webflowActiveClasses = webflowLink.className;
      unmount();

      // Projects active via its own sub-route -- same prefix-matching
      // isActive branch (Projects also carries no `exact: true`).
      currentPath = `/w/${slug}/projects/some-project-id`;
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));
      const projectsLink = screen.getByRole("link", { name: /^Projects$/ });
      const projectsActiveClasses = projectsLink.className;

      expect(webflowActiveClasses).toBe(projectsActiveClasses);
    });
  });

  describe("AS-007: no per-workspace gating; team-only by role (audit 2026-09-24)", () => {
    // The converter is a team tool (tools/webflow/layout.tsx and
    // convertHtmlToWebflow refuse guests), so a guest is not shown the link.
    it("desktop: does not render the Webflow link for a guest", () => {
      render(createElement(AppSidebar, { ...baseProps, isGuest: true }));

      expect(screen.queryByRole("link", { name: /^HTML → Webflow$/ })).toBeNull();
    });

    it("mobile: does not render the Webflow link for a guest once the sheet is opened", async () => {
      render(createElement(AppSidebar, { ...baseProps, isGuest: true }));
      await openMobileSheet();

      const dialog = screen.getByRole("dialog");
      expect(within(dialog).queryByRole("link", { name: /^HTML → Webflow$/ })).toBeNull();
    });

    it("desktop: still renders the Webflow link for a standard (non-guest) member with no Webflow-specific flag on the membership", () => {
      // Regression guard: the item must be unconditional -- it must not be
      // gated behind any membership flag (guest or otherwise). Render with
      // a plain, standard member (isGuest: false, no other flags) and
      // confirm the link is still present.
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

      const link = screen.getByRole("link", { name: /^HTML → Webflow$/ });
      expect(link).toHaveAttribute("href", expectedHref);
    });
  });

  describe("AS-127: the Webflow item renders an actual icon element (Code2 SVG), not just token classes on the link", () => {
    it("desktop: renders an <svg> child inside the link, alongside the shared inactive token classes", () => {
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

      const link = screen.getByRole("link", { name: /^HTML → Webflow$/ });
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
      const link = within(dialog).getByRole("link", { name: /^HTML → Webflow$/ });
      const icon = link.querySelector("svg");
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute("aria-hidden", "true");
    });

    it("active route: the icon carries the permitted text-muted-foreground token, not text-tertiary-foreground (CLAUDE.md bans that token for operative/read-to-operate content)", () => {
      currentPath = "/w/acme/tools/webflow";
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

      const link = screen.getByRole("link", { name: /^HTML → Webflow$/ });
      const icon = link.querySelector("svg");
      expect(icon).not.toBeNull();
      expect(icon).toHaveClass("text-muted-foreground");
      expect(icon!.classList.contains("text-tertiary-foreground")).toBe(false);
    });
  });

  describe("F011 (TH-004, TH-006, TH-009, TH-010, TH-011): 'Webflow Code Editor' nav item", () => {
    const editorHref = `/w/${slug}/tools/code-editor`;

    it("TH-004: appears in the Tools section, below HTML → Webflow, with correct href", () => {
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

      const nav = screen.getByRole("navigation");
      const link = within(nav).getByRole("link", { name: /^Webflow Code Editor$/ });
      expect(link).toHaveAttribute("href", editorHref);

      const groupWrapper = link.parentElement;
      expect(groupWrapper).not.toBeNull();
      const heading = groupWrapper!.querySelector("p");
      expect(heading!.textContent).toBe("Tools");

      const itemLinks = within(groupWrapper as HTMLElement).getAllByRole("link");
      const labels = itemLinks.map((el) => el.textContent);
      expect(labels.indexOf("Webflow Code Editor")).toBeGreaterThan(
        labels.indexOf("HTML → Webflow"),
      );
    });

    it("TH-006: link href points to the code editor route for the given workspace slug", () => {
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));
      const link = screen.getByRole("link", { name: /^Webflow Code Editor$/ });
      expect(link).toHaveAttribute("href", editorHref);
    });

    it("TH-009: shows active state (aria-current, font-medium) when current path is the code editor route", () => {
      currentPath = editorHref;
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

      const link = screen.getByRole("link", { name: /^Webflow Code Editor$/ });
      expect(link).toHaveAttribute("aria-current", "page");
      expect(link).toHaveClass("font-medium");
      expect(link.classList.contains("text-muted-foreground")).toBe(false);
    });

    it("TH-009 (nested sub-route): still highlights active via prefix match", () => {
      currentPath = `${editorHref}/some-file`;
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

      const link = screen.getByRole("link", { name: /^Webflow Code Editor$/ });
      expect(link).toHaveAttribute("aria-current", "page");
      expect(link).toHaveClass("font-medium");
    });

    it("TH-010: does not show active state on other routes (e.g. HTML → Webflow's own route)", () => {
      currentPath = `/w/${slug}/tools/webflow`;
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

      const link = screen.getByRole("link", { name: /^Webflow Code Editor$/ });
      expect(link).not.toHaveAttribute("aria-current", "page");
      expect(link).not.toHaveClass("font-medium");
      expect(link.classList.contains("text-muted-foreground")).toBe(true);
    });

    it("TH-011: existing nav items (e.g. HTML → Webflow, Dashboard) still render correctly alongside the new item", () => {
      render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

      const webflowLink = screen.getByRole("link", { name: /^HTML → Webflow$/ });
      expect(webflowLink).toHaveAttribute("href", `/w/${slug}/tools/webflow`);

      const dashboardLink = screen.getByRole("link", { name: /^Dashboard$/ });
      expect(dashboardLink).toHaveAttribute("href", `/w/${slug}`);
    });
  });
});
