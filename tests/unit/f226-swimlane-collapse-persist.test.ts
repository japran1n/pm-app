// Unit tests for F226 swimlane-collapse-persist (AS-422, AS-424).
//
// AS-422: a collapsed lane stays collapsed across reloads.
// AS-424: the chosen grouping persists per user per project.
//
// Renders the REAL <Board> component tree (same pattern as
// tests/unit/f224-board-swimlane-grouping.test.ts's Part 2) with
// `initialSwimlanePrefs` -- the server-fetched persisted preference this
// feature's board page now passes down -- to prove the wiring from
// "persisted state" to "first paint already reflects it" actually reaches
// the DOM, not just that the Server Action round-trips (that's covered by
// tests/integration/f226-swimlane-collapse-persist.test.ts, which drives
// the REAL Server Actions against the real database and is the primary
// proof for both assertions).

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

vi.mock("@/lib/actions/tasks", () => ({
  moveAndReorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  reorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  createTask: vi.fn(async () => ({ ok: true, data: {} })),
}));

const upsertBoardSwimlanePrefsMock = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/actions/board-prefs", () => ({
  upsertBoardSwimlanePrefs: (...args: unknown[]) =>
    upsertBoardSwimlanePrefsMock(...args),
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

describe("Board swimlane collapse persistence (F226: AS-422, AS-424)", () => {
  it("test_AS_424_no_groupBy_in_the_URL_falls_back_to_the_viewer_s_persisted_grouping_preference", () => {
    mockSearchParams = new URLSearchParams(); // no ?groupBy= at all
    const html = renderToStaticMarkup(
      createElement(Board, {
        projectId: "project-1",
        initialTasks: BOARD_TASKS,
        timezone: "UTC",
        assignees: new Map([
          ["u1", { id: "u1", name: "Alice", email: "alice@example.com" }],
        ]),
        initialSwimlanePrefs: { groupBy: "assignee", collapsedLanes: {} },
      }),
    );
    // Persisted "assignee" grouping renders lanes, not the flat layout —
    // proving the persisted preference (not the hardcoded "none" default)
    // won on first paint.
    expect(html).toContain("data-swimlane");
    expect(html).toContain("Alice");
  });

  it("test_AS_424_an_explicit_groupBy_none_in_the_URL_still_wins_over_a_persisted_non_none_preference", () => {
    mockSearchParams = new URLSearchParams("groupBy=none");
    const html = renderToStaticMarkup(
      createElement(Board, {
        projectId: "project-1",
        initialTasks: BOARD_TASKS,
        timezone: "UTC",
        initialSwimlanePrefs: { groupBy: "assignee", collapsedLanes: {} },
      }),
    );
    expect(html).not.toContain("data-swimlane");
  });

  it("test_AS_422_a_persisted_collapsed_lane_renders_collapsed_on_first_paint_hiding_its_columns", () => {
    mockSearchParams = new URLSearchParams("groupBy=assignee");
    const html = renderToStaticMarkup(
      createElement(Board, {
        projectId: "project-1",
        initialTasks: BOARD_TASKS,
        timezone: "UTC",
        assignees: new Map([
          ["u1", { id: "u1", name: "Alice", email: "alice@example.com" }],
        ]),
        initialSwimlanePrefs: {
          groupBy: "assignee",
          collapsedLanes: { assignee: ["u1"] },
        },
      }),
    );
    // The collapsed lane's own section renders data-collapsed="true" and
    // hides its task card, while the NOT-collapsed "None" lane still shows
    // its own task — proving collapse is applied per lane, not globally.
    expect(html).toContain('data-collapsed="true"');
    expect(html).not.toContain("Assigned task");
    expect(html).toContain("Unassigned task");
  });

  it("test_AS_422_a_lane_not_in_the_persisted_collapsed_set_renders_expanded", () => {
    mockSearchParams = new URLSearchParams("groupBy=priority");
    const html = renderToStaticMarkup(
      createElement(Board, {
        projectId: "project-1",
        initialTasks: BOARD_TASKS,
        timezone: "UTC",
        initialSwimlanePrefs: {
          groupBy: "priority",
          // Collapsed set belongs to a DIFFERENT mode ("assignee") than
          // the one actually rendered ("priority") — must not leak across.
          collapsedLanes: { assignee: ["u1"] },
        },
      }),
    );
    expect(html).toContain('data-collapsed="false"');
    expect(html).not.toContain('data-collapsed="true"');
    expect(html).toContain("Unassigned task");
    expect(html).toContain("Assigned task");
  });
});
