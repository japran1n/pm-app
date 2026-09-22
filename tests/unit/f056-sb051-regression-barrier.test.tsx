// @vitest-environment jsdom
//
// F056 (FU-M4-9, M4 scrutiny attempt 2): SB-051 previously had no real
// regression barrier — nothing asserted the Inbox's per-tab content
// (Notifications/Approvals/Requests) actually matches what the
// pre-55fd29c6 standalone pages produced (page limits, empty-state copy,
// panel props), nothing restored the two dropped explanatory subheads on
// Requests/Watching, nothing caught `requests-tab-content.tsx` being fed
// the raw URL segment instead of the DB `workspace.slug`, and `parseTab`
// in the Inbox page had zero direct coverage. This file closes all four
// gaps. Each test is written against the pre-55fd29c6 page bodies (see
// `git show 55fd29c6~1:app/(workspace)/w/[workspaceSlug]/<tab>/page.tsx`)
// as the parity reference, not against the current wrapper's own code.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Notifications: page limit + empty-state class parity with the old
// standalone page (PAGE_LIMIT = 100, same emptyStateClassName string).
// ---------------------------------------------------------------------------
describe("FU-M4-9: NotificationsTabContent matches the pre-55fd29c6 page's fetch + props", () => {
  it("test_FU_M4_9_notifications_tab_requests_page_limit_100_like_the_old_page", async () => {
    vi.resetModules();
    const getNotificationsForWorkspace = vi.fn(async () => ({
      list: [],
      unreadCount: 0,
    }));
    vi.doMock("@/lib/queries/notifications", () => ({ getNotificationsForWorkspace }));

    const { NotificationsTabContent } = await import(
      "@/components/notifications/notifications-tab-content"
    );
    await NotificationsTabContent({ workspaceSlug: "acme", workspaceId: "w1" });

    // The old page (git show 55fd29c6~1) called
    // getNotificationsForWorkspace(workspace.id, 100) — a regression that
    // shrinks or grows this limit would silently change how far back the
    // Inbox's Notifications tab reaches.
    expect(getNotificationsForWorkspace).toHaveBeenCalledWith("w1", 100);
    vi.doUnmock("@/lib/queries/notifications");
  });

  it("test_FU_M4_9_notifications_tab_passes_the_old_pages_empty_state_class", async () => {
    vi.resetModules();
    vi.doMock("@/lib/queries/notifications", () => ({
      getNotificationsForWorkspace: vi.fn(async () => ({ list: [], unreadCount: 0 })),
    }));
    vi.doMock("@/components/notifications/notification-panel", () => ({
      NotificationPanel: (props: Record<string, unknown>) =>
        createElement("div", { "data-empty-class": props.emptyStateClassName as string }),
    }));

    const { NotificationsTabContent } = await import(
      "@/components/notifications/notifications-tab-content"
    );
    const element = await NotificationsTabContent({ workspaceSlug: "acme", workspaceId: "w1" });
    const html = renderToStaticMarkup(element);

    // Exact string from the pre-55fd29c6 notifications page.
    expect(html).toContain(
      "flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center",
    );
    vi.doUnmock("@/lib/queries/notifications");
    vi.doUnmock("@/components/notifications/notification-panel");
  });
});

// ---------------------------------------------------------------------------
// Approvals: the rendered row set + decisionOwnerName join must match what
// the old page produced from the same fixture.
// ---------------------------------------------------------------------------
describe("FU-M4-9: ApprovalsTabContent renders the same item set + props as the pre-55fd29c6 page", () => {
  it("test_FU_M4_9_approvals_tab_joins_owner_names_onto_each_row_like_the_old_page", async () => {
    vi.resetModules();
    const fixtureApprovals = [
      { id: "a1", projectId: "p1", decisionType: "budget", title: "Budget sign-off" },
      { id: "a2", projectId: "p1", decisionType: "scope", title: "Scope change" },
    ];
    vi.doMock("@/lib/queries/approvals", () => ({
      getOpenApprovalsForWorkspace: vi.fn(async () => fixtureApprovals),
      getDecisionOwnerNames: vi.fn(
        async () =>
          new Map([
            ["p1:budget", "Priya Shah"],
            ["p1:scope", "Sam Lee"],
          ]),
      ),
    }));
    vi.doMock("@/components/approvals/approvals-queue", () => ({
      ApprovalsQueue: (props: { approvals: Array<{ id: string; decisionOwnerName: string | null }> }) =>
        createElement(
          "div",
          null,
          props.approvals.map((a) => `${a.id}:${a.decisionOwnerName}`).join(","),
        ),
    }));

    const { ApprovalsTabContent } = await import(
      "@/components/approvals/approvals-tab-content"
    );
    const element = await ApprovalsTabContent({ workspaceSlug: "acme", workspaceId: "w1" });
    const html = renderToStaticMarkup(element);

    // Same row set, same owner-name join the old page's inline map produced.
    expect(html).toContain("a1:Priya Shah");
    expect(html).toContain("a2:Sam Lee");

    vi.doUnmock("@/lib/queries/approvals");
    vi.doUnmock("@/components/approvals/approvals-queue");
  });
});

