// @vitest-environment jsdom
//
// F013 (SB-050, SB-052): the Inbox's Link-based tab nav renders the right
// set of tabs and marks the active one, and Approvals/Requests are hidden
// when the caller's role can't reach those pages.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InboxTabNav } from "@/components/inbox/inbox-tab-nav";
import { getVisibleInboxTabs } from "@/lib/inbox/visible-tabs";

describe("SB-050: Inbox renders all 5 tabs for a non-guest", () => {
  it("test_SB_050_all_five_tabs_render_for_non_guest", () => {
    const tabs = getVisibleInboxTabs(false);
    const html = renderToStaticMarkup(
      createElement(InboxTabNav, {
        workspaceSlug: "acme",
        activeTab: "all",
        visibleTabs: tabs,
      }),
    );

    for (const label of ["All", "Notifications", "Approvals", "Requests", "Watching"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('href="/w/acme/inbox?tab=notifications"');
    expect(html).toContain('href="/w/acme/inbox?tab=approvals"');
    expect(html).toContain('href="/w/acme/inbox?tab=requests"');
    expect(html).toContain('href="/w/acme/inbox?tab=watching"');
  });

  it("test_SB_050_active_tab_marked_aria_current", () => {
    const html = renderToStaticMarkup(
      createElement(InboxTabNav, {
        workspaceSlug: "acme",
        activeTab: "watching",
        visibleTabs: getVisibleInboxTabs(false),
      }),
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    const activeLink = doc.querySelector('a[href="/w/acme/inbox?tab=watching"]');
    expect(activeLink?.getAttribute("aria-current")).toBe("page");
  });
});

// F049 (FU-M4-2): the pre-F013 standalone `/approvals` and `/requests`
// pages never excluded a guest — see the git history cited in
// lib/inbox/visible-tabs.ts's header comment. Only a `client` role was
// excluded, and it never reaches this function since the workspace layout
// already redirects it away. These cases replace the old (incorrect)
// "guest is hidden" expectations from F013.
describe("SB-052: Approvals/Requests tabs hidden only for the role the old pages excluded", () => {
  it("test_SB_052_guest_sees_approvals_and_requests_tabs", () => {
    const tabs = getVisibleInboxTabs(false);
    expect(tabs).toContain("approvals");
    expect(tabs).toContain("requests");
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

  it("test_SB_052_client_does_not_see_approvals_or_requests_tabs", () => {
    const tabs = getVisibleInboxTabs(true);
    expect(tabs).not.toContain("approvals");
    expect(tabs).not.toContain("requests");
    expect(tabs).toEqual(["all", "notifications", "watching"]);

    const html = renderToStaticMarkup(
      createElement(InboxTabNav, {
        workspaceSlug: "acme",
        activeTab: "all",
        visibleTabs: tabs,
      }),
    );
    expect(html).not.toContain("Approvals");
    expect(html).not.toContain("Requests");
  });
});
