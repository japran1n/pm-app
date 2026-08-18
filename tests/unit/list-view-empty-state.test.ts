import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// The populated-list test below renders the full table, including
// <DueDateSortHeader> (F055) which calls useRouter/usePathname/
// useSearchParams — those need an app router context that isn't present
// under plain react-dom/server. Mocked here the same way
// onboarding-membership-gate.test.ts and sign-out.test.ts mock
// next/navigation, since only the empty-state branches under test in this
// file care about markup, not the sort header's routing behaviour.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/w/acme/projects/proj-1/list",
  useSearchParams: () => new URLSearchParams(),
}));

import { TaskListTable } from "@/components/task/task-list-table";

// F056 (AS-092): "An empty filtered result set shows an explicit
// 'no tasks match' state, not a blank area." <TaskListTable> already
// special-cases `tasks.length === 0` (F053's "no tasks yet" copy for a
// genuinely empty project); this feature adds a second, distinct branch
// for "zero rows because the active filters exclude everything" — driven
// by the new `hasActiveFilters` prop the list page (page.tsx) computes
// from F054's status/priority/assigneeId query params. These tests render
// the component directly (same `renderToStaticMarkup` pattern as
// board-empty-state.test.ts) rather than going through the DB-backed page,
// since the branching logic under test lives entirely in the component.
describe("TaskListTable empty states (AS-092)", () => {
  it("test_AS_092_zero_filtered_results_shows_no_tasks_match_state", () => {
    const html = renderToStaticMarkup(
      createElement(TaskListTable, {
        tasks: [],
        assignees: new Map(),
        hasActiveFilters: true,
        clearFiltersHref: "/w/acme/projects/proj-1/list",
        timezone: "UTC",
      }),
    );

    // Explicit "no tasks match" message — not a blank table.
    expect(html).toContain("No tasks match your filters.");
    // Not the plain "genuinely empty project" copy.
    expect(html).not.toContain("No tasks yet in this project.");
    // A way to clear the active filters, reusing F054's clear-filters
    // action (navigate to the base pathname with no query params).
    expect(html).toContain('href="/w/acme/projects/proj-1/list"');
    expect(html).toContain("Clear filters");
  });

  it("test_AS_092_zero_results_no_active_filters_shows_genuinely_empty_state", () => {
    const html = renderToStaticMarkup(
      createElement(TaskListTable, {
        tasks: [],
        assignees: new Map(),
        hasActiveFilters: false,
        clearFiltersHref: "/w/acme/projects/proj-1/list",
        timezone: "UTC",
      }),
    );

    // A project with zero tasks and no filters applied keeps F053's
    // original copy — distinct from the filtered-to-nothing case above,
    // and doesn't show a "Clear filters" link when there's nothing to
    // clear.
    expect(html).toContain("No tasks yet in this project.");
    expect(html).not.toContain("No tasks match your filters.");
    expect(html).not.toContain("Clear filters");
  });

  it("test_AS_092_populated_list_renders_table_not_empty_state", () => {
    const html = renderToStaticMarkup(
      createElement(TaskListTable, {
        tasks: [
          {
            id: "task-1",
            title: "Ship the thing",
            status: "todo",
            priority: "high",
            assigneeId: null,
            dueDate: null,
            position: 1,
          },
        ],
        assignees: new Map(),
        hasActiveFilters: true,
        clearFiltersHref: "/w/acme/projects/proj-1/list",
        timezone: "UTC",
      }),
    );

    expect(html).toContain("Ship the thing");
    expect(html).not.toContain("No tasks match your filters.");
    expect(html).not.toContain("No tasks yet in this project.");
  });
});
