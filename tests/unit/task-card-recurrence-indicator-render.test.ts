// Render test for F179 (AS-317: a recurrence indicator appears on the
// card). Same `renderToStaticMarkup` (no jsdom) pattern as
// tests/unit/task-card-over-estimate-indicator-render.test.ts — see that
// file's doc comment for what this proves/doesn't prove.

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

describe("TaskCard renders the recurrence indicator (F179: AS-317)", () => {
  it("test_AS_317_shows_an_icon_plus_text_repeat_badge_for_a_recurring_task", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: {
          ...BASE_TASK,
          recurrence: { freq: "weekly", interval: 2 },
        },
        timezone: "UTC",
      }),
    );

    expect(html).toContain("data-testid=\"recurrence-badge\"");
    expect(html).toContain("Every 2 weeks");
    expect(html).toContain("lucide-repeat");
  });

  it("test_AS_317_shows_the_until_date_in_the_badge_text_when_the_rule_has_an_end_date", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: {
          ...BASE_TASK,
          recurrence: { freq: "daily", interval: 1, until: "2026-09-30" },
        },
        timezone: "UTC",
      }),
    );

    expect(html).toContain("Every day until Sep 30");
  });

  it("test_AS_317_shows_no_badge_when_the_task_has_no_recurrence_rule", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: { ...BASE_TASK, recurrence: null },
        timezone: "UTC",
      }),
    );

    expect(html).not.toContain("recurrence-badge");
  });

  it("test_AS_317_shows_no_badge_and_no_broken_state_for_a_task_missing_the_field_entirely", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, { task: BASE_TASK, timezone: "UTC" }),
    );

    expect(html).not.toContain("recurrence-badge");
  });
});
