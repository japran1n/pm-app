// F234 (AS-445): component-level wiring test for
// components/calendar/calendar-day-grid.tsx -- follows this repo's
// established "no jsdom/@testing-library drag-gesture simulation" pattern
// for dnd-kit components (see tests/unit/board-dnd-setup.test.ts and
// board-optimistic-rollback-toast.test.ts's own doc comments: dnd-kit's
// sensors only activate on real browser pointer/keyboard events, which a
// `environment: "node"` vitest run can't produce -- real drag-gesture
// interaction is Playwright's job). What IS verified without a browser:
//
//   1. The real component tree (CalendarDayGrid -> DndContext -> DayCell
//      -> useDroppable/useDraggable) renders server-side without crashing.
//   2. Source-level proof that the reschedule path goes through the REAL
//      `editTask` Server Action (never a parallel/hand-rolled mutation),
//      via the pure `planReschedule` helper (unit-tested on its own in
//      tests/unit/f234-calendar-reschedule-plan.test.ts).
//   3. Source-level proof of the optimistic-update-then-rollback-with-
//      single-toast convention, matching board.tsx's own handleDragEnd
//      shape exactly (setByDate before the action call, one `rollback`
//      helper guarded by a `rolledBack` flag, `toast.error` from sonner).
//   4. Source-level proof dragging is gated on the caller's workspace
//      write permission (`canWrite`), same predicate/fallback board.tsx
//      uses for the identical "don't offer a drag that will always fail"
//      requirement.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

vi.mock("@/lib/actions/tasks", () => ({
  editTask: vi.fn(async () => ({ ok: false, error: "Could not reschedule task." })),
}));

import { CalendarDayGrid } from "@/components/calendar/calendar-day-grid";
import type { CalendarDay } from "@/lib/calendar/month-grid";
import type { CalendarTask } from "@/lib/queries/calendar";

const gridSource = readFileSync(
  fileURLToPath(new URL("../../components/calendar/calendar-day-grid.tsx", import.meta.url)),
  "utf-8",
);

const DAYS: CalendarDay[] = [
  { date: "2026-06-10", isCurrentMonth: true, isToday: false },
  { date: "2026-06-11", isCurrentMonth: true, isToday: false },
];

const TASK: CalendarTask = {
  id: "task-1",
  title: "F234 draggable task",
  status: "todo",
  statusCategory: null,
  isDone: false,
  priority: "high",
  dueDate: "2026-06-10",
  number: 1,
  projectId: "project-1",
  projectKey: "PRJ",
  projectName: "Project",
  assignees: [],
};

describe("F234 CalendarDayGrid wiring (AS-445)", () => {
  it("renders the DndContext-wrapped grid with real day cells and tasks, without crashing", () => {
    const html = renderToStaticMarkup(
      createElement(CalendarDayGrid, {
        days: DAYS,
        tasksByDate: { "2026-06-10": [TASK] },
        workspaceSlug: "acme",
      }),
    );
    expect(html).toContain("F234 draggable task");
    expect(html).toContain('data-testid="calendar-day-grid"');
  });

  it("imports the REAL editTask Server Action, never a parallel mutation or a direct due_date write", () => {
    expect(gridSource).toMatch(
      /import\s*{\s*editTask\s*}\s*from\s*["']@\/lib\/actions\/tasks["']/,
    );
    // The mutation call itself uses `dueDate` (editTask's own camelCase
    // field name) -- never a raw `due_date` column write from this file.
    expect(gridSource).toMatch(/editTask\(taskId, \{ dueDate: targetDate \}\)/);
  });

  it("plans the move via the pure planReschedule helper before touching any state", () => {
    expect(gridSource).toMatch(
      /import\s*{\s*planReschedule\s*}\s*from\s*["']@\/lib\/calendar\/reschedule["']/,
    );
    const planIndex = gridSource.indexOf("const plan = planReschedule(");
    const setByDateIndex = gridSource.indexOf("setByDate(plan.nextTasksByDate)");
    const editTaskCallIndex = gridSource.indexOf("editTask(taskId, { dueDate: targetDate })");
    expect(planIndex).toBeGreaterThan(-1);
    expect(setByDateIndex).toBeGreaterThan(planIndex);
    // The optimistic update is committed before the real Server Action
    // call is kicked off -- same ordering board.tsx's handleDragEnd uses.
    expect(editTaskCallIndex).toBeGreaterThan(setByDateIndex);
  });

  it("imports sonner's toast for rollback feedback", () => {
    expect(gridSource).toMatch(
      /import\s*{\s*toast\s*}\s*from\s*["']sonner["']/,
    );
  });

  it("defines a single-fire rollback() guarded by a rolledBack flag, restoring the pre-drop snapshot and showing exactly one error toast", () => {
    expect(gridSource).toMatch(/let rolledBack = false;/);
    expect(gridSource).toMatch(/function rollback\(message: string\) \{/);
    expect(gridSource).toMatch(/if \(rolledBack\) return;/);
    expect(gridSource).toMatch(/rolledBack = true;/);
    expect(gridSource).toMatch(/setByDate\(snapshot\);/);
    expect(gridSource).toMatch(/toast\.error\(message\);/);
  });

  it("gates dragging on the caller's workspace write permission via canWrite, same predicate board.tsx uses", () => {
    expect(gridSource).toMatch(
      /import\s*{\s*canWrite\s*}\s*from\s*["']@\/lib\/auth\/permissions["']/,
    );
    expect(gridSource).toMatch(
      /const canDrag = membership \? canWrite\(\{ role: membership\.role \}\) : true;/,
    );
  });
});
