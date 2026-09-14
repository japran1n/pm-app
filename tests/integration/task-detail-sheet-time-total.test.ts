// Integration test for F113 (AS-171): "A task's total logged time (sum of
// minutes) is displayed on the task card and in the task detail sheet."
//
// TaskDetailSheet wraps its content in the shadcn Sheet (Radix Dialog)
// primitive, which only portals/renders its content client-side — even
// with `open: true`, renderToStaticMarkup produces no content for it (see
// tests/unit/board-task-detail-sheet-wiring.test.ts's own note: "the sheet
// is closed by default — its content shouldn't be in the initial SSR
// markup ... shadcn Sheet only portals/renders its content when open").
// That test's own approach is followed here: (1) render the TimeTracking
// section TaskDetailSheet composes directly — same SSR-render-and-
// inspect-markup approach as tests/unit/comment-list.test.ts (no jsdom/
// @testing-library — vitest.config.ts pins environment: "node") — to prove
// the total is computed and displayed correctly, and (2) inspect
// task-detail-sheet.tsx's source to prove it actually wires `timeEntries`
// into that same TimeTracking section inside its Sheet.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
  TimeTracking,
  type TimeEntry,
  type TimeTrackingMember,
} from "@/components/task/time-tracking";

const taskDetailSheetSource = readFileSync(
  fileURLToPath(
    new URL("../../components/task/task-detail-sheet.tsx", import.meta.url),
  ),
  "utf-8",
);

const taskDetailSectionsSource = readFileSync(
  fileURLToPath(
    new URL("../../components/task/task-detail-sections.tsx", import.meta.url),
  ),
  "utf-8",
);

const MEMBERS: TimeTrackingMember[] = [
  { userId: "u1", email: "alice@example.com", name: "Alice Anderson" },
];

function renderSheet(timeEntries: TimeEntry[]) {
  return renderToStaticMarkup(
    createElement(TimeTracking, {
      taskId: "t1",
      timeEntries,
      members: MEMBERS,
      currentUserId: "u1",
      currentUserRole: "member",
    }),
  );
}

describe("TaskDetailSheet wires timeEntries into TimeTracking (AS-171)", () => {
  it("imports and renders <TimeTracking> with the timeEntries prop, inside the sheet", () => {
    // ARCH-005: the sheet's feature panels were extracted into
    // TaskDetailSections — the sheet threads timeEntries through it, and
    // the sections component imports and renders <TimeTracking>.
    expect(taskDetailSheetSource).toMatch(/timeEntries=\{timeEntries\}/);
    expect(taskDetailSectionsSource).toMatch(
      /import\s*\{[\s\S]*?\bTimeTracking,/,
    );
    expect(taskDetailSectionsSource).toMatch(/<TimeTracking/);
    expect(taskDetailSectionsSource).toMatch(/timeEntries=\{timeEntries\}/);
  });
});

describe("TaskDetailSheet time total (AS-171)", () => {
  it("test_AS_171_shows_0m_when_no_time_logged", () => {
    const markup = renderSheet([]);
    expect(markup).toContain("0m");
  });

  it("test_AS_171_shows_correct_total_for_initial_entries", () => {
    const entries: TimeEntry[] = [
      {
        id: "e1",
        taskId: "t1",
        userId: "u1",
        minutes: 45,
        billable: true,
        entryDate: "2026-08-10",
        note: null,
      },
      {
        id: "e2",
        taskId: "t1",
        userId: "u1",
        minutes: 90,
        billable: false,
        entryDate: "2026-08-11",
        note: null,
      },
    ];
    // 45 + 90 = 135 minutes = 2h 15m
    const markup = renderSheet(entries);
    expect(markup).toContain("2h 15m");
  });

  it("test_AS_171_total_reflects_entries_as_if_after_logging_more_time", () => {
    // Simulates the state TimeTracking's local entries array would be in
    // after a successful logTimeEntry call appended a third entry on top
    // of the two above (optimistic-append convention) — the total must
    // include the newly logged entry.
    const entriesAfterLogging: TimeEntry[] = [
      {
        id: "e1",
        taskId: "t1",
        userId: "u1",
        minutes: 45,
        billable: true,
        entryDate: "2026-08-10",
        note: null,
      },
      {
        id: "e2",
        taskId: "t1",
        userId: "u1",
        minutes: 90,
        billable: false,
        entryDate: "2026-08-11",
        note: null,
      },
      {
        id: "e3",
        taskId: "t1",
        userId: "u1",
        minutes: 30,
        billable: true,
        entryDate: "2026-08-12",
        note: "Just logged",
      },
    ];
    // 45 + 90 + 30 = 165 minutes = 2h 45m
    const markup = renderSheet(entriesAfterLogging);
    expect(markup).toContain("2h 45m");
    expect(markup).not.toContain("2h 15m");
  });
});
