// BUGFIX: TaskDetailSheet (F039) was fully built — title/description/
// priority/assignee/due-date editing, tags, comments, attachments — but
// was never rendered anywhere in the app, and TaskCard's onClick was never
// wired to anything (see board.tsx's own former comment: "opening the
// task detail sheet via TaskCard's onClick, once that's wired up"). This
// test proves the board now actually wires a click through to the sheet.
//
// Same "no jsdom/@testing-library" constraint as
// tests/unit/board-optimistic-rollback-toast.test.ts (vitest.config.ts
// pins environment: "node") — dnd-kit's real pointer events, and a real
// click-then-see-the-sheet-open interaction, need a browser DOM this repo
// doesn't run here (that's covered by the Playwright suite, per the same
// established pattern). This test instead combines an SSR smoke render
// (proves the wiring renders without crashing, TaskDetailSheet included)
// with source inspection (proves the actual click -> open -> fetch wiring
// exists), matching board-optimistic-rollback-toast.test.ts's own
// established approach for exactly this kind of interaction.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

vi.mock("@/lib/actions/tasks", () => ({
  moveAndReorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  reorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  createTask: vi.fn(async () => ({ ok: true, data: {} })),
  getTaskDetail: vi.fn(async () => ({
    ok: true,
    data: {
      task: {
        id: "t1",
        title: "Todo task",
        description: null,
        status: "todo",
        priority: null,
        assigneeId: null,
        dueDate: null,
        tags: [],
      },
      comments: [],
      attachments: [],
      currentUserId: "user-1",
      currentUserRole: "member",
    },
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { Board } from "@/components/board/board";
import { getTaskDetail } from "@/lib/actions/tasks";
import type { TaskCardTask } from "@/components/task/task-card";

const TASKS: TaskCardTask[] = [
  {
    id: "t1",
    title: "Todo task",
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 1000,
  },
];

const boardSource = readFileSync(
  fileURLToPath(new URL("../../components/board/board.tsx", import.meta.url)),
  "utf-8",
);
const sortableTaskCardSource = readFileSync(
  fileURLToPath(
    new URL("../../components/board/sortable-task-card.tsx", import.meta.url),
  ),
  "utf-8",
);
const taskCardSource = readFileSync(
  fileURLToPath(new URL("../../components/task/task-card.tsx", import.meta.url)),
  "utf-8",
);
const useTaskDetailSheetSource = readFileSync(
  fileURLToPath(
    new URL(
      "../../components/task/use-task-detail-sheet.ts",
      import.meta.url,
    ),
  ),
  "utf-8",
);

describe("Board wires TaskCard clicks to TaskDetailSheet (bugfix)", () => {
  it("renders the board (TaskDetailSheet included) without crashing, with no task open by default", () => {
    const html = renderToStaticMarkup(
      createElement(Board, { projectId: "project-1", initialTasks: TASKS }),
    );
    expect(html).toContain("Todo task");
    // The sheet is closed by default — its content shouldn't be in the
    // initial SSR markup (shadcn Sheet only portals/renders its content
    // when open).
    expect(html).not.toContain("Task details");
    expect(getTaskDetail).not.toHaveBeenCalled();
  });

  it("defaults handleCardClick to the board's own useTaskDetailSheet().openTask, overridable by an explicit onCardClick prop", () => {
    expect(boardSource).toMatch(
      /const taskDetailSheet = useTaskDetailSheet\(\);/,
    );
    expect(boardSource).toMatch(
      /const handleCardClick = onCardClick \?\? taskDetailSheet\.openTask;/,
    );
  });

  it("passes handleCardClick (not the raw onCardClick prop) down to BoardColumn", () => {
    expect(boardSource).toMatch(/onCardClick=\{handleCardClick\}/);
  });

  it("renders <TaskDetailSheet> wired to the same hook's state", () => {
    expect(boardSource).toMatch(/<TaskDetailSheet/);
    expect(boardSource).toMatch(/open=\{taskDetailSheet\.open\}/);
    expect(boardSource).toMatch(
      /onOpenChange=\{taskDetailSheet\.onOpenChange\}/,
    );
  });

  it("removes a task from local board state when TaskDetailSheet reports it deleted", () => {
    expect(boardSource).toMatch(/onDeleted=\{handleTaskDeleted\}/);
    expect(boardSource).toMatch(
      /current\.filter\(\(t\) => t\.id !== deletedTaskId\)/,
    );
  });

  it("SortableTaskCard forwards its onClick prop through to TaskCard", () => {
    expect(sortableTaskCardSource).toMatch(
      /<TaskCard task=\{task\} onClick=\{onClick\}/,
    );
  });

  it("TaskCard wires onClick to a real click/keyboard-activatable element when provided", () => {
    expect(taskCardSource).toMatch(/onClick\(task\.id\)/);
    expect(taskCardSource).toMatch(/role=\{onClick \? "button" : undefined\}/);
  });

  it("useTaskDetailSheet fetches the clicked task's full detail via getTaskDetail on open", () => {
    expect(useTaskDetailSheetSource).toMatch(
      /import\s*{\s*getTaskDetail\s*}\s*from\s*["']@\/lib\/actions\/tasks["']/,
    );
    expect(useTaskDetailSheetSource).toMatch(
      /const result = await getTaskDetail\(taskId\);/,
    );
  });
});
