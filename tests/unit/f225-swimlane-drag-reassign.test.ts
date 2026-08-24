// F225 (AS-420, AS-425): dragging a task between swimlanes reassigns the
// grouped field (assignee/priority/tag) on top of whatever the status/
// position change already does; a same-lane drag (including any pure
// within-column reorder) leaves the grouped field untouched.
//
// Same "no jsdom, source-inspection" constraint as
// tests/unit/board-optimistic-rollback-toast.test.ts (dnd-kit's sensors
// only activate on real browser pointer/keyboard events — vitest.config.ts
// pins `environment: "node"`) — this file renders the real component tree
// to prove nothing crashes with real grouped props, and inspects board.tsx
// AND swimlane.tsx AND board-column.tsx's source to prove the id-encoding/
// decoding scheme and the dispatch-to-the-real-actions wiring this
// feature's cross-lane drop depends on. The REAL end-to-end DB proof (the
// action calls actually mutate `task_assignees`/`tasks.tags`/
// `tasks.priority`, and a viewer is rejected) lives in
// tests/integration/f225-swimlane-drag-reassign.test.ts.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

vi.mock("@/lib/actions/tasks", () => ({
  moveAndReorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  reorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  setTaskAssignees: vi.fn(async () => ({ ok: true, data: {} })),
  updateTaskTags: vi.fn(async () => ({ ok: true, data: {} })),
  editTask: vi.fn(async () => ({ ok: true, data: {} })),
  createTask: vi.fn(async () => ({ ok: true, data: {} })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/w/acme/projects/proj-1/board",
  useSearchParams: () => new URLSearchParams("groupBy=assignee"),
}));

import { Board } from "@/components/board/board";
import type { TaskCardTask } from "@/components/task/task-card";

const boardSource = readFileSync(
  fileURLToPath(new URL("../../components/board/board.tsx", import.meta.url)),
  "utf-8",
);
const swimlaneSource = readFileSync(
  fileURLToPath(new URL("../../components/board/swimlane.tsx", import.meta.url)),
  "utf-8",
);
const boardColumnSource = readFileSync(
  fileURLToPath(new URL("../../components/board/board-column.tsx", import.meta.url)),
  "utf-8",
);
const sortableTaskCardSource = readFileSync(
  fileURLToPath(new URL("../../components/board/sortable-task-card.tsx", import.meta.url)),
  "utf-8",
);

const TASKS: TaskCardTask[] = [
  {
    id: "t1",
    title: "Multi-assignee task",
    status: "todo",
    priority: "low",
    assigneeId: "u1",
    assigneeIds: ["u1", "u2"],
    tags: ["bug"],
    dueDate: null,
    position: 1000,
  },
];

describe("F225 swimlane-drag-reassign (AS-420, AS-425)", () => {
  it("test_AS_420_grouped_board_renders_with_real_drag_enabled_not_hardcoded_off", () => {
    // Board renders without crashing with real grouped props/mocked
    // actions in place -- proves the wiring below is reachable, not dead
    // code.
    const html = renderToStaticMarkup(
      createElement(Board, {
        projectId: "proj-1",
        initialTasks: TASKS,
        timezone: "UTC",
        assignees: new Map([
          ["u1", { id: "u1", name: "User One", email: "one@example.com" }],
          ["u2", { id: "u2", name: "User Two", email: "two@example.com" }],
        ]),
      }),
    );
    expect(html).toContain("data-swimlane");

    // F224 left Swimlane hardcoding canDrag={false} unconditionally as its
    // explicit seam for this feature -- that must be gone now: Swimlane is
    // called with the board's REAL canDrag value, not a literal false.
    expect(boardSource).not.toMatch(/<Swimlane[\s\S]*?canDrag=\{false\}/);
    expect(boardSource).toMatch(/<Swimlane[\s\S]*?canDrag=\{canDrag\}/);
  });

  it("test_AS_420_swimlane_forwards_a_real_canDrag_prop_to_each_BoardColumn", () => {
    expect(swimlaneSource).not.toMatch(/<BoardColumn[\s\S]*?canDrag=\{false\}/);
    expect(swimlaneSource).toMatch(/<BoardColumn[\s\S]*?canDrag=\{canDrag\}/);
    expect(swimlaneSource).toMatch(/laneKey=\{laneKey\}/);
  });

  it("test_AS_420_dnd_ids_are_lane_prefixed_so_a_multi_lane_task_never_collides_across_lanes", () => {
    // BoardColumn composes a distinct dndId per (lane, task) pair for
    // every SortableTaskCard it renders, mirroring its own pre-existing
    // `dropId` composition -- the exact mechanism that lets the SAME task
    // (rendered in every matching lane, per F224's multi-value rule)
    // resolve back to its real id and real source lane in board.tsx's
    // onDragEnd.
    expect(boardColumnSource).toMatch(/laneKey\s*\?\s*`\$\{laneKey\}::\$\{taskId\}`\s*:\s*taskId/);
    expect(boardColumnSource).toMatch(/dndId=\{dndIdFor\(task\.id\)\}/);
    expect(sortableTaskCardSource).toMatch(/id:\s*dndId\s*\?\?\s*task\.id/);
  });

  it("test_AS_420_handleDragEnd_decodes_lane_prefixed_ids_and_computes_crossLane", () => {
    expect(boardSource).toMatch(/function parseDndId/);
    expect(boardSource).toMatch(/const crossLane =/);
    expect(boardSource).toMatch(/sourceLaneKey !== targetLaneKey/);
  });

  it("test_AS_420_priority_cross_lane_drag_reassigns_via_editTask_not_a_direct_write", () => {
    // Single-valued grouping mode -- must go through the real action
    // layer (editTask), never a direct Supabase table write from the
    // client.
    expect(boardSource).toMatch(
      /groupBy === "priority"[\s\S]{0,400}editTask\(movedTask\.id, \{ priority: movedTask\.priority \}\)/,
    );
  });

  it("test_AS_420_assignee_cross_lane_drag_moves_not_just_adds_and_handles_None_lane_both_directions", () => {
    // "Move" semantics: the source lane's id is removed from the desired
    // set before the target's is added -- this is what makes a task
    // dragged out of one lane stop appearing in it (F224's multi-lane
    // rendering rule), while every OTHER existing assignee is left alone.
    expect(boardSource).toMatch(
      /nextAssigneeIds = current\.filter\(\(id\) => id !== sourceLaneKey\)/,
    );
    // Dropping into "None" adds nothing; dragging out of "None" (source
    // === the sentinel) is naturally a no-op removal, so both directions
    // degrade correctly from the same computation, not two special cases.
    expect(boardSource).toMatch(
      /targetLaneKey !== SWIMLANE_NONE_KEY[\s\S]{0,80}nextAssigneeIds\.includes/,
    );
    expect(boardSource).toMatch(
      /setTaskAssignees\(movedTask\.id, movedTask\.assigneeIds \?\? \[\]\)/,
    );
  });

  it("test_AS_420_tag_cross_lane_drag_moves_not_just_adds_and_handles_None_lane_both_directions", () => {
    expect(boardSource).toMatch(/nextTags = current\.filter\(\(tag\) => tag !== sourceLaneKey\)/);
    expect(boardSource).toMatch(
      /targetLaneKey !== SWIMLANE_NONE_KEY[\s\S]{0,80}nextTags\.includes/,
    );
    expect(boardSource).toMatch(/updateTaskTags\(movedTask\.id, movedTask\.tags \?\? \[\]\)/);
  });

  it("test_AS_420_a_none_grouping_never_reaches_the_reassignment_branch", () => {
    // `groupBy !== "none"` gates `crossLane` -- an ungrouped board's plain
    // ids are never lane-prefixed (parseDndId's own early return), so
    // `sourceLaneKey`/`targetLaneKey` are always `null` there, and
    // `crossLane` is unconditionally `false`.
    expect(boardSource).toMatch(
      /const crossLane =\s*\n\s*groupBy !== "none" &&/,
    );
  });

  it("test_AS_425_within_column_reorder_is_untouched_by_the_grouped_field_wiring", () => {
    // The status/position dispatch (moveAndReorderTask / reorderTask) is
    // an entirely separate branch from the grouped-field dispatch --
    // AS-425's within-column reorder while grouped only ever hits
    // reorderTask (status unchanged), never the crossLane branch, since a
    // reorder within the same lane's same column never changes
    // source/target lane keys.
    expect(boardSource).toMatch(
      /reorderTask\(movedTask\.id, newPosition\)/,
    );
    // Both dispatches share the SAME rollback/rolledBack guard -- a
    // failure from either one produces exactly one toast, matching this
    // board's existing single-rollback convention (F047/F102) rather than
    // inventing a second one for this feature.
    const rollbackDeclIndex = boardSource.indexOf("let rolledBack = false;");
    expect(rollbackDeclIndex).toBeGreaterThan(-1);
    // The DISPATCH (not the earlier groupFieldPatch computation, which
    // also mentions `groupBy === "priority"`) is the occurrence AFTER the
    // rollback guard is declared.
    const crossLaneDispatchIndex = boardSource.indexOf(
      'if (crossLane && groupBy === "priority") {',
      rollbackDeclIndex,
    );
    expect(crossLaneDispatchIndex).toBeGreaterThan(rollbackDeclIndex);
  });

  it("test_AS_420_a_drop_directly_on_an_empty_column_resolves_the_real_status_name_not_the_column_id", () => {
    // Swimlane's droppable id is `${laneKey}::${column.id}` (a column ID,
    // not its name) -- board.tsx must resolve that id back to the
    // column's real `name` (what every task's `status` field is actually
    // keyed on) before validating/persisting, exactly the same way the
    // ungrouped board's own `dropId` (which defaults to the column's
    // name) already resolves.
    expect(boardSource).toMatch(
      /const targetColumnById = columns\.find\(\(c\) => c\.id === overRealId\)/,
    );
    expect(boardSource).toMatch(
      /overTask \? overTask\.status : \(targetColumnById\?\.name \?\? overRealId\)/,
    );
  });
});
