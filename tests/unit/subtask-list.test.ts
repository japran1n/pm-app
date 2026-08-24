// Unit test for F150 (AS-264, and the append/count logic AS-263 also
// leans on for the parent-side half of the loop).
//
// Renders SubtaskList (components/task/subtask-list.tsx) directly, the
// same component task-detail-sheet.tsx composes, mirroring
// tests/unit/attachment-list.test.ts's/tests/unit/comment-list.test.ts's
// renderToStaticMarkup convention (no jsdom/RTL in this repo's vitest
// setup yet — that arrives in F277; see vitest.config.ts's `node`
// environment).
//
//   AS-264: a parent task displays its children with their status, and
//     shows a completion count ("N of M done"). Covered both at the
//     rendered-markup level (status label text is present, the count
//     text is present) and at the pure-function level
//     (countSubtaskProgress, lib/tasks/subtask-progress.ts) that the
//     component's count derives from — so this behaviour would fail
//     regardless of how the component happens to render it, per the
//     "tests must derive from the assertion, not the implementation"
//     rule.
//   The optimistic-append half ("the Subtasks section updates
//     immediately after adding one, without a page reload") is asserted
//     at the level this component actually delegates to: the pure
//     `appendSubtask` reducer (lib/tasks/append-subtask.ts), same
//     "extract a pure reducer for a DOM-free unit test" convention
//     lib/tasks/append-attachment.ts/lib/tasks/reconcile-realtime-comment.ts
//     already establish in this codebase.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
  SubtaskList,
  type SubtaskListChildTask,
  type SubtaskListMember,
} from "@/components/task/subtask-list";
import { appendSubtask } from "@/lib/tasks/append-subtask";
import { countSubtaskProgress } from "@/lib/tasks/subtask-progress";

const MEMBERS: SubtaskListMember[] = [
  { userId: "u1", email: "alice@example.com", name: "Alice Anderson" },
  { userId: "u2", email: "bob@example.com", name: null },
];

const CHILDREN: SubtaskListChildTask[] = [
  {
    id: "c1",
    title: "Write the migration",
    status: "done",
    assigneeId: "u1",
    projectKey: "PM",
    number: 101,
  },
  {
    id: "c2",
    title: "Wire the UI",
    status: "in_progress",
    assigneeId: "u2",
    projectKey: "PM",
    number: 102,
  },
  {
    id: "c3",
    title: "Write tests",
    status: "todo",
    assigneeId: null,
    projectKey: "PM",
    number: 103,
  },
];

function render(children: SubtaskListChildTask[] = CHILDREN) {
  return renderToStaticMarkup(
    createElement(SubtaskList, {
      taskId: "parent-1",
      projectId: "project-1",
      childTasks: children,
      members: MEMBERS,
    }),
  );
}

describe("SubtaskList (F150: AS-264)", () => {
  it("test_AS_264_a_parent_shows_each_childs_title_and_status_label", () => {
    const html = render();

    expect(html).toContain("Write the migration");
    expect(html).toContain("Done");
    expect(html).toContain("Wire the UI");
    expect(html).toContain("In Progress");
    expect(html).toContain("Write tests");
    expect(html).toContain("To Do");
  });

  it("test_AS_264_a_parent_shows_a_completion_count_of_done_out_of_total", () => {
    const html = render();

    // 1 of the 3 seeded children has status "done".
    expect(html).toContain("1 of 3 done");
  });

  it("test_AS_264_zero_children_renders_the_empty_state_and_no_count", () => {
    const html = render([]);

    expect(html).toContain("No subtasks yet");
    expect(html).not.toMatch(/\d+ of \d+ done/);
  });

  it("test_AS_264_all_children_done_shows_the_full_count", () => {
    const html = render(
      CHILDREN.map((child) => ({ ...child, status: "done" as const })),
    );

    expect(html).toContain("3 of 3 done");
  });

  it("test_AS_264_a_childs_assignee_avatar_renders_when_assigned", () => {
    const html = render();

    // UserAvatar renders an accessible name from the resolved member
    // (name, falling back to email) — same authorOf/assigneeOf
    // resolution convention CommentList/TaskCard already use.
    expect(html).toContain("Alice Anderson");
    expect(html).toContain("bob@example.com");
  });
});

describe("countSubtaskProgress (F150: AS-264 pure logic)", () => {
  it("test_AS_264_counts_only_status_done_children_as_complete", () => {
    expect(countSubtaskProgress(CHILDREN)).toEqual({ done: 1, total: 3 });
  });

  it("test_AS_264_empty_list_is_zero_of_zero", () => {
    expect(countSubtaskProgress([])).toEqual({ done: 0, total: 0 });
  });

  it("test_AS_264_a_non_done_status_never_counts_as_complete", () => {
    const allOpen = CHILDREN.map((child) => ({
      ...child,
      status: "in_review" as const,
    }));
    expect(countSubtaskProgress(allOpen)).toEqual({ done: 0, total: 3 });
  });

  // F222 (AS-410): category-aware counting when a child has been fetched
  // with its column's category.
  it("test_AS_410_a_renamed_done_category_child_column_counts_toward_progress", () => {
    const renamed = CHILDREN.map((child) => ({
      ...child,
      status: "Shipped",
      statusCategory: "done",
    }));
    expect(countSubtaskProgress(renamed)).toEqual({ done: 3, total: 3 });
  });

  it("test_AS_410_a_child_named_like_done_but_not_done_category_does_not_count", () => {
    const doneish = CHILDREN.map((child) => ({
      ...child,
      status: "done-ish",
      statusCategory: "in_progress",
    }));
    expect(countSubtaskProgress(doneish)).toEqual({ done: 0, total: 3 });
  });
});

describe("appendSubtask (F150: local list updates without a reload)", () => {
  it("test_AS_264_a_newly_added_subtask_appends_to_the_visible_list", () => {
    const created: SubtaskListChildTask = {
      id: "c4",
      title: "New subtask",
      status: "todo",
      assigneeId: null,
    };

    const next = appendSubtask(CHILDREN, created);

    expect(next).toHaveLength(CHILDREN.length + 1);
    expect(next.some((child) => child.id === "c4")).toBe(true);

    const html = renderToStaticMarkup(
      createElement(SubtaskList, {
        taskId: "parent-1",
        projectId: "project-1",
        childTasks: next,
        members: MEMBERS,
      }),
    );
    expect(html).toContain("New subtask");
    // Count updates too: still only c1 is "done".
    expect(html).toContain("1 of 4 done");
  });

  it("test_AS_264_duplicate_append_is_idempotent_by_id", () => {
    const [first] = CHILDREN;
    const next = appendSubtask(CHILDREN, first);

    expect(next).toHaveLength(CHILDREN.length);
  });

  it("test_AS_264_append_to_empty_list_shows_the_new_subtask_not_the_empty_state", () => {
    const created: SubtaskListChildTask = {
      id: "c1",
      title: "First subtask",
      status: "todo",
      assigneeId: null,
    };

    const next = appendSubtask([], created);
    const html = renderToStaticMarkup(
      createElement(SubtaskList, {
        taskId: "parent-1",
        projectId: "project-1",
        childTasks: next,
        members: MEMBERS,
      }),
    );

    expect(html).toContain("First subtask");
    expect(html).not.toContain("No subtasks yet");
  });
});
