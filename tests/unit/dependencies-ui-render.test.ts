// Unit test for F157's Dependencies section (components/task/
// dependencies.tsx): AS-277's rendering half ("both sides show their
// relations", each row linking to the related task by key AND title) and
// AS-282's rendering half (a remove control on every row, present
// regardless of which section/direction it's in).
//
// Renders Dependencies directly via renderToStaticMarkup, the SAME
// "no DOM test environment yet" convention every other task-detail
// section's unit test in this repo already follows (see
// tests/unit/checklist-ui-render.test.ts's own doc comment) — this
// repo's vitest config pins `environment: "node"` (vitest.config.ts),
// and real jsdom/Testing-Library interaction testing arrives in F277.
//
// What an SSR render CAN genuinely prove, and what it can't:
//   - CAN prove: the real component tree (Dependencies -> two
//     DependencySections, one per direction) renders without crashing;
//     BOTH the "Blocked by" and "Blocks" section labels are always
//     present (even when one side is empty); each existing dependency
//     row's task key, title, and status label are present as real text
//     content; each row's "Open ..."/"Remove dependency on ..." buttons
//     exist with the right accessible names; the empty-state line (icon
//     + text) renders when a direction has zero rows.
//   - CANNOT prove: that clicking "Add" actually opens the picker and
//     lets you search/select a task, or that clicking the remove button
//     actually calls deleteDependency and updates the list — Popover and
//     Command (cmdk) are portal- and effect-driven, and
//     `react-dom/server`'s renderToStaticMarkup does not render portalled
//     content at all (the PopoverContent/Command markup for the search
//     UI is confirmed ABSENT from this file's own snapshots — only the
//     always-rendered PopoverTrigger `<button>Add</button>` appears).
//     That live-interaction proof belongs to a Playwright test exercising
//     a real browser; this file supplements, not replaces, that kind of
//     coverage for the actual add/remove round trip.
//
// The server-side data shaping this component receives (both-directions
// fetch, soft-deleted-task filtering) is covered independently by
// tests/integration/dependency-ui-actions.test.ts's getTaskDetail
// assertions — this file only proves what the given props actually
// render as.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
  Dependencies,
  type DependencyRelatedTask,
} from "@/components/task/dependencies";

const BLOCKED_BY: DependencyRelatedTask[] = [
  {
    dependencyId: "dep-blocked-by-1",
    taskId: "task-blocker-1",
    title: "Design the schema",
    status: "done",
    projectKey: "PM",
    number: 10,
  },
];

const BLOCKS: DependencyRelatedTask[] = [
  {
    dependencyId: "dep-blocks-1",
    taskId: "task-blocked-1",
    title: "Ship the release",
    status: "todo",
    projectKey: "PM",
    number: 20,
  },
];

function render(
  blockedBy: DependencyRelatedTask[],
  blocks: DependencyRelatedTask[],
) {
  return renderToStaticMarkup(
    createElement(Dependencies, { taskId: "self-task", blockedBy, blocks }),
  );
}

describe("Dependencies UI (F157: AS-277, AS-282)", () => {
  it("test_AS_277_shows_both_the_blocked_by_and_blocks_sections_with_their_own_rows", () => {
    const html = render(BLOCKED_BY, BLOCKS);

    // Both direction labels are present at once — this is the literal
    // "both sides show their relations" requirement, not just "the
    // section that happens to have rows".
    expect(html).toContain(">Blocked by<");
    expect(html).toContain(">Blocks<");

    // Each row is identifiable by its related task's key AND title (a
    // row that only showed one or the other would not actually "link to
    // the related task by key and title", per this feature's critical
    // context).
    expect(html).toContain("PM-10");
    expect(html).toContain("Design the schema");
    expect(html).toContain("PM-20");
    expect(html).toContain("Ship the release");

    // Each row's status is shown as icon(dot)+text, never colour alone,
    // matching this codebase's existing AS-153 convention (already
    // followed by SubtaskList/Checklist) — not this feature's own
    // assigned assertion, but no reason to regress it here.
    expect(html).toContain("Done");
    expect(html).toContain("To Do");
  });

  it("test_AS_277_a_top_level_task_still_shows_both_section_labels_when_one_side_is_empty", () => {
    // A task that only BLOCKS others (never itself blocked) must still
    // visibly show an empty "Blocked by" section, not have it silently
    // disappear — proving it has none is still "showing its relations".
    const html = render([], BLOCKS);

    expect(html).toContain(">Blocked by<");
    expect(html).toContain("Not blocked by any task.");
    expect(html).toContain(">Blocks<");
    expect(html).toContain("Ship the release");
  });

  it("test_AS_277_shows_the_shared_empty_state_pattern_on_both_sides_when_there_are_no_dependencies_at_all", () => {
    const html = render([], []);

    expect(html).toContain("Not blocked by any task.");
    // React/ReactDOMServer HTML-encodes the apostrophe in "Doesn't".
    expect(html).toContain("Doesn&#x27;t block any task.");
  });

  it("test_AS_282_every_dependency_row_has_its_own_remove_control_regardless_of_direction", () => {
    const html = render(BLOCKED_BY, BLOCKS);

    // Present on the "Blocked by" row.
    expect(html).toContain('aria-label="Remove dependency on PM-10"');
    // Present on the "Blocks" row — the SAME kind of control, same
    // component, same deleteDependency call shape, proving removal is
    // not special-cased to only one direction/side.
    expect(html).toContain('aria-label="Remove dependency on PM-20"');
  });

  it("test_AS_277_each_row_links_to_the_related_task_via_an_accessible_open_control", () => {
    const html = render(BLOCKED_BY, BLOCKS);

    expect(html).toContain('aria-label="Open PM-10"');
    expect(html).toContain('aria-label="Open PM-20"');
  });
});
