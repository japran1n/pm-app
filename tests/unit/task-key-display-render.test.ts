// F146 (AS-258): render tests proving the task key badge actually appears
// in the real, rendered markup of the two shared components that carry it
// — <TaskCard> (board surface) and <TaskListTable> (project List view AND
// the workspace dashboard table, which reuses this exact component per
// components/dashboard/dashboard-task-table.tsx — see that file's own
// doc comment). Same `renderToStaticMarkup` (no jsdom) pattern already
// established by tests/unit/list-table-status-priority-colors.test.ts and
// tests/unit/list-view-empty-state.test.ts for this repo's node-only
// vitest environment (vitest.config.ts: environment: "node" — a real DOM
// test environment isn't available until F277).
//
// This is deliberately NOT a source-text grep on task-card.tsx/
// task-list-table.tsx (that would just prove the code contains certain
// strings, not that a task with a real key/number actually renders one) —
// each test below constructs a `TaskCardTask` with concrete
// `projectKey`/`number` values, renders the real component tree, and
// asserts the formatted "KEY-NUMBER" string is present in the output
// HTML, plus a negative case proving a task missing either half renders
// with no badge (not a malformed partial string) rather than crashing.
//
// What this file does NOT cover (see the handoff's "Notes for the next
// worker" for the full list): TaskDetailSheet's click-to-copy button
// (Radix Sheet only portals its content when `open`, and the copy
// interaction itself needs a real clipboard API / Playwright), and the
// live workspace search page (an async Server Component that fetches
// from the database, not render-testable this way). Those are covered
// instead by lib/tasks/task-key.ts's own unit tests plus this feature's
// integration tests against the real query functions.

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// TaskListTable renders <DueDateSortHeader>/<ListStatusSelect>, which call
// useRouter/usePathname/useSearchParams — same next/navigation mock as
// tests/unit/list-view-empty-state.test.ts and
// tests/unit/list-table-status-priority-colors.test.ts, needed for a
// plain react-dom/server render with no app router context.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/w/acme/projects/proj-1/list",
  useSearchParams: () => new URLSearchParams(),
}));

import { TaskCard, type TaskCardTask } from "@/components/task/task-card";
import { TaskListTable } from "@/components/task/task-list-table";

const BASE_TASK: TaskCardTask = {
  id: "task-1",
  title: "Write the release notes",
  status: "todo",
  priority: null,
  assigneeId: null,
  dueDate: null,
  position: 1000,
};

describe("TaskCard renders the task key badge (F146, AS-258)", () => {
  it("test_AS_258_task_card_shows_the_formatted_KEY_NUMBER_when_present", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: { ...BASE_TASK, projectKey: "PM", number: 142 },
        timezone: "UTC",
      }),
    );

    expect(html).toContain("PM-142");
  });

  it("test_AS_258_negative_task_card_renders_no_badge_when_project_key_is_missing", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: { ...BASE_TASK, number: 142 },
        timezone: "UTC",
      }),
    );

    expect(html).not.toContain("-142");
    expect(html).toContain(BASE_TASK.title);
  });

  it("test_AS_258_negative_task_card_renders_no_badge_when_number_is_missing", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: { ...BASE_TASK, projectKey: "PM" },
        timezone: "UTC",
      }),
    );

    expect(html).not.toContain("PM-");
    expect(html).toContain(BASE_TASK.title);
  });
});

describe("TaskListTable renders a Key column (F146, AS-258) — shared by the project List view and, via dashboard-task-table.tsx, the workspace dashboard table", () => {
  it("test_AS_258_list_row_shows_the_formatted_KEY_NUMBER_when_present", () => {
    const html = renderToStaticMarkup(
      createElement(TaskListTable, {
        tasks: [{ ...BASE_TASK, projectKey: "ENG", number: 7 }],
        assignees: new Map(),
        timezone: "UTC",
      }),
    );

    expect(html).toContain("Key");
    expect(html).toContain("ENG-7");
  });

  it("test_AS_258_negative_list_row_shows_a_dash_placeholder_not_a_malformed_key_when_missing", () => {
    const html = renderToStaticMarkup(
      createElement(TaskListTable, {
        tasks: [BASE_TASK],
        assignees: new Map(),
        timezone: "UTC",
      }),
    );

    expect(html).toContain("—");
  });

  it("test_AS_258_a_workspace_wide_row_set_with_different_projects_shows_each_tasks_own_key", () => {
    // Mirrors getWorkspaceListTasks's per-row (not per-page) projectKey —
    // the dashboard table's whole reason for needing a per-row field
    // instead of one page-level prop (see lib/queries/tasks.ts's doc
    // comment on that query).
    const html = renderToStaticMarkup(
      createElement(TaskListTable, {
        tasks: [
          { ...BASE_TASK, id: "t1", projectKey: "ENG", number: 3 },
          { ...BASE_TASK, id: "t2", projectKey: "MKT", number: 9 },
        ],
        assignees: new Map(),
        timezone: "UTC",
      }),
    );

    expect(html).toContain("ENG-3");
    expect(html).toContain("MKT-9");
  });
});
