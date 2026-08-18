import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// The error-state branch renders <DashboardRetryButton>
// (components/dashboard/dashboard-retry-button.tsx), which calls
// useRouter — that needs an app router context that isn't present under
// plain react-dom/server. Mocked here the same way
// list-view-empty-state.test.ts / onboarding-membership-gate.test.ts /
// sign-out.test.ts mock next/navigation, since only the branching logic
// under test in this file cares about which state renders, not the retry
// button's routing behaviour.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/w/acme",
  useSearchParams: () => new URLSearchParams(),
}));

import { DashboardContent } from "@/components/dashboard/dashboard-content";
import { PRIORITY_COLORS, STATUS_COLORS } from "@/lib/task-colors";
import type {
  PriorityCountDatum,
  StatusCountDatum,
} from "@/lib/queries/dashboard";

// F074 (AS-130): "A workspace with zero tasks shows an empty-state
// dashboard, not an error or blank chart." Recharts' <ResponsiveContainer>
// renders awkwardly or blank (empty shell) when handed all-zero data, so
// the workspace home page (app/(workspace)/w/[workspaceSlug]/page.tsx)
// short-circuits to an explicit empty state instead of letting the chart
// components render with zero counts. That branching logic was pulled out
// into <DashboardContent> (a pure, props-only component) specifically so
// it can be exercised here via renderToStaticMarkup, the same pattern
// used by tests/unit/list-view-empty-state.test.ts and
// tests/unit/board-empty-state.test.ts, without needing a Supabase-backed
// Server Component render.
const ZERO_PRIORITY_DATA: PriorityCountDatum[] = (
  ["urgent", "high", "medium", "low", "backlog", "none"] as const
).map((priority) => ({
  priority,
  label: priority,
  count: 0,
  color: PRIORITY_COLORS[priority],
}));

const ZERO_STATUS_DATA: StatusCountDatum[] = (
  ["todo", "in_progress", "in_review", "done"] as const
).map((status) => ({
  status,
  label: status,
  count: 0,
  color: STATUS_COLORS[status],
}));

const NONZERO_STATUS_DATA: StatusCountDatum[] = [
  { status: "todo", label: "To Do", count: 3, color: STATUS_COLORS.todo },
  {
    status: "in_progress",
    label: "In Progress",
    count: 1,
    color: STATUS_COLORS.in_progress,
  },
  { status: "in_review", label: "In Review", count: 0, color: STATUS_COLORS.in_review },
  { status: "done", label: "Done", count: 2, color: STATUS_COLORS.done },
];

describe("DashboardContent empty state (F074: AS-130)", () => {
  it("test_AS_130_zero_task_workspace_shows_explicit_empty_state_not_charts", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardContent, {
        workspaceSlug: "acme",
        hasError: false,
        isEmpty: true,
        priorityData: ZERO_PRIORITY_DATA,
        statusData: ZERO_STATUS_DATA,
      }),
    );

    // Explicit, friendly empty-state message with a next action.
    expect(html).toContain("No tasks yet");
    expect(html).toContain("create your first project");
    expect(html).toContain('href="/w/acme/projects"');

    // No chart wrapper and no error copy — an empty workspace must not
    // fall through to a blank/broken Recharts render or the error state.
    expect(html).not.toContain('data-testid="dashboard-charts"');
    expect(html).not.toContain("We couldn&#x27;t load your dashboard charts");
    expect(html).not.toContain("dashboard-error-state");
  });

  it("test_AS_130_error_state_takes_priority_over_empty_state", () => {
    // hasError is computed independently of isEmpty in the caller, but
    // DashboardContent must still resolve the error branch first so a
    // failed RPC never gets mistaken for and rendered as "zero tasks".
    const html = renderToStaticMarkup(
      createElement(DashboardContent, {
        workspaceSlug: "acme",
        hasError: true,
        isEmpty: true,
        priorityData: ZERO_PRIORITY_DATA,
        statusData: ZERO_STATUS_DATA,
      }),
    );

    expect(html).toContain("dashboard-error-state");
    expect(html).not.toContain("No tasks yet");
    expect(html).not.toContain('data-testid="dashboard-charts"');
  });

  it("test_AS_130_populated_workspace_renders_charts_not_empty_state", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardContent, {
        workspaceSlug: "acme",
        hasError: false,
        isEmpty: false,
        priorityData: ZERO_PRIORITY_DATA,
        statusData: NONZERO_STATUS_DATA,
      }),
    );

    expect(html).toContain('data-testid="dashboard-charts"');
    expect(html).toContain("Tasks by priority");
    expect(html).toContain("Tasks by status");
    expect(html).not.toContain("No tasks yet");
    expect(html).not.toContain("dashboard-error-state");
  });
});
