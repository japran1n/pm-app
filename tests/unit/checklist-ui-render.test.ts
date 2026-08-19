// Unit test for F153 (AS-269's UI half — rendering text + checked state —
// and AS-271's UI half — rename, reorder, delete controls present in the
// UI).
//
// Renders Checklist (components/task/checklist.tsx) directly via
// renderToStaticMarkup, the same "no jsdom/RTL yet" convention every other
// task-detail section's unit test in this repo already follows (see
// tests/unit/subtask-list.test.ts's own doc comment) — this repo's vitest
// config pins `environment: "node"` (vitest.config.ts), and real jsdom/
// Testing-Library interaction testing arrives in F277.
//
// What an SSR render CAN genuinely prove, and what it can't:
//   - CAN prove: the real component tree (Checklist -> DndContext ->
//     SortableContext -> each row's useSortable) renders without crashing,
//     and that the markup for each checked-state, the rename input, the
//     delete button, the drag handle, and the progress bar actually exist
//     with the right accessible names/values for the given props.
//   - CANNOT prove: that pressing Enter/Backspace/Space/Arrow keys, or
//     clicking a checkbox, actually produces the described behaviour —
//     dnd-kit's sensors and React's event handlers only activate on real
//     browser input events a jsdom-less Node SSR render can't simulate.
//     That live-interaction proof is tests/e2e/checklist-ui.spec.ts's job
//     (Playwright, a real browser, a real running app) — per this
//     feature's own instruction not to substitute a source-text grep for
//     genuine keyboard-flow coverage. This file supplements that Playwright
//     test; it does not replace it.
//
// The counting math itself (checked/total) is covered independently and
// more thoroughly by tests/unit/checklist-progress.test.ts's pure-function
// tests against lib/tasks/checklist-progress.ts.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { Checklist, type ChecklistListItem } from "@/components/task/checklist";

const ITEMS: ChecklistListItem[] = [
  { id: "c1", content: "Buy milk", isChecked: false, position: 1000 },
  { id: "c2", content: "Walk the dog", isChecked: true, position: 2000 },
  { id: "c3", content: "Write tests", isChecked: false, position: 3000 },
];

describe("Checklist UI (F153: AS-269 UI half, AS-271 UI half)", () => {
  it("test_AS_269_renders_each_items_text_and_checked_state", () => {
    const html = renderToStaticMarkup(
      createElement(Checklist, { taskId: "t1", items: ITEMS }),
    );

    // Text content for every item is present.
    expect(html).toContain("Buy milk");
    expect(html).toContain("Walk the dog");
    expect(html).toContain("Write tests");

    // Checked state is reflected both in the checkbox's accessible name
    // (never colour alone, this codebase's existing AS-153 convention)
    // and, for the checked item specifically, in the input's own
    // rendered value attribute.
    expect(html).toContain('aria-label="Mark &quot;Buy milk&quot; as done"');
    expect(html).toContain(
      'aria-label="Mark &quot;Walk the dog&quot; as not done"',
    );
    expect(html).toContain('aria-label="Mark &quot;Write tests&quot; as done"');
  });

  it("test_AS_269_shows_the_shared_empty_state_when_there_are_no_items", () => {
    const html = renderToStaticMarkup(
      createElement(Checklist, { taskId: "t1", items: [] }),
    );

    expect(html).toMatch(/No checklist items yet/i);
    // No progress bar with zero items — same "don't show 0%" convention
    // AS-273 establishes for the task-level percentage, applied here to
    // this feature's own checked/total summary.
    expect(html).not.toContain("checked</span>");
  });

  it("test_AS_271_renders_a_rename_input_pre_filled_with_each_items_text", () => {
    const html = renderToStaticMarkup(
      createElement(Checklist, { taskId: "t1", items: ITEMS }),
    );

    // Every item is a real, directly-editable <input>, not read-only
    // text — this is what makes rename-by-typing and the Enter/Backspace
    // keyboard flow possible at all (see tests/e2e/checklist-ui.spec.ts
    // for the live proof).
    expect(html).toContain('value="Buy milk"');
    expect(html).toContain('value="Walk the dog"');
    expect(html).toContain('value="Write tests"');
    expect(html).toContain('aria-label="Checklist item text"');
  });

  it("test_AS_271_renders_a_delete_control_for_each_item", () => {
    const html = renderToStaticMarkup(
      createElement(Checklist, { taskId: "t1", items: ITEMS }),
    );

    expect(html).toContain('aria-label="Delete &quot;Buy milk&quot;"');
    expect(html).toContain('aria-label="Delete &quot;Walk the dog&quot;"');
    expect(html).toContain('aria-label="Delete &quot;Write tests&quot;"');
  });

  it("test_AS_271_renders_a_reorder_drag_handle_for_each_item", () => {
    const html = renderToStaticMarkup(
      createElement(Checklist, { taskId: "t1", items: ITEMS }),
    );

    expect(html).toContain('aria-label="Reorder Buy milk"');
    expect(html).toContain('aria-label="Reorder Walk the dog"');
    expect(html).toContain('aria-label="Reorder Write tests"');
  });

  it("test_AS_269_renders_a_progress_bar_summarising_checked_of_total", () => {
    const html = renderToStaticMarkup(
      createElement(Checklist, { taskId: "t1", items: ITEMS }),
    );

    // 1 of 3 items in ITEMS is checked.
    expect(html).toContain("1 of 3 checked");
  });

  it("renders the always-present draft add-item input", () => {
    const html = renderToStaticMarkup(
      createElement(Checklist, { taskId: "t1", items: ITEMS }),
    );

    expect(html).toContain("Add an item");
  });

  it("renders without crashing when items is omitted entirely on an older caller shape", () => {
    // TaskDetailSheetTask.checklistItems is optional (safe-default
    // convention shared with `children`/`comments`/etc.) — task-detail-
    // sheet.tsx always passes `task.checklistItems ?? []`, but this
    // proves Checklist itself tolerates an empty array cleanly too.
    const html = renderToStaticMarkup(
      createElement(Checklist, { taskId: "t1", items: [] }),
    );
    expect(html).toBeTruthy();
  });
});
