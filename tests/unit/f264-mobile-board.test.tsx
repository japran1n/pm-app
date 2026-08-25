// @vitest-environment jsdom
//
// F264 (AS-514, AS-515): the board on phone-width screens.
//
// AS-514 ("columns are reachable by horizontal swipe on a phone"): tested
// at the source level, following this repo's own established convention
// for CSS-only behaviour that jsdom can't meaningfully assert on (jsdom
// has no real layout/scroll engine, so a real DOM test can't observe
// "does this actually scroll-snap" -- see board-move-status-wiring.test.ts's
// own doc comment for the identical rationale applied to a different
// feature). What IS asserted: the real column container carries CSS
// scroll-snap classes gated to the mobile breakpoint (`max-sm:`), and each
// column is a non-shrinking snap child sized to leave a visible peek of
// the next column (this feature's chosen "partial peek" indicator).
//
// AS-515 ("tasks can be moved between columns without a mouse"): tested
// with a REAL DOM render (@testing-library/react + jsdom) of
// SortableTaskCard in isolation -- no DndContext, no drag/pointer
// simulation at all, proving the "Move to" menu action is reachable and
// wired up without any drag interaction whatsoever, i.e. genuinely a
// no-mouse-needed path, not a drag fallback.

import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SortableTaskCard } from "@/components/board/sortable-task-card";
import type { TaskCardTask } from "@/components/task/task-card";

afterEach(() => cleanup());

// jsdom's `import.meta.url` isn't a real `file://` URL, so (unlike the
// node-environment tests elsewhere in this suite) source files here are
// read relative to `process.cwd()` (vitest always runs from the repo
// root).
const boardColumnSource = readFileSync(
  path.join(process.cwd(), "components/board/board-column.tsx"),
  "utf-8",
);
const boardSource = readFileSync(
  path.join(process.cwd(), "components/board/board.tsx"),
  "utf-8",
);
const swimlaneSource = readFileSync(
  path.join(process.cwd(), "components/board/swimlane.tsx"),
  "utf-8",
);

const TASK: TaskCardTask = {
  id: "task-1",
  title: "Ship the mobile board",
  status: "todo",
  priority: null,
  assigneeId: null,
  dueDate: null,
  position: 1000,
};

describe("AS-514: columns are reachable by horizontal swipe on a phone", () => {
  it("BoardColumn carries mobile-only CSS scroll-snap classes on each column", () => {
    // Each column is a snap child (`max-sm:snap-center`) that doesn't
    // shrink to fit the viewport (`max-sm:shrink-0`) and leaves a visible
    // peek of the next column (`max-sm:w-[88vw]`, less than 100vw) --
    // together these are what make the row an actual swipeable carousel
    // rather than squeezed-in columns with no snap points.
    expect(boardColumnSource).toMatch(/max-sm:snap-center/);
    expect(boardColumnSource).toMatch(/max-sm:shrink-0/);
    expect(boardColumnSource).toMatch(/max-sm:w-\[\d+vw\]/);
  });

  it("BoardColumn resets flex-basis to auto below the mobile breakpoint so max-sm:w-[88vw] actually governs sizing (bugfix, post-handoff)", () => {
    // Regression test: the base class list includes `flex-1`, which
    // resolves to a non-`auto` flex-basis. Per the flexbox spec, a
    // non-`auto` flex-basis makes the browser ignore the `width` property
    // for main-axis sizing -- so without an explicit `max-sm:flex-none`
    // (or equivalent basis-auto/grow-0 reset) at the mobile breakpoint,
    // `max-sm:w-[88vw]` above is silently overridden by flex-grow evenly
    // splitting the row among every column instead of one column taking
    // ~88vw. Confirmed live via getComputedStyle at a 375px viewport
    // before this fix (resolved width was ~50px, an even 1/4 split).
    expect(boardColumnSource).toMatch(/max-sm:flex-none/);
  });

  it("Board's ungrouped column row and Swimlane's per-lane column row both opt the row into snap-mandatory scrolling on mobile", () => {
    expect(boardSource).toMatch(/max-sm:snap-x max-sm:snap-mandatory/);
    expect(swimlaneSource).toMatch(/max-sm:snap-x max-sm:snap-mandatory/);
  });
});

describe("AS-515: tasks can be moved between columns without a mouse", () => {
  it("does not render a 'Move to' trigger when no target columns are supplied (safe default for not-yet-updated callers)", () => {
    render(
      createElement(SortableTaskCard, {
        task: TASK,
        timezone: "UTC",
      }),
    );
    expect(
      screen.queryByRole("button", { name: /Move ".*" to another column/i }),
    ).toBeNull();
  });

  it("opening the 'Move to' menu and choosing a column calls onMoveToColumn with the task id and the target column's real name -- reachable with zero drag/pointer-drag events", () => {
    const onMoveToColumn = vi.fn();

    render(
      createElement(SortableTaskCard, {
        task: TASK,
        timezone: "UTC",
        moveToColumnOptions: [
          { name: "in_progress", label: "In Progress" },
          { name: "done", label: "Done" },
        ],
        onMoveToColumn,
      }),
    );

    const trigger = screen.getByRole("button", {
      name: 'Move "Ship the mobile board" to another column',
    });
    fireEvent.click(trigger);

    const doneItem = screen.getByText("Done");
    fireEvent.click(doneItem);

    expect(onMoveToColumn).toHaveBeenCalledWith("task-1", "done");
  });

  it("hides the 'in_progress'/'done' options for the column the task is currently already in (board.tsx excludes the task's own column from its options)", () => {
    // Source-level check: board.tsx builds each column's option list by
    // filtering OUT that same column, never including "move to the column
    // it's already in".
    expect(boardSource).toMatch(
      /sortedColumns\s*\.filter\(\(other\)\s*=>\s*other\.id\s*!==\s*column\.id\)/,
    );
  });

  it("Board wires a dedicated handleMoveToColumn that calls moveAndReorderTask directly -- not through dnd-kit's onDragEnd/DragOverlay", () => {
    expect(boardSource).toMatch(/async function handleMoveToColumn\(/);
    expect(boardSource).toMatch(
      /async function handleMoveToColumn\([\s\S]*?moveAndReorderTask\(\s*\n?\s*taskId,\s*\n?\s*targetStatus,\s*\n?\s*newPosition,?\s*\n?\s*\);/,
    );
  });

  it("rolls back and shows a toast when the move fails (Clarified implementation's failure-handling answer)", () => {
    expect(boardSource).toMatch(
      /async function handleMoveToColumn[\s\S]*?if\s*\(!result\.ok\)\s*{\s*setTasks\(snapshot\);\s*toast\.error\(result\.error\);/,
    );
  });
});
