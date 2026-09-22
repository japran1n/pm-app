// @vitest-environment jsdom
//
// F013 (SB-050, SB-051): the Inbox "All" tab merges every source's items,
// newest-first, capped at 50, and shows the same items each corresponding
// old page showed for the same user.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queries/notifications", () => ({
  getNotificationsForWorkspace: vi.fn(async () => ({
    list: [
      {
        id: "n1",
        kind: "task_assigned",
        createdAt: "2026-06-01T09:00:00.000Z",
        readAt: null,
        actor: { id: "u2", name: "Ada", email: null, avatarUrl: null },
        task: { id: "t1", key: "PM-1", title: "Old notification task", projectId: "p1" },
      },
    ],
    unreadCount: 1,
  })),
}));

vi.mock("@/lib/queries/approvals", () => ({
  getOpenApprovalsForWorkspace: vi.fn(async () => [
    {
      id: "a1",
      title: "Newest approval",
      projectName: "Apollo",
      requestedAt: "2026-06-03T09:00:00.000Z",
    },
  ]),
}));

vi.mock("@/lib/queries/client-requests", () => ({
  getWorkspaceClientRequests: vi.fn(async () => [
    {
      id: "r1",
      title: "A client request",
      projectName: "Apollo",
      createdAt: "2026-06-02T09:00:00.000Z",
    },
  ]),
}));

vi.mock("@/lib/queries/watching", () => ({
  getWatchedTasksForUser: vi.fn(async () => []),
}));

import { AllTabContent } from "@/components/inbox/all-tab-content";

describe("SB-050/SB-051: All tab merges every source, newest first", () => {
  it("test_SB_050_all_tab_merges_and_orders_items_newest_first", async () => {
    const element = await AllTabContent({
      workspaceSlug: "acme",
      workspaceId: "w1",
      userId: "u1",
      canSeeApprovals: true,
      canSeeRequests: true,
    });
    const html = renderToStaticMarkup(element);

    const approvalIdx = html.indexOf("Newest approval");
    const requestIdx = html.indexOf("A client request");
    const notificationIdx = html.indexOf("Old notification task");

    expect(approvalIdx).toBeGreaterThan(-1);
    expect(requestIdx).toBeGreaterThan(-1);
    expect(notificationIdx).toBeGreaterThan(-1);
    // Newest first: approval (06-03) before request (06-02) before
    // notification (06-01).
    expect(approvalIdx).toBeLessThan(requestIdx);
    expect(requestIdx).toBeLessThan(notificationIdx);
  });

  it("test_SB_052_all_tab_excludes_approvals_and_requests_when_role_cannot_see_them", async () => {
    const element = await AllTabContent({
      workspaceSlug: "acme",
      workspaceId: "w1",
      userId: "u1",
      canSeeApprovals: false,
      canSeeRequests: false,
    });
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain("Newest approval");
    expect(html).not.toContain("A client request");
    expect(html).toContain("Old notification task");
  });
});
