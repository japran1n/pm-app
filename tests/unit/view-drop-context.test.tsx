// @vitest-environment jsdom
//
// Follow-up (drag-and-drop view membership): proves dropping a dragged
// task (ViewDropContext's onDragEnd) onto a view tab (ViewDropTab) calls
// addTaskToView with the dropped task/view ids -- the actual behavior a
// user drag from the task table onto the tab row produces -- without
// needing to simulate real pointer-drag physics (dnd-kit's DragEndEvent
// is invoked directly here, the same "drive the documented event contract
// instead of faking mouse movement pixel-by-pixel" approach this repo's
// board drag tests already take for handleDragEnd).

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const addTaskToViewMock = vi.fn();

vi.mock("@/lib/actions/view-tasks", () => ({
  addTaskToView: (...args: unknown[]) => addTaskToViewMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

let capturedOnDragEnd: ((event: unknown) => void) | undefined;

vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return {
    ...actual,
    DndContext: ({
      children,
      onDragEnd,
    }: {
      children: React.ReactNode;
      onDragEnd: (event: unknown) => void;
    }) => {
      capturedOnDragEnd = onDragEnd;
      return children;
    },
    useDraggable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      isDragging: false,
    }),
    useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
  };
});

import { ViewDropContext, ViewDropTab, TaskDragHandle } from "@/components/views/view-drop-context";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  capturedOnDragEnd = undefined;
});

describe("ViewDropContext drag-and-drop task-to-view membership", () => {
  it("test_dropping_a_dragged_task_onto_a_view_tab_calls_addTaskToView_with_both_ids", async () => {
    addTaskToViewMock.mockResolvedValue({ ok: true, data: { viewId: "view-1", taskId: "task-1" } });

    render(
      <ViewDropContext>
        <ViewDropTab viewId="view-1" viewName="Launch">
          <span>Launch</span>
        </ViewDropTab>
        <TaskDragHandle taskId="task-1" />
      </ViewDropContext>,
    );

    expect(screen.getByText("Launch")).toBeInTheDocument();
    expect(capturedOnDragEnd).toBeDefined();

    await capturedOnDragEnd?.({
      active: { id: "view-drop-task:task-1" },
      over: { id: "view-drop-target:view-1", data: { current: { viewName: "Launch" } } },
    });

    expect(addTaskToViewMock).toHaveBeenCalledWith({ viewId: "view-1", taskId: "task-1" });
  });

  it("test_dropping_outside_any_view_tab_does_nothing", async () => {
    render(
      <ViewDropContext>
        <span>content</span>
      </ViewDropContext>,
    );

    await capturedOnDragEnd?.({
      active: { id: "view-drop-task:task-1" },
      over: null,
    });

    expect(addTaskToViewMock).not.toHaveBeenCalled();
  });
});
