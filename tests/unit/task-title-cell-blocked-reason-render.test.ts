// Render test: TaskTitleCell's "Blocked" workflow-status indicator (shared
// by TaskListTable and My Tasks). Same `renderToStaticMarkup` (no jsdom)
// pattern as tests/unit/task-card-blocked-reason-indicator-render.test.ts.
// TaskListTable itself only ever passes a non-null `blockedReason` prop
// when `task.status` already reads "blocked" (see that file's call site)
// — this test exercises TaskTitleCell directly against both states of its
// own prop, since the status<->prop gating is the caller's job, not
// TaskTitleCell's.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { TaskTitleCell } from "@/components/task/task-title-cell";

describe("TaskTitleCell renders the blocked-reason indicator", () => {
  it("test_shows_icon_plus_tooltip_when_blockedReason_is_set", () => {
    const html = renderToStaticMarkup(
      createElement(TaskTitleCell, {
        title: "Redesign homepage",
        blockedReason: "Waiting on final copy from the client",
      }),
    );

    expect(html).toContain('data-testid="blocked-reason-indicator"');
    expect(html).toContain("lucide-triangle-alert");
    expect(html).toContain("Waiting on final copy from the client");
  });

  it("test_hides_the_indicator_when_blockedReason_is_null", () => {
    const html = renderToStaticMarkup(
      createElement(TaskTitleCell, {
        title: "Redesign homepage",
        blockedReason: null,
      }),
    );

    expect(html).not.toContain('data-testid="blocked-reason-indicator"');
  });

  it("test_hides_the_indicator_when_blockedReason_is_undefined", () => {
    const html = renderToStaticMarkup(
      createElement(TaskTitleCell, {
        title: "Redesign homepage",
      }),
    );

    expect(html).not.toContain('data-testid="blocked-reason-indicator"');
  });
});
