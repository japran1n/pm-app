// Unit tests for F224 board-grouping-swimlanes.
//
// AS-418: the board can be grouped into swimlanes (by assignee, priority,
//   or tag).
// AS-419: with no grouping, the board renders as before.
// AS-421: each lane shows its own per-column counts.
// AS-423: tasks without a value appear in a "None" lane.
//
// Part 1 exercises the pure grouping logic (lib/board/grouping.ts)
// directly -- this is the one piece of new logic in this feature, so it's
// unit-tested against the assertion text rather than mirroring the
// implementation. Part 2 renders the real <Board> component (the actual
// component the board page composes) with the URL's `groupBy` param
// mocked, to prove the toolbar/Swimlane wiring, not just the pure
// function, actually reaches the DOM -- same "renders the real component
// tree" pattern tests/unit/board-move-status-wiring.test.ts already
// established for this same component.

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
  groupTasksIntoSwimlanes,
  SWIMLANE_NONE_KEY,
} from "@/lib/board/grouping";

type T = {
  id: string;
  priority?: string | null;
  assigneeId?: string | null;
  assigneeIds?: string[];
  tags?: string[];
};

describe("groupTasksIntoSwimlanes (F224: AS-418, AS-419, AS-421, AS-423)", () => {
  it("test_AS_419_groupBy_none_returns_a_single_group_containing_every_task_unchanged", () => {
    const tasks: T[] = [{ id: "a" }, { id: "b" }];
    const groups = groupTasksIntoSwimlanes(tasks, "none");
    expect(groups).toHaveLength(1);
    expect(groups[0].tasks).toEqual(tasks);
  });

  it("test_AS_418_groups_by_priority_into_one_lane_per_priority_value", () => {
    const tasks: T[] = [
      { id: "a", priority: "urgent" },
      { id: "b", priority: "low" },
      { id: "c", priority: "urgent" },
    ];
    const groups = groupTasksIntoSwimlanes(tasks, "priority");
    const urgent = groups.find((g) => g.key === "urgent");
    const low = groups.find((g) => g.key === "low");
    expect(urgent?.tasks.map((t) => t.id).sort()).toEqual(["a", "c"]);
    expect(low?.tasks.map((t) => t.id)).toEqual(["b"]);
  });

  it("priority lanes are ordered urgent -> high -> medium -> low -> backlog", () => {
    const tasks: T[] = [
      { id: "a", priority: "backlog" },
      { id: "b", priority: "urgent" },
      { id: "c", priority: "medium" },
    ];
    const groups = groupTasksIntoSwimlanes(tasks, "priority");
    expect(groups.map((g) => g.key)).toEqual(["urgent", "medium", "backlog"]);
  });

  it("test_AS_418_groups_by_assignee_and_a_multi_assignee_task_appears_in_every_one_of_its_lanes", () => {
    const tasks: T[] = [
      { id: "a", assigneeIds: ["u1", "u2"] },
      { id: "b", assigneeIds: ["u1"] },
    ];
    const groups = groupTasksIntoSwimlanes(tasks, "assignee");
    const u1 = groups.find((g) => g.key === "u1");
    const u2 = groups.find((g) => g.key === "u2");
    expect(u1?.tasks.map((t) => t.id).sort()).toEqual(["a", "b"]);
    expect(u2?.tasks.map((t) => t.id)).toEqual(["a"]);
    // AS-421 groundwork: summed lane counts (2 + 1 = 3) legitimately
    // exceed the real task count (2) for a multi-assignee task, by design.
    expect((u1?.tasks.length ?? 0) + (u2?.tasks.length ?? 0)).toBeGreaterThan(
      tasks.length,
    );
  });

  it("falls back to the single legacy assigneeId when assigneeIds is empty/absent", () => {
    const tasks: T[] = [{ id: "a", assigneeId: "u1", assigneeIds: [] }];
    const groups = groupTasksIntoSwimlanes(tasks, "assignee");
    expect(groups.find((g) => g.key === "u1")?.tasks.map((t) => t.id)).toEqual([
      "a",
    ]);
  });

  it("test_AS_418_groups_by_tag_and_a_multi_tag_task_appears_in_every_one_of_its_lanes", () => {
    const tasks: T[] = [
      { id: "a", tags: ["bug", "urgent-fix"] },
      { id: "b", tags: ["bug"] },
    ];
    const groups = groupTasksIntoSwimlanes(tasks, "tag");
    expect(groups.find((g) => g.key === "bug")?.tasks.map((t) => t.id).sort()).toEqual(
      ["a", "b"],
    );
    expect(
      groups.find((g) => g.key === "urgent-fix")?.tasks.map((t) => t.id),
    ).toEqual(["a"]);
  });

  it("test_AS_423_tasks_with_no_priority_value_land_in_an_explicit_None_lane", () => {
    const tasks: T[] = [{ id: "a", priority: null }, { id: "b", priority: "high" }];
    const groups = groupTasksIntoSwimlanes(tasks, "priority");
    const none = groups.find((g) => g.key === SWIMLANE_NONE_KEY);
    expect(none?.tasks.map((t) => t.id)).toEqual(["a"]);
  });

  it("test_AS_423_tasks_with_no_assignee_land_in_an_explicit_None_lane", () => {
    const tasks: T[] = [{ id: "a" }, { id: "b", assigneeId: "u1" }];
    const groups = groupTasksIntoSwimlanes(tasks, "assignee");
    const none = groups.find((g) => g.key === SWIMLANE_NONE_KEY);
    expect(none?.tasks.map((t) => t.id)).toEqual(["a"]);
  });

  it("test_AS_423_tasks_with_no_tags_land_in_an_explicit_None_lane", () => {
    const tasks: T[] = [{ id: "a", tags: [] }, { id: "b", tags: ["x"] }];
    const groups = groupTasksIntoSwimlanes(tasks, "tag");
    const none = groups.find((g) => g.key === SWIMLANE_NONE_KEY);
    expect(none?.tasks.map((t) => t.id)).toEqual(["a"]);
  });

  it("the None lane is omitted entirely when every task has a value", () => {
    const tasks: T[] = [{ id: "a", priority: "high" }, { id: "b", priority: "low" }];
    const groups = groupTasksIntoSwimlanes(tasks, "priority");
    expect(groups.some((g) => g.key === SWIMLANE_NONE_KEY)).toBe(false);
  });

  it("the None lane always renders last regardless of groupBy", () => {
    const tasks: T[] = [
      { id: "a", priority: null },
      { id: "b", priority: "backlog" },
      { id: "c", priority: "urgent" },
    ];
    const groups = groupTasksIntoSwimlanes(tasks, "priority");
    expect(groups[groups.length - 1].key).toBe(SWIMLANE_NONE_KEY);
  });
});

