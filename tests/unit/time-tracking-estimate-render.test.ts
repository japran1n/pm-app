// Render test for F167 (AS-300: the detail view shows estimate against
// actual; AS-301: over-estimate is visibly flagged; AS-302: no estimate
// means logged time only, no bar, no flag). Same `renderToStaticMarkup`
// (no jsdom) pattern as tests/unit/task-card-blocked-indicator-render.test.ts.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { TimeTracking, type TimeEntry } from "@/components/task/time-tracking";

const ENTRIES: TimeEntry[] = [
  {
    id: "entry-1",
    taskId: "task-1",
    userId: "user-1",
    minutes: 90,
    billable: true,
    entryDate: "2026-08-01",
    note: null,
  },
];

describe("TimeTracking renders estimate vs. logged time (F167)", () => {
  it("test_AS_300_shows_logged_time_against_the_estimate", () => {
    const html = renderToStaticMarkup(
      createElement(TimeTracking, {
        taskId: "task-1",
        timeEntries: ENTRIES,
        members: [],
        estimateMinutes: 120,
      }),
    );

    expect(html).toContain("estimate-progress");
    expect(html).toContain("estimated");
    expect(html).toContain("1h 30m");
  });

  it("test_AS_301_shows_an_over_estimate_badge_when_logged_exceeds_the_estimate", () => {
    const html = renderToStaticMarkup(
      createElement(TimeTracking, {
        taskId: "task-1",
        timeEntries: ENTRIES,
        members: [],
        estimateMinutes: 60,
      }),
    );

    expect(html).toContain("Over estimate");
    expect(html).toContain("lucide-triangle-alert");
  });

  it("test_AS_301_shows_no_over_estimate_badge_when_logged_is_within_the_estimate", () => {
    const html = renderToStaticMarkup(
      createElement(TimeTracking, {
        taskId: "task-1",
        timeEntries: ENTRIES,
        members: [],
        estimateMinutes: 240,
      }),
    );

    expect(html).not.toContain("Over estimate");
  });

  it("test_AS_302_shows_logged_time_only_with_no_progress_bar_or_flag_when_no_estimate_is_set", () => {
    const html = renderToStaticMarkup(
      createElement(TimeTracking, {
        taskId: "task-1",
        timeEntries: ENTRIES,
        members: [],
        estimateMinutes: null,
      }),
    );

    expect(html).not.toContain("estimate-progress");
    expect(html).not.toContain("Over estimate");
    expect(html).not.toContain("estimated");
    // The already-existing logged-time total still renders.
    expect(html).toContain("1h 30m");
  });

  it("test_AS_302_shows_no_progress_bar_or_flag_when_estimateMinutes_prop_is_omitted", () => {
    const html = renderToStaticMarkup(
      createElement(TimeTracking, {
        taskId: "task-1",
        timeEntries: ENTRIES,
        members: [],
      }),
    );

    expect(html).not.toContain("estimate-progress");
    expect(html).not.toContain("Over estimate");
  });
});
