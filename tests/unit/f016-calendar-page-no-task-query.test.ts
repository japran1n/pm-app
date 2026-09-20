// F016/F059 (AS-034): "The calendar page issues no task query."
//
// Source-text guard: reads the calendar page + WeekView subtree source
// files directly and asserts none of them imports from the task query
// modules, calls getCalendarTasks, or declares task-shaped searchParams.
// This is intentionally NOT a mocked render test -- it fails the moment
// anyone re-adds a task fetch anywhere in this subtree, regardless of how
// the fetch is wired up (static import, dynamic import, re-export).

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");

const FILES = [
  "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx",
  "components/calendar/week-view.tsx",
  "components/calendar/week-time-grid.tsx",
  "components/calendar/week-agenda.tsx",
];

// Quoted forms so "@/lib/queries/calendar" doesn't false-positive on the
// legitimate "@/lib/queries/calendar-blocks" module.
const FORBIDDEN_STRINGS = [
  '"@/lib/queries/calendar"',
  "'@/lib/queries/calendar'",
  '"@/lib/queries/tasks"',
  "'@/lib/queries/tasks'",
  "getCalendarTasks",
];

function readSource(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

describe("F016/F059 calendar page issues no task query (AS-034)", () => {
  for (const file of FILES) {
    for (const forbidden of FORBIDDEN_STRINGS) {
      it(`test_AS_034_${file}_does_not_reference_${forbidden.replace(/[^a-zA-Z0-9]+/g, "_")}`, () => {
        const source = readSource(file);
        expect(source).not.toContain(forbidden);
      });
    }
  }

  it("test_AS_034_calendar_page_searchParams_type_has_no_task_shaped_fields", () => {
    const source = readSource(
      "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx",
    );

    const searchParamsMatch = source.match(
      /searchParams:\s*Promise<\{([\s\S]*?)\}>/,
    );
    expect(searchParamsMatch).not.toBeNull();
    const searchParamsType = searchParamsMatch![1]!;

    for (const field of [
      "status:",
      "priority:",
      "assigneeId:",
      "projectId:",
      "taskId:",
    ]) {
      expect(searchParamsType).not.toContain(field);
    }
  });
});
