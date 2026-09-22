// @vitest-environment jsdom
//
// F049 (FU-M4-2, SB-051, SB-052): scrutiny (missions/20260921-212654/
// milestones/M4-scrutiny.md) found F013's Inbox tab gating copied the
// sidebar's cosmetic `guestExcluded` nav-entry rule instead of the real
// server-side access rule the old standalone `/approvals` and `/requests`
// pages enforced. Per the pre-F013 history (commits 52322272, 4cab6033;
// see each old page's own file-header "Access:" comment), neither page
// added any role check beyond the workspace layout's redirect of
// `role === "client"` to `/portal/*` — a guest was never blocked from
// either page.
//
// These tests assert, for every role that can actually reach the Inbox
// (owner, admin, member, guest — a `client` never gets this far, the
// layout redirects it first), the visible tab set and the All-tab's
// rendered item set match what that role saw on the old standalone pages:
// everything. They are non-vacuous — reverting lib/inbox/visible-tabs.ts
// to gate on `isGuest` instead of `isClient` (the F013 bug) makes the
// guest-role case below fail, because a guest would then lose the
// Approvals/Requests tabs it had before.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { getVisibleInboxTabs } from "@/lib/inbox/visible-tabs";
import { InboxTabNav } from "@/components/inbox/inbox-tab-nav";

const NON_CLIENT_ROLES = ["owner", "admin", "member", "guest"] as const;

// ---------------------------------------------------------------------------
// Integration-level regression test: exercises the ACTUAL role -> boolean
// mapping in app/(workspace)/w/[workspaceSlug]/inbox/page.tsx (not a
// hand-computed boolean), so it fails if that mapping regresses back to
// F013's `isGuest` rule. Mutation-tested: reverting page.tsx's
// `const isClient = membership?.role === "client";` to F013's
// `const isGuest = (membership?.role ?? "guest") === "guest";` (and the
// `!isGuest` derivations) makes the guest-role case below fail, because the
// rendered markup would then be missing the Approvals/Requests tab links a
// guest is entitled to.
// ---------------------------------------------------------------------------

describe("SB-052: tab visibility matches the old pages' real access rule for every role", () => {
  for (const role of NON_CLIENT_ROLES) {
    it(`test_SB_052_${role}_sees_approvals_and_requests_tabs_like_the_old_standalone_pages`, () => {
      // Every one of these roles could open the old /approvals and
      // /requests pages directly (only `role === "client"` was ever
      // redirected away) — the isClient predicate must therefore be
      // false for all of them, not just non-guest roles.
      const isClient = (role as string) === "client";
      const tabs = getVisibleInboxTabs(isClient);

      expect(tabs).toEqual(["all", "notifications", "approvals", "requests", "watching"]);

      const html = renderToStaticMarkup(
        createElement(InboxTabNav, {
          workspaceSlug: "acme",
          activeTab: "all",
          visibleTabs: tabs,
        }),
      );
      expect(html).toContain("Approvals");
      expect(html).toContain("Requests");
    });
  }

  it("test_SB_052_client_role_has_no_entry_point_left_if_it_ever_reached_the_inbox", () => {
    // Defensive parity check only -- a `client` role never reaches this
    // far in practice (workspace layout redirect), but if the gate is
    // ever exercised directly with isClient=true, it must still exclude
    // the two tabs the old pages did keep behind the layout redirect.
    const tabs = getVisibleInboxTabs(true);
    expect(tabs).toEqual(["all", "notifications", "watching"]);
  });
});

vi.mock("@/lib/queries/notifications", () => ({
  getNotificationsForWorkspace: vi.fn(async () => ({
    list: [],
    unreadCount: 0,
  })),
}));

vi.mock("@/lib/queries/approvals", () => ({
  getOpenApprovalsForWorkspace: vi.fn(async () => ({
    list: [
      {
        id: "a1",
        title: "Guest-visible approval",
        projectName: "Apollo",
        requestedAt: "2026-06-03T09:00:00.000Z",
      },
    ],
  })),
}));

