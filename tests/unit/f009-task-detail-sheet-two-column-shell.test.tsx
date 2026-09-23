// @vitest-environment jsdom
//
// F009 (TT-020, TT-022, TT-026): proves TaskDetailSheet's content area is
// structured as a two-column grid — `grid-cols-1` by default (collapsed,
// single column, no horizontal scroll below `lg`) with an `lg:grid-cols-`
// override that switches to two columns at the `lg` breakpoint — and that
// a right-column placeholder (`data-testid="detail-right-column"`,
// populated later by F010) exists alongside the left column's existing
// TaskDetailFields/TaskDetailSections content. jsdom has no real viewport/
// media-query engine (see sibling F246 test's own note on jsdom
// limitations), so this asserts on the actual Tailwind grid classes
// present on the DOM node rather than a computed layout at a given
// width — the same "assert on the responsive utility classes, since jsdom
// can't apply them" approach already used elsewhere in this suite for
// responsive assertions. Also re-confirms TT-026: the `?taskId=` deep
// link still opens the sheet with this new shell in place.

import { createElement } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/actions/custom-fields", () => ({
  getCustomFieldsForTaskAction: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  setTaskCustomFieldValue: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/actions/page-links", () => ({
  getPageLinksForTaskAction: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  createPageLink: vi.fn(),
  updatePageLink: vi.fn(),
  deletePageLink: vi.fn(),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";

vi.mock("@/lib/actions/tasks", () => ({
  moveAndReorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  reorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  createTask: vi.fn(async () => ({ ok: true, data: {} })),
  getTaskDetail: vi.fn(async (taskId: string) => ({
    ok: true,
    data: {
      task: {
        id: taskId,
        title: "Two-column shell task",
        description: null,
        status: "todo",
        priority: null,
        assigneeId: null,
        dueDate: null,
        tags: [],
        projectKey: "SHELL",
        number: 9,
      },
      comments: [],
      attachments: [],
      currentUserId: "user-1",
      currentUserRole: "member",
    },
  })),
}));

// TT-026: the sheet is driven open purely by the `?taskId=` URL param —
// same mock shape as tests/unit/board-taskid-deeplink.test.tsx and F246's
// own copy-link test.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/w/acme/projects/proj-1/board",
  useSearchParams: () => new URLSearchParams("taskId=t1"),
}));

vi.mock("@/lib/actions/comments", () => ({
  getMentionCandidates: vi.fn(async () => ({ ok: true, data: [] })),
}));

import { Board } from "@/components/board/board";
import { getTaskDetail } from "@/lib/actions/tasks";
import type { TaskCardTask } from "@/components/task/task-card";

function makeFakeSupabaseRealtimeClient() {
  const channelObject = {
    on: vi.fn(() => channelObject),
    subscribe: vi.fn(() => channelObject),
  };
  return {
    channel: vi.fn(() => channelObject),
    removeChannel: vi.fn(),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
    },
  };
}
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => makeFakeSupabaseRealtimeClient(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const TASKS: TaskCardTask[] = [
  {
    id: "t1",
    title: "Two-column shell task",
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 1000,
    projectKey: "SHELL",
    number: 9,
  },
];

describe("TaskDetailSheet two-column shell (F009, TT-020/TT-022/TT-026)", () => {
  it("test_TT_020_TT_022_grid_collapses_to_one_column_and_expands_to_two_at_lg", async () => {
    render(
      createElement(Board, {
        projectId: "project-1",
        initialTasks: TASKS,
        timezone: "UTC",
      }),
    );

    // TT-026: deep link opened the sheet via ?taskId=t1.
    await waitFor(() => expect(getTaskDetail).toHaveBeenCalledWith("t1"));
    await waitFor(() =>
      expect(
        screen.getByDisplayValue("Two-column shell task", { exact: false }),
      ).toBeInTheDocument(),
    );

    const rightColumn = await screen.findByTestId("detail-right-column");
    // The grid container is the right column's parent.
    const grid = rightColumn.parentElement;
    expect(grid).not.toBeNull();

    // TT-022: single column by default (no breakpoint prefix) — collapses
    // below lg, and since this base class has no responsive qualifier it
    // never causes horizontal overflow at narrow widths.
    expect(grid).toHaveClass("grid-cols-1");

    // TT-020: at lg it becomes a two-column grid (main content ~1.6fr
    // left, right rail ~1fr).
    expect(grid?.className).toMatch(/lg:grid-cols-\[1\.6fr_1fr\]/);

    // F010 (TT-021): the right column is now populated (status/
    // assignees/priority/dates/tags/time-tracked, portaled in from
    // TaskDetailFields/TaskDetailSections) — no longer the empty
    // placeholder this test originally asserted pre-F010.
    await waitFor(() => expect(rightColumn).not.toBeEmptyDOMElement());
    expect(within(rightColumn).getByText("Status")).toBeInTheDocument();
  });
});
