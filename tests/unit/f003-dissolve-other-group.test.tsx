// @vitest-environment jsdom
//
// F003 (SB-016, SB-017, SB-018, SB-006): dissolve the sidebar's "Other"
// group — Templates, Archive, Trash and Help ("How this works") move into
// AccountMenu with the same role gates they had in the sidebar; Watching
// moves into the primary "Work" band (temporary until F013) and stays
// reachable directly from the sidebar; guest filtering is preserved end to
// end across both surfaces.

import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import "@testing-library/jest-dom/vitest";

// SB-006: hasClient true so the guest cases exercise the "Preview as client" gate.
vi.mock("@/components/auth/membership-provider", () => ({
  useMembership: () => ({ role: "admin", hasClient: true, projectRoles: {} }),
}));

// FU-8 / SB-004: the bell is an unrelated async client that calls a server
// action (cookies()) on mount; stub it so E251 rejections do not flood the run.
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme",
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

afterEach(() => {
  cleanup();
});

import { AppSidebar } from "@/components/nav/app-sidebar";

const baseProps = {
  workspaceSlug: "acme",
  workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
  currentWorkspaceId: "w1",
  currentUser: { id: "u1", name: "Test User", email: "test@example.com", avatarUrl: null },
};

describe("test_SB_016_other_group_dissolved", () => {
  it("no group labelled 'Other' exists anywhere in the sidebar's static markup, guest or not", () => {
    const memberHtml = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: false, canManageWorkspace: true }),
    );
    const guestHtml = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: true }),
    );

    expect(memberHtml).not.toContain(">Other<");
    expect(guestHtml).not.toContain(">Other<");
  });
});

describe("test_SB_017_templates_archive_trash_help_in_account_menu", () => {
  it("the account menu contains Templates, Archive, Trash and How this works, linking to their existing routes, for a non-guest member", async () => {
    render(createElement(AppSidebar, { ...baseProps, isGuest: false }));

    fireEvent.click(screen.getAllByRole("button", { name: /account menu/i })[0]);
    const menu = await screen.findByRole("menu");

    expect(within(menu).getByText("Templates").closest("a")).toHaveAttribute(
      "href",
      "/w/acme/templates",
    );
    // F012 (SB-046): Archive now points at the canonical `?filter=archived`
    // view on the Projects page rather than the standalone /archive route
    // (which now just redirects there).
    expect(within(menu).getByText("Archive").closest("a")).toHaveAttribute(
      "href",
      "/w/acme/projects?filter=archived",
    );
    expect(within(menu).getByText("Trash").closest("a")).toHaveAttribute(
      "href",
      "/w/acme/trash",
    );
    expect(within(menu).getByText("How this works").closest("a")).toHaveAttribute(
      "href",
      "/w/acme/help",
    );
  });

  it("hides Templates, Archive and Trash for a guest but still shows How this works (not guest-gated, same as before)", async () => {
    render(createElement(AppSidebar, { ...baseProps, isGuest: true }));

    fireEvent.click(screen.getAllByRole("button", { name: /account menu/i })[0]);
    const menu = await screen.findByRole("menu");

    expect(within(menu).queryByText("Templates")).toBeNull();
    expect(within(menu).queryByText("Archive")).toBeNull();
    expect(within(menu).queryByText("Trash")).toBeNull();
    expect(within(menu).getByText("How this works").closest("a")).toHaveAttribute(
      "href",
      "/w/acme/help",
    );
  });
});

describe("test_SB_018_watching_still_reachable_in_sidebar", () => {
  it("a sidebar item 'Watching' links to /w/acme/watching, reachable without opening the account menu", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: false }),
    );

    expect(html).toContain('href="/w/acme/watching"');
    expect(html).toContain("Watching");
  });

  it("is also reachable for a guest (personal notification preference, not gated)", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: true }),
    );

    expect(html).toContain('href="/w/acme/watching"');
  });
});

describe("test_SB_006_guest_filtering_preserved_across_sidebar_and_account_menu", () => {
  it("with role guest, neither the sidebar nor the (closed) account menu markup renders Team, Members, Settings, Templates, Archive, Trash, Preview as client, Client requests, or Approvals", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: true, canManageWorkspace: true }),
    );

    expect(html).not.toContain('href="/w/acme/team"');
    expect(html).not.toContain('href="/w/acme/settings/members"');
    expect(html).not.toContain('href="/w/acme/settings"');
    expect(html).not.toContain('href="/w/acme/templates"');
    expect(html).not.toContain('href="/w/acme/archive"');
    expect(html).not.toContain('href="/w/acme/trash"');
    expect(html).not.toContain('href="/w/acme/preview-as-client"');
    expect(html).not.toContain('href="/w/acme/requests"');
    expect(html).not.toContain('href="/w/acme/approvals"');
  });

  it("with role guest, opening the account menu itself also renders none of Templates, Archive, Trash, Settings", async () => {
    render(createElement(AppSidebar, { ...baseProps, isGuest: true, canManageWorkspace: true }));

    fireEvent.click(screen.getAllByRole("button", { name: /account menu/i })[0]);
    const menu = await screen.findByRole("menu");

    expect(within(menu).queryByText("Templates")).toBeNull();
    expect(within(menu).queryByText("Archive")).toBeNull();
    expect(within(menu).queryByText("Trash")).toBeNull();
    expect(within(menu).queryByText("Settings")).toBeNull();
  });
});