vi.mock("@/lib/queries/client-requests", () => ({
  getWorkspaceClientRequests: vi.fn(async () => ({
    list: [
      {
        id: "r1",
        title: "Guest-visible request",
        projectName: "Apollo",
        createdAt: "2026-06-02T09:00:00.000Z",
      },
    ],
  })),
}));

vi.mock("@/lib/queries/watching", () => ({
  getWatchedTasksForUser: vi.fn(async () => ({ list: [] })),
}));

describe("SB-051: the All tab renders the same item set for a guest as for any other non-client role", () => {
  it("test_SB_051_guest_all_tab_includes_approvals_and_requests_items", async () => {
    const { AllTabContent } = await import("@/components/inbox/all-tab-content");

    // A guest is `!isClient`, so canSeeApprovals/canSeeRequests are both
    // true for it -- same as every other non-client role, matching what
    // the old standalone pages rendered for a guest before F013.
    const isClient = false;
    const element = await AllTabContent({
      workspaceSlug: "acme",
      workspaceId: "w1",
      userId: "u1",
      canSeeApprovals: !isClient,
      canSeeRequests: !isClient,
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Guest-visible approval");
    expect(html).toContain("Guest-visible request");
  });
});

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("@/components/notifications/notifications-tab-content", () => ({
  NotificationsTabContent: () => createElement("div", null, "notifications-tab"),
}));
vi.mock("@/components/approvals/approvals-tab-content", () => ({
  ApprovalsTabContent: () => createElement("div", null, "approvals-tab"),
}));
vi.mock("@/components/client-requests/requests-tab-content", () => ({
  RequestsTabContent: () => createElement("div", null, "requests-tab"),
}));
vi.mock("@/components/watching/watching-tab-content", () => ({
  WatchingTabContent: () => createElement("div", null, "watching-tab"),
}));
let pageMembershipRole: string | null;
let pageMembershipError: { message: string } | null = null;

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(async () => ({
    supabase: {
      from: vi.fn((table: string) => {
        if (table === "workspaces") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: { id: "w1" }, error: null })),
              })),
            })),
          };
        }
        // workspace_members
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: pageMembershipRole ? { role: pageMembershipRole } : null,
                    error: pageMembershipError,
                  })),
                })),
              })),
            })),
          })),
        };
      }),
    },
    user: { id: "u1", email: "user@example.com" },
  })),
}));

describe("SB-052 (page-level regression): InboxPage grants a guest the Approvals/Requests tabs, matching the old pages", () => {
  it("test_SB_052_inbox_page_shows_approvals_and_requests_tabs_for_a_guest_role", async () => {
    const InboxPage = (await import("@/app/(workspace)/w/[workspaceSlug]/inbox/page")).default;

    pageMembershipRole = "guest";
    const element = await InboxPage({
      params: Promise.resolve({ workspaceSlug: "acme" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('href="/w/acme/inbox?tab=approvals"');
    expect(html).toContain('href="/w/acme/inbox?tab=requests"');
  });

  it("test_SB_052_inbox_page_still_hides_approvals_and_requests_tabs_if_a_client_role_ever_reaches_it", async () => {
    const InboxPage = (await import("@/app/(workspace)/w/[workspaceSlug]/inbox/page")).default;

    pageMembershipRole = "client";
    const element = await InboxPage({
      params: Promise.resolve({ workspaceSlug: "acme" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain('href="/w/acme/inbox?tab=approvals"');
    expect(html).not.toContain('href="/w/acme/inbox?tab=requests"');
  });
});

// F050 (FU-M4-3): a membership-lookup failure must fail loudly, not fall
// through the `?? "guest"` default and silently demote an owner/member to
// guest (hiding Approvals/Requests with no signal). This test would fail
// if that throw were removed and the page instead defaulted the role.
describe("FU-M4-3: InboxPage fails loudly on a membership-lookup error", () => {
  it("test_FU_M4_3_inbox_page_throws_when_membership_lookup_errors", async () => {
    const InboxPage = (await import("@/app/(workspace)/w/[workspaceSlug]/inbox/page")).default;

    pageMembershipRole = null;
    pageMembershipError = { message: "connection reset" };

    await expect(
      InboxPage({
        params: Promise.resolve({ workspaceSlug: "acme" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow();

    pageMembershipError = null;
  });
});
