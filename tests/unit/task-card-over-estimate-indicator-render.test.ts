// Render test for F167 (AS-301: over-estimate tasks are visibly flagged on
// the task card). Same `renderToStaticMarkup` (no jsdom) pattern as
// tests/unit/task-card-blocked-indicator-render.test.ts — see that file's
// doc comment for what this proves/doesn't prove.

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

describe("TaskCard renders the over-estimate indicator (F167: AS-301, AS-302)", () => {
  it("test_AS_301_shows_an_icon_plus_text_over_estimate_badge_when_logged_exceeds_estimate", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: { ...BASE_TASK, estimateMinutes: 60, totalMinutes: 90 },
        timezone: "UTC",
      }),
    );

    expect(html).toContain("Over estimate");
    expect(html).toContain("lucide-triangle-alert");
  });

  it("test_AS_301_shows_no_badge_when_logged_is_within_estimate", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: { ...BASE_TASK, estimateMinutes: 60, totalMinutes: 30 },
        timezone: "UTC",
      }),
    );

    expect(html).not.toContain("Over estimate");
  });

  it("test_AS_302_shows_no_badge_and_no_broken_state_when_no_estimate_is_set", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: { ...BASE_TASK, estimateMinutes: null, totalMinutes: 500 },
        timezone: "UTC",
      }),
    );

    expect(html).not.toContain("Over estimate");
  });
});