// ---------------------------------------------------------------------------
// Requests: fixture-driven item-set parity, restored subhead copy, and the
// DB workspace.slug (not the raw URL segment) reaching TeamRequestInbox.
// ---------------------------------------------------------------------------
describe("FU-M4-9: RequestsTabContent content-delta closure", () => {
  it("test_FU_M4_9_requests_tab_renders_the_restored_explanatory_subhead", async () => {
    vi.resetModules();
    vi.doMock("@/lib/queries/client-requests", () => ({
      getWorkspaceClientRequests: vi.fn(async () => ({ list: [] })),
    }));
    vi.doMock("@/components/client-requests/team-request-inbox", () => ({
      TeamRequestInbox: () => createElement("div", null, "team-request-inbox"),
    }));
    const { RequestsTabContent } = await import(
      "@/components/client-requests/requests-tab-content"
    );
    const element = await RequestsTabContent({ workspaceSlug: "acme", workspaceId: "w1" });
    const html = renderToStaticMarkup(element);

    // Exact subhead copy from the pre-55fd29c6 standalone requests page —
    // F013's tab wrapper dropped it; this would fail if it stays dropped.
    expect(html).toContain(
      "What your clients have asked for. Accepting one creates a task and shares it back with them.",
    );
    vi.doUnmock("@/lib/queries/client-requests");
    vi.doUnmock("@/components/client-requests/team-request-inbox");
  });

  it("test_FU_M4_9_requests_tab_renders_the_fixture_item_set_matching_the_old_page", async () => {
    vi.resetModules();
    const fixtureRequests = [
      { id: "r1", title: "Fixture request one" },
      { id: "r2", title: "Fixture request two" },
    ];
    vi.doMock("@/lib/queries/client-requests", () => ({
      getWorkspaceClientRequests: vi.fn(async () => ({ list: fixtureRequests })),
    }));
    vi.doMock("@/components/client-requests/team-request-inbox", () => ({
      TeamRequestInbox: (props: { requests: Array<{ id: string }> }) =>
        createElement("div", null, props.requests.map((r) => r.id).join(",")),
    }));

    const { RequestsTabContent } = await import(
      "@/components/client-requests/requests-tab-content"
    );
    const element = await RequestsTabContent({ workspaceSlug: "acme", workspaceId: "w1" });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("r1,r2");
    vi.doUnmock("@/lib/queries/client-requests");
    vi.doUnmock("@/components/client-requests/team-request-inbox");
  });

  it("test_FU_M4_9_inbox_page_passes_the_db_workspace_slug_not_the_raw_url_segment_to_requests_tab", async () => {
    // Regression for FU-M4-9's core bug: requests-tab-content.tsx:24 was
    // fed the raw URL param instead of the DB row's `slug` column. Here
    // the URL segment and the DB slug deliberately differ (mixed case),
    // so the test fails if the wrong one is threaded through.
    vi.resetModules();
    vi.doMock("server-only", () => ({}));
    vi.doMock("next/navigation", () => ({
      redirect: vi.fn(() => {
        throw new Error("NEXT_REDIRECT");
      }),
    }));
    vi.doMock("@/components/notifications/notifications-tab-content", () => ({
      NotificationsTabContent: () => null,
    }));
    vi.doMock("@/components/approvals/approvals-tab-content", () => ({
      ApprovalsTabContent: () => null,
    }));
    vi.doMock("@/components/watching/watching-tab-content", () => ({
      WatchingTabContent: () => null,
    }));

    let capturedSlug: string | undefined;
    vi.doMock("@/components/client-requests/requests-tab-content", () => ({
      RequestsTabContent: (props: { workspaceSlug: string }) => {
        capturedSlug = props.workspaceSlug;
        return createElement("div", null, "requests-tab");
      },
    }));

    vi.doMock("@/lib/auth/current-user", () => ({
      getCurrentUser: vi.fn(async () => ({
        supabase: {
          from: vi.fn((table: string) => {
            if (table === "workspaces") {
              return {
                select: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    // DB slug is "Acme-Canonical" — deliberately different
                    // from the "acme" URL segment below.
                    maybeSingle: vi.fn(async () => ({
                      data: { id: "w1", slug: "Acme-Canonical" },
                      error: null,
                    })),
                  })),
                })),
              };
            }
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    eq: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => ({
                        data: { role: "owner" },
                        error: null,
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

    const InboxPage = (await import("@/app/(workspace)/w/[workspaceSlug]/inbox/page")).default;
    const element = await InboxPage({
      params: Promise.resolve({ workspaceSlug: "acme" }),
      searchParams: Promise.resolve({ tab: "requests" }),
    });
    renderToStaticMarkup(element);

    expect(capturedSlug).toBe("Acme-Canonical");

    vi.doUnmock("server-only");
    vi.doUnmock("next/navigation");
    vi.doUnmock("@/components/notifications/notifications-tab-content");
    vi.doUnmock("@/components/approvals/approvals-tab-content");
    vi.doUnmock("@/components/watching/watching-tab-content");
    vi.doUnmock("@/components/client-requests/requests-tab-content");
    vi.doUnmock("@/lib/auth/current-user");
  });
});

// ---------------------------------------------------------------------------
// Watching: restored explanatory subhead.
// ---------------------------------------------------------------------------
describe("FU-M4-9: WatchingTabContent restores the dropped explanatory subhead", () => {
  it("test_FU_M4_9_watching_tab_renders_the_restored_subhead_copy", async () => {
    vi.resetModules();
    vi.doMock("@/lib/queries/watching", () => ({
      getWatchedTasksForUser: vi.fn(async () => []),
    }));
    const { WatchingTabContent } = await import(
      "@/components/watching/watching-tab-content"
    );
    const element = await WatchingTabContent({ workspaceSlug: "acme", userId: "u1" });
    const html = renderToStaticMarkup(element);

    // Exact subhead copy from the pre-55fd29c6 standalone watching page.
    expect(html).toContain("Tasks you");
    expect(html).toContain("re watching, sorted by the most recent activity.");
    vi.doUnmock("@/lib/queries/watching");
  });
});

// ---------------------------------------------------------------------------
// parseTab coverage: array-valued, unknown, empty ?tab=, and a client
// requesting ?tab=approvals (which visible-tabs must still hide).
// ---------------------------------------------------------------------------
describe("FU-M4-9: InboxPage's parseTab handles every documented shape of ?tab=", () => {
  const setup = () => {
    vi.resetModules();
    vi.doMock("server-only", () => ({}));
    vi.doMock("next/navigation", () => ({
      redirect: vi.fn(() => {
        throw new Error("NEXT_REDIRECT");
      }),
    }));
    vi.doMock("@/components/notifications/notifications-tab-content", () => ({
      NotificationsTabContent: () => createElement("div", null, "notifications-tab"),
    }));
    vi.doMock("@/components/approvals/approvals-tab-content", () => ({
      ApprovalsTabContent: () => createElement("div", null, "approvals-tab"),
    }));
    vi.doMock("@/components/client-requests/requests-tab-content", () => ({
      RequestsTabContent: () => createElement("div", null, "requests-tab"),
    }));
    vi.doMock("@/components/watching/watching-tab-content", () => ({
      WatchingTabContent: () => createElement("div", null, "watching-tab"),
    }));
    vi.doMock("@/components/inbox/all-tab-content", () => ({
      AllTabContent: () => createElement("div", null, "all-tab"),
    }));
  };

  const mockAuth = (role: string | null) => {
    vi.doMock("@/lib/auth/current-user", () => ({
      getCurrentUser: vi.fn(async () => ({
        supabase: {
          from: vi.fn((table: string) => {
            if (table === "workspaces") {
              return {
                select: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    maybeSingle: vi.fn(async () => ({
                      data: { id: "w1", slug: "acme" },
                      error: null,
                    })),
                  })),
                })),
              };
            }
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    eq: vi.fn(() => ({
                      maybeSingle: vi.fn(async () => ({
                        data: role ? { role } : null,
                        error: null,
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
  };

  it("test_FU_M4_9_parseTab_array_valued_tab_uses_the_first_element", async () => {
    setup();
    mockAuth("owner");
    const InboxPage = (await import("@/app/(workspace)/w/[workspaceSlug]/inbox/page")).default;
    const element = await InboxPage({
      params: Promise.resolve({ workspaceSlug: "acme" }),
      searchParams: Promise.resolve({ tab: ["requests", "approvals"] }),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("requests-tab");
    expect(html).not.toContain("approvals-tab");
  });

  it("test_FU_M4_9_parseTab_unknown_tab_falls_back_to_all", async () => {
    setup();
    mockAuth("owner");
    const InboxPage = (await import("@/app/(workspace)/w/[workspaceSlug]/inbox/page")).default;
    const element = await InboxPage({
      params: Promise.resolve({ workspaceSlug: "acme" }),
      searchParams: Promise.resolve({ tab: "not-a-real-tab" }),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("all-tab");
  });

  it("test_FU_M4_9_parseTab_empty_tab_falls_back_to_all", async () => {
    setup();
    mockAuth("owner");
    const InboxPage = (await import("@/app/(workspace)/w/[workspaceSlug]/inbox/page")).default;
    const element = await InboxPage({
      params: Promise.resolve({ workspaceSlug: "acme" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("all-tab");
  });

  it("test_FU_M4_9_client_requesting_tab_approvals_still_falls_back_to_all", async () => {
    setup();
    mockAuth("client");
    const InboxPage = (await import("@/app/(workspace)/w/[workspaceSlug]/inbox/page")).default;
    const element = await InboxPage({
      params: Promise.resolve({ workspaceSlug: "acme" }),
      searchParams: Promise.resolve({ tab: "approvals" }),
    });
    const html = renderToStaticMarkup(element);

    // A client role never has "approvals" in visibleTabs, so requesting it
    // directly must fall back to "all", never render the Approvals panel.
    expect(html).toContain("all-tab");
    expect(html).not.toContain("approvals-tab");
  });
});
