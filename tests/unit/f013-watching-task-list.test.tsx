// @vitest-environment jsdom
//
// F013 (SB-051): the extracted `WatchingTaskList` is the SAME component
// both the standalone /watching page and the Inbox "Watching" tab render —
// this test exercises it directly against the assertion's actual text
// ("each tab shows the same items the corresponding old page showed"),
// not against either call site's wiring.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WatchingTaskList } from "@/components/watching/watching-task-list";
import type { WatchedTaskListItem } from "@/lib/queries/watching";

const TASK: WatchedTaskListItem = {
  taskId: "task-1",
  taskTitle: "Fix the login bug",
  taskKey: "PM-142",
  projectId: "proj-1",
  projectName: "Apollo",
  status: "in_progress",
  dueDate: null,
  lastActivityAt: "2026-06-01T10:00:00.000Z",
  lastActivitySummary: "Status changed to In Progress",
};

describe("SB-051: Watching tab content reuse", () => {
  it("test_SB_051_watching_list_renders_task_title_project_and_link", () => {
    const html = renderToStaticMarkup(
      createElement(WatchingTaskList, { workspaceSlug: "acme", watchedTasks: [TASK] }),
    );

    expect(html).toContain("Fix the login bug");
    expect(html).toContain("Apollo");
    expect(html).toContain('href="/w/acme/t/PM-142"');
    expect(html).toContain("Status changed to In Progress");
  });

  it("test_SB_051_watching_list_empty_state_when_no_watched_tasks", () => {
    const html = renderToStaticMarkup(
      createElement(WatchingTaskList, { workspaceSlug: "acme", watchedTasks: [] }),
    );

    expect(html).toContain("You&#x27;re not watching any tasks");
  });

  it("test_SB_051_falls_back_to_project_list_link_when_task_has_no_key", () => {
    const html = renderToStaticMarkup(
      createElement(WatchingTaskList, {
        workspaceSlug: "acme",
        watchedTasks: [{ ...TASK, taskKey: null }],
      }),
    );

    expect(html).toContain('href="/w/acme/projects/proj-1/list"');
  });
});
