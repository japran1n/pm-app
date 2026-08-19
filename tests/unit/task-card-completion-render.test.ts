// Render tests for F154 (AS-272, AS-273's UI half, AS-525) — proving the
// completion percentage actually appears (or doesn't) in <TaskCard>'s
// real rendered markup, not just that lib/tasks/completion.ts's pure math
// is correct (that's tests/unit/task-completion.test.ts's job).
//
// Same `renderToStaticMarkup` (no jsdom) pattern as
// tests/unit/task-key-display-render.test.ts and
// tests/unit/checklist-ui-render.test.ts, both of which document what
// this kind of test can and can't prove for this repo's node-only vitest
// environment (vitest.config.ts: environment: "node" — a real DOM test
// environment isn't available until F277):
//   - CAN prove: given a `task.completion` value, the card's real
//     component tree renders (or omits) the percentage text and the
//     accessible label built from it.
//   - CANNOT prove: that the percentage stays visually legible at every
//     viewport, or that the fill bar's CSS actually paints the right
//     width in a real browser — that's a rendering/visual concern outside
//     what an SSR render can check.
//
// AS-525 (checked late in the mission): the completion value must be
// conveyed as text, not colour alone. The assertions below check for the
// literal `NN%` text content and the `aria-label` carrying the same
// number, not just the presence of the fill-bar `<span>` — a
// colour-only implementation would fail every one of these.

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

describe("TaskCard renders completion percentage (F154: AS-272, AS-273, AS-525)", () => {
  it("test_AS_272_shows_the_percentage_as_text_when_completion_is_present", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: {
          ...BASE_TASK,
          completion: { done: 2, total: 4, percent: 50 },
        },
        timezone: "UTC",
      }),
    );

    // AS-525: the number itself is real text content, not just a
    // colour-coded fill width.
    expect(html).toContain("50%");
    expect(html).toContain('aria-label="50% complete, 2 of 4"');
  });

  it("test_AS_273_renders_no_percentage_at_all_when_completion_is_null", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: { ...BASE_TASK, completion: null },
        timezone: "UTC",
      }),
    );

    expect(html).not.toContain("%");
    expect(html).toContain(BASE_TASK.title);
  });

  it("test_AS_273_renders_no_percentage_when_completion_is_undefined_(caller has not fetched it)", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, { task: { ...BASE_TASK }, timezone: "UTC" }),
    );

    expect(html).not.toContain("%");
  });

  it("test_AS_272_renders_a_genuine_0_percent_measurement_distinctly_from_the_no-measurement_case", () => {
    // 0 of 3 done is a real measurement (something exists to measure),
    // unlike AS-273's null case above — the card DOES show "0%" here.
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: {
          ...BASE_TASK,
          completion: { done: 0, total: 3, percent: 0 },
        },
        timezone: "UTC",
      }),
    );

    expect(html).toContain("0%");
  });

  it("test_AS_272_renders_100_percent_when_everything_is_done", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: {
          ...BASE_TASK,
          completion: { done: 3, total: 3, percent: 100 },
        },
        timezone: "UTC",
      }),
    );

    expect(html).toContain("100%");
  });
});
