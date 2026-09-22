// @vitest-environment jsdom
//
// F052 (M4 scrutiny FU-M4-5): the dashboard's "Needs you" card built a
// client-request attention item pointing at `/w/<slug>/client-requests` --
// a route that does not exist, so the button 404s. It must point at
// `/w/<slug>/inbox?tab=requests` (the real "Client requests" nav item's own
// href, components/nav/app-sidebar.tsx) instead. This test exercises the
// actual page module (not a grep of the source) with a single open client
// request and asserts the rendered "Needs you" action link's real href.

import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({}),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/queries/profile", () => ({
  getCurrentUserTimezone: async () => "UTC",
}));

vi.mock("@/lib/queries/workspaces", () => ({
  getWorkspaceContext: async () => ({
    user: { id: "u1", email: "owner@example.com" },
    workspace: { id: "w1", name: "Acme" },
    role: "owner",
  }),
}));

vi.mock("@/lib/queries/members", () => ({
  getWorkspaceMembers: async () => ({ active: [], pending: [] }),
}));

vi.mock("@/lib/queries/people", () => ({
  resolvePeople: async () => new Map(),
}));

vi.mock("@/lib/queries/my-tasks", () => ({
  getMyTasks: async () => ({ overdue: [], today: [], thisWeek: [], later: [] }),
  getQaReturns: async () => [],
}));

vi.mock("@/lib/queries/approvals", () => ({
  getOpenApprovalsForWorkspace: async () => [],
}));

vi.mock("@/lib/queries/client-requests", () => ({
  getWorkspaceClientRequests: async () => ({
    list: [
      {
        id: "cr1",
        title: "Change the hero copy",
        projectName: "Marketing site",
        requesterName: "Jane Client",
        status: "submitted",
        createdAt: new Date().toISOString(),
      },
    ],
  }),
}));

vi.mock("@/lib/queries/notifications", () => ({
  getNotificationsForWorkspace: async () => ({ list: [], unreadCount: 0 }),
}));

vi.mock("@/lib/queries/time-entries", () => ({
  getActiveTimer: async () => null,
  getPersonTimeEntriesInRange: async () => [],
  getWorkspaceTimeByPerson: async () => [],
}));

vi.mock("@/lib/queries/calendar-blocks", () => ({
  getCalendarBlocks: async () => [],
}));

vi.mock("@/lib/queries/projects", () => ({
  getMyProjectsProgress: async () => [],
}));

vi.mock("@/lib/queries/personal-todos", () => ({
  getPersonalTodos: async () => [],
}));

vi.mock("@/lib/queries/dashboard", () => ({
  getOverdueCount: async () => ({ data: 0, error: null }),
  getCompletedCount: async () => ({ data: 0, error: null }),
  getUnassignedCount: async () => 0,
  getKpiDelta: async () => 0,
}));

// Everything below NeedsYouCard is irrelevant to this assertion; stub to
// keep the render focused and avoid unrelated crashes.
vi.mock("@/components/dashboard/home-greeting", () => ({
  HomeGreeting: () => null,
}));
vi.mock("@/components/dashboard/my-work-card", () => ({
  MyWorkCard: () => null,
}));
vi.mock("@/components/dashboard/today-time-card", () => ({
  TodayTimeCard: () => null,
}));
vi.mock("@/components/dashboard/coming-up-card", () => ({
  ComingUpCard: () => null,
}));
vi.mock("@/components/dashboard/my-projects-grid", () => ({
  MyProjectsGrid: () => null,
}));
vi.mock("@/components/dashboard/team-health-section", () => ({
  TeamHealthSection: () => null,
}));
vi.mock("@/components/my-tasks/personal-todo-list", () => ({
  PersonalTodoList: () => null,
}));

afterEach(() => {
  cleanup();
});

describe("F052 (M4 scrutiny FU-M4-5): dashboard client-request action href", () => {
  it("points the 'Triage' action at /w/<slug>/inbox?tab=requests, not the nonexistent /client-requests route", async () => {
    const { default: WorkspacePage } = await import(
      "@/app/(workspace)/w/[workspaceSlug]/page"
    );

    const element = await WorkspacePage({
      params: Promise.resolve({ workspaceSlug: "acme" }),
    });

    render(element);

    const link = screen.getByText("Triage").closest("a");
    expect(link).toHaveAttribute("href", "/w/acme/inbox?tab=requests");
    expect(link).not.toHaveAttribute("href", "/w/acme/client-requests");
  });
});
