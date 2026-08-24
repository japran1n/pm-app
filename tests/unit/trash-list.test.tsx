import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// F188 (AS-347): the trash list's presentation of "what, by whom, and
// when" for each row — a pure Server Component, tested with a plain
// server-render (no client runtime needed).
//
// TrashList composes the client-side TrashRestoreButton (F189) for task
// rows, which calls next/navigation's useRouter(). react-dom/server's
// renderToStaticMarkup still executes that Client Component's render (it
// has no server/client boundary in this test environment), so the hook
// needs a mock — same convention as board-taskid-deeplink.test.tsx.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { TrashList } from "@/components/trash/trash-list";
import type { TrashItem } from "@/lib/queries/trash";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

describe("TrashList (F188: AS-347)", () => {
  it("test_AS_347_renders_the_deleted_tasks_title_project_deleter_and_time", () => {
    const items: TrashItem[] = [
      {
        id: "t1",
        type: "task",
        label: "Write the launch doc",
        projectId: "p1",
        projectName: "Marketing",
        projectKey: "MKT",
        taskKey: "MKT-12",
        deletedAt: "2026-08-20T10:00:00.000Z",
        deletedByName: "Jamie Rivera",
      },
    ];

    const html = renderToStaticMarkup(
      createElement(TrashList, { items, dateFormatter }),
    );

    expect(html).toContain("Write the launch doc");
    expect(html).toContain("MKT-12");
    expect(html).toContain("Marketing");
    expect(html).toContain("Jamie Rivera");
    expect(html).toContain("Task");
  });

  it("test_AS_347_renders_a_deleted_comments_text_and_deleter_without_a_task_key", () => {
    const items: TrashItem[] = [
      {
        id: "c1",
        type: "comment",
        label: "This is the comment body",
        projectId: "p1",
        projectName: "Marketing",
        projectKey: "MKT",
        taskKey: null,
        deletedAt: "2026-08-20T11:00:00.000Z",
        deletedByName: "Alex Chen",
      },
    ];

    const html = renderToStaticMarkup(
      createElement(TrashList, { items, dateFormatter }),
    );

    expect(html).toContain("This is the comment body");
    expect(html).toContain("Alex Chen");
    expect(html).toContain("Comment");
  });

  it("does not render a deleter name when deletedByName is null (pre-migration/legacy row)", () => {
    const items: TrashItem[] = [
      {
        id: "t2",
        type: "task",
        label: "Legacy deleted task",
        projectId: "p1",
        projectName: "Marketing",
        projectKey: "MKT",
        taskKey: "MKT-13",
        deletedAt: "2026-08-20T12:00:00.000Z",
        deletedByName: null,
      },
    ];

    const html = renderToStaticMarkup(
      createElement(TrashList, { items, dateFormatter }),
    );

    expect(html).not.toContain(" by null");
    expect(html).not.toContain("undefined");
  });
});