// ---------------------------------------------------------------------
// Part 2: the real <Board> component, grouped and ungrouped.
// ---------------------------------------------------------------------

vi.mock("@/lib/actions/tasks", () => ({
  moveAndReorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  reorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  createTask: vi.fn(async () => ({ ok: true, data: {} })),
}));

let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/w/acme/projects/proj-1/board",
  useSearchParams: () => mockSearchParams,
}));

const { Board } = await import("@/components/board/board");
type TaskCardTask = import("@/components/task/task-card").TaskCardTask;

const BOARD_TASKS: TaskCardTask[] = [
  {
    id: "t1",
    title: "Unassigned task",
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 1000,
  },
  {
    id: "t2",
    title: "Assigned task",
    status: "in_progress",
    priority: "high",
    assigneeId: "u1",
    assigneeIds: ["u1"],
    dueDate: null,
    position: 1000,
  },
];

describe("Board grouping wiring (F224: AS-418, AS-419, AS-421, AS-423)", () => {
  it("test_AS_419_with_no_groupBy_param_renders_the_flat_ungrouped_layout", () => {
    mockSearchParams = new URLSearchParams();
    const html = renderToStaticMarkup(
      createElement(Board, {
        projectId: "project-1",
        initialTasks: BOARD_TASKS,
        timezone: "UTC",
      }),
    );
    expect(html).toContain("Unassigned task");
    expect(html).toContain("Assigned task");
    // No lane sections in the ungrouped layout.
    expect(html).not.toContain("data-swimlane");
  });

  it("test_AS_418_groupBy_assignee_renders_lane_sections_including_a_None_lane", () => {
    mockSearchParams = new URLSearchParams("groupBy=assignee");
    const html = renderToStaticMarkup(
      createElement(Board, {
        projectId: "project-1",
        initialTasks: BOARD_TASKS,
        timezone: "UTC",
        assignees: new Map([
          ["u1", { id: "u1", name: "Alice", email: "alice@example.com" }],
        ]),
      }),
    );
    expect(html).toContain("data-swimlane");
    expect(html).toContain("Alice");
    // AS-423: the unassigned task's lane.
    expect(html).toContain("None");
    expect(html).toContain("Unassigned task");
    expect(html).toContain("Assigned task");
  });

  it("test_AS_421_each_lane_renders_its_own_per_column_task_count", () => {
    mockSearchParams = new URLSearchParams("groupBy=priority");
    const html = renderToStaticMarkup(
      createElement(Board, {
        projectId: "project-1",
        initialTasks: BOARD_TASKS,
        timezone: "UTC",
      }),
    );
    // Each BoardColumn inside each lane renders its own "(N)" count badge
    // (board-column.tsx's pre-existing per-column count, reused unchanged
    // by Swimlane) -- both the "high" lane's in_progress column and the
    // None lane's todo column show a count of exactly 1.
    const countMatches = html.match(/\(1\)/g) ?? [];
    expect(countMatches.length).toBeGreaterThanOrEqual(2);
  });
});
