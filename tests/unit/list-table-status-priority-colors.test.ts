import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// F106 (AS-135): scrutiny Finding 2 found that task-list-table.tsx's
// priority Badge and list-status-select.tsx's status Select rendered with
// no color at all, while the dashboard's charts, BoardColumn's header dot,
// and TaskCard's priority badge all correctly use the shared
// lib/task-colors.ts constants. Same next/navigation mock as
// list-view-empty-state.test.ts, since <DueDateSortHeader>/<ListStatusSelect>
// need router context under plain react-dom/server.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/w/acme/projects/proj-1/list",
  useSearchParams: () => new URLSearchParams(),
}));

import { TaskListTable } from "@/components/task/task-list-table";
import { ListStatusSelect } from "@/components/task/list-status-select";
import { PRIORITY_COLORS, STATUS_COLORS } from "@/lib/task-colors";
import type { TaskCardTask } from "@/components/task/task-card";

const ALL_PRIORITIES: NonNullable<TaskCardTask["priority"]>[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "backlog",
];

const ALL_STATUSES: TaskCardTask["status"][] = [
  "todo",
  "in_progress",
  "in_review",
  "done",
];

describe("List/table view status & priority colors match lib/task-colors.ts (F106: AS-135)", () => {
  it("test_AS_135_list_table_priority_badge_uses_shared_PRIORITY_COLORS_for_every_value", () => {
    for (const priority of ALL_PRIORITIES) {
      const html = renderToStaticMarkup(
        createElement(TaskListTable, {
          tasks: [
            {
              id: `task-${priority}`,
              title: "Task",
              status: "todo",
              priority,
              assigneeId: null,
              dueDate: null,
              position: 1,
            },
          ],
          assignees: new Map(),
          timezone: "UTC",
        }),
      );

      // The priority badge's border/dot color must equal the shared
      // constant's hex value for this priority — not a plain gray badge.
      expect(html).toContain(PRIORITY_COLORS[priority]);
    }
  });

  it("test_AS_135_list_status_select_trigger_dot_uses_shared_STATUS_COLORS_for_every_value", () => {
    for (const status of ALL_STATUSES) {
      const html = renderToStaticMarkup(
        createElement(ListStatusSelect, {
          taskId: "task-1",
          status,
        }),
      );

      expect(html).toContain(STATUS_COLORS[status]);
    }
  });
});
