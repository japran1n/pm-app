// UX audit fix (list page, Nalaz 1): the project List page previously
// rendered TWO visually equal create-task entry points — the quick-add row
// above the table (task-list-table.tsx's "+ Add task") and a full-size
// "+ New Task" dialog trigger in the page toolbar. This was confusing (two
// CTAs for the same underlying action). Decision: quick-add stays the one
// primary entry point; the full dialog is kept (it genuinely covers more —
// description, priority, phase, task type, multiple assignees up front —
// which the title-only quick-add row can't) but is demoted to a small,
// secondary "Advanced..." trigger rather than a second equally-weighted CTA.
//
// This repo has no jsdom/DOM-rendering setup for this Server Component page
// (it's an async Server Component with many data dependencies), so this is
// a source-level check — matching the convention new-task-dialog.test.ts
// already uses for its own "wires X" assertions — that the page passes the
// demoted variant/size/label props to <NewTaskDialog> instead of rendering
// it as the default full-size button.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("List page create-task entry points (Nalaz 1)", () => {
  it("test_list_page_demotes_the_new_task_dialog_to_a_small_secondary_advanced_trigger", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL(
          "../../app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    const newTaskDialogCall = source.match(/<NewTaskDialog[\s\S]*?\/>/)?.[0] ?? "";
    expect(newTaskDialogCall).not.toBe("");
    // Demoted, not the default full-weight button.
    expect(newTaskDialogCall).toMatch(/variant="outline"/);
    expect(newTaskDialogCall).toMatch(/size="sm"/);
    expect(newTaskDialogCall).toMatch(/triggerLabel="Advanced\.\.\."/);
  });

  it("test_list_page_still_renders_the_quick_add_table_component_as_the_primary_entry_point", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL(
          "../../app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    // <TaskListTable> is the component that renders the "+ Add task"
    // quick-add row (components/task/task-list-table.tsx) — it must still
    // be the page's rendered task list.
    expect(source).toMatch(/<TaskListTable/);
  });
});
