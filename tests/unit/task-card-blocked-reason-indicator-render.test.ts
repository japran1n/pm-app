// Render test: TaskCard's own "Blocked" workflow-status indicator
// (task.status case-insensitively "blocked" + a non-empty
// task.blockedReason), distinct from the pre-existing openBlockerCount
// (dependency) indicator covered by
// tests/unit/task-card-blocked-indicator-render.test.ts. Same
// `renderToStaticMarkup` (no jsdom) pattern as that file.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { TaskCard, type TaskCardTask } from "@/components/task/task-card";

const BASE_TASK: TaskCardTask = {
  id: "task-1",
  title: "Ship the release",
  status: "todo",
  priority: null,
  assigneeId: null,
  dueDate: null,
  position: 1000,
};

describe("TaskCard renders the blocked-reason indicator", () => {
  it("test_shows_icon_plus_tooltip_when_status_is_blocked_and_a_reason_is_set", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: {
          ...BASE_TASK,
          status: "Blocked" as TaskCardTask["status"],
          blockedReason: "Waiting on client copy",
        },
        timezone: "UTC",
      }),
    );

    expect(html).toContain('data-testid="blocked-reason-indicator"');
    // Icon + text, never colour alone.
    expect(html).toContain("lucide-triangle-alert");
    expect(html).toContain("Blocked");
  });

  it("test_hides_the_indicator_when_status_is_blocked_but_no_reason_is_recorded", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: {
          ...BASE_TASK,
          status: "Blocked" as TaskCardTask["status"],
          blockedReason: null,
        },
        timezone: "UTC",
      }),
    );

    expect(html).not.toContain('data-testid="blocked-reason-indicator"');
  });

  it("test_hides_the_indicator_when_a_reason_is_set_but_status_is_not_blocked", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: {
          ...BASE_TASK,
          status: "todo",
          blockedReason: "Leftover reason from before the status changed",
        },
        timezone: "UTC",
      }),
    );

    expect(html).not.toContain('data-testid="blocked-reason-indicator"');
  });

  it("test_status_match_is_case_insensitive", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: {
          ...BASE_TASK,
          status: "BLOCKED" as TaskCardTask["status"],
          blockedReason: "Waiting on DNS handover",
        },
        timezone: "UTC",
      }),
    );

    expect(html).toContain('data-testid="blocked-reason-indicator"');
  });
});
