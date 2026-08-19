// Render test for F157 (AS-283: "a blocked task shows a visible
// indicator on its card, using an icon plus text rather than colour
// alone").
//
// Same `renderToStaticMarkup` (no jsdom) pattern as
// tests/unit/task-card-completion-render.test.ts and
// tests/unit/checklist-ui-render.test.ts, both of which document what
// this kind of test can/can't prove for this repo's node-only vitest
// environment (vitest.config.ts: environment: "node"):
//   - CAN prove: given a `task.openBlockerCount` value, TaskCard's real
//     component tree renders (or omits) the "Blocked" icon+text
//     indicator, and that the text is real text content (not conveyed by
//     the icon/colour alone).
//   - CANNOT prove: visual legibility at a given viewport or real browser
//     paint — outside what an SSR render can check.
//
// The underlying "which tasks currently have an open blocker" computation
// (open vs. done blockers, no per-card query) is covered independently
// and more thoroughly by
// tests/integration/dependency-ui-actions.test.ts's getProjectBoardTasks
// assertions — this file only proves what a given `openBlockerCount`
// value actually renders as on the card.

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

describe("TaskCard renders the blocked indicator (F157: AS-283)", () => {
  it("test_AS_283_shows_an_icon_plus_text_blocked_indicator_when_openBlockerCount_is_positive", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: { ...BASE_TASK, openBlockerCount: 1 },
        timezone: "UTC",
      }),
    );

    // Text, not colour alone (AS-283's literal requirement) — the word
    // "Blocked" must appear as real text content.
    expect(html).toContain("Blocked");
    // Paired with an icon (lucide's "ban" glyph), same icon+text
    // convention this card already uses for its overdue indicator.
    expect(html).toContain("lucide-ban");
  });

  it("test_AS_283_shows_no_blocked_indicator_when_openBlockerCount_is_undefined", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: { ...BASE_TASK, openBlockerCount: undefined },
        timezone: "UTC",
      }),
    );

    expect(html).not.toContain("Blocked");
    expect(html).not.toContain("lucide-ban");
  });

  it("test_AS_283_shows_no_blocked_indicator_when_openBlockerCount_is_zero", () => {
    // Zero means "not currently blocked" (e.g. every blocker is done),
    // same "undefined/0 both hide the indicator" contract as
    // `subtaskCount`/`totalMinutes` elsewhere on this card.
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: { ...BASE_TASK, openBlockerCount: 0 },
        timezone: "UTC",
      }),
    );

    expect(html).not.toContain("Blocked");
    expect(html).not.toContain("lucide-ban");
  });
});
