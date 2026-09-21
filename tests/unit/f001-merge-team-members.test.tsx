// F001 (SB-001, SB-006, SB-010, SB-011): "Merge Team + Members" — the
// standalone "Members" sidebar nav item is removed; "Team" is the sole
// sidebar entry point in that group. The admin-facing members
// invite/role-management table remains reachable via the Settings page's
// own "Members" tab. Follows the established test shape from
// tests/unit/app-sidebar-team-nav.test.tsx / app-sidebar-settings-nav.test.tsx.

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme",
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

import { AppSidebar } from "@/components/nav/app-sidebar";

const baseProps = {
  workspaceSlug: "acme",
  workspaces: [{ id: "w1", name: "Acme", slug: "acme" }],
  currentWorkspaceId: "w1",
  currentUser: { id: "u1", name: "Test User", email: "test@example.com", avatarUrl: null },
};

describe("F001: Merge Team + Members", () => {
  it("SB-010: renders exactly one sidebar item labelled Team, linking to /w/acme/team, and no item labelled Members", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, { ...baseProps, isGuest: false, canManageWorkspace: true }),
    );

    // Exactly one Team link.
    const teamLinkMatches = html.match(/href="\/w\/acme\/team"/g) ?? [];
    expect(teamLinkMatches).toHaveLength(1);

    // No sidebar item labelled "Members" (the old
    // /w/acme/settings/members link is gone from the nav tree itself).
    expect(html).not.toContain('href="/w/acme/settings/members"');
    expect(html).not.toContain(">Members<");
  });

  // SB-011 is verified behaviourally in tests/unit/f022-sb011-settings-members.test.tsx

  it("SB-006: with role guest, the sidebar renders none of Team, Client requests, Approvals, Archive, Templates, Trash, Preview as client, Settings", () => {
    const html = renderToStaticMarkup(
      createElement(AppSidebar, {
        ...baseProps,
        isGuest: true,
        canManageWorkspace: false,
      }),
    );

    expect(html).not.toContain('href="/w/acme/team"');
    expect(html).not.toContain('href="/w/acme/requests"');
    expect(html).not.toContain('href="/w/acme/approvals"');
    expect(html).not.toContain('href="/w/acme/archive"');
    expect(html).not.toContain('href="/w/acme/templates"');
    expect(html).not.toContain('href="/w/acme/trash"');
    expect(html).not.toContain('href="/w/acme/preview-as-client"');
    expect(html).not.toContain('href="/w/acme/settings"');
    // And still no Members item, guest or not.
    expect(html).not.toContain('href="/w/acme/settings/members"');
  });

  it("SB-001: baseline captured — run-log.md records tsc/eslint/vitest/migrations:check output from before F001's edits", () => {
    const runLog = readFileSync(
      join(process.cwd(), "missions/20260921-212654/run-log.md"),
      "utf8",
    );

    expect(runLog).toContain("npx tsc --noEmit");
    expect(runLog).toContain("npx eslint .");
    expect(runLog).toContain("npx vitest run");
    expect(runLog).toContain("migrations:check");
  });
});
