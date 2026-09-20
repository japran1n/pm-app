// @vitest-environment jsdom
//
// Mission 20260919-150607, F048 (AS-162, AS-163, AS-164): the Components
// panel's list is reordered via `@dnd-kit` drag-and-drop rather than the
// F047 move-up/move-down button placeholder.
//
// AS-162 asserts the panel is wired up with a DndContext + SortableContext.
// It renders each row's drag handle and spies on the real SortableContext
// export from `@dnd-kit/sortable` (see `sortableContextSpy` below) to
// assert it was actually rendered with the component ids -- useSortable
// alone does not throw when SortableContext is absent (it silently falls
// back to a default context value), so the drag-handle assertion by itself
// is not falsifiable against deleting `<SortableContext>`.
//
// AS-163/AS-164 render `ComponentPanel`, simulate dnd-kit's onDragEnd by
// invoking DndContext's onDragEnd prop directly (jsdom has no real pointer
// drag), and assert reorderComponents is called with the reordered id list
// followed by router.refresh().
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const reorderComponentsMock = vi.fn(
  async (_projectId: string, _orderedIds: string[]) => ({ success: true }),
);
const refreshMock = vi.fn();

vi.mock("@/lib/actions/architecture", () => ({
  reorderComponents: (projectId: string, orderedIds: string[]) =>
    reorderComponentsMock(projectId, orderedIds),
  renameComponent: vi.fn(async () => ({ success: true })),
  deleteComponent: vi.fn(async () => ({ success: true })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

let capturedOnDragEnd: ((event: unknown) => void) | undefined;

vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return {
    ...actual,
    DndContext: (props: {
      onDragEnd?: (event: unknown) => void;
      children: React.ReactNode;
    }) => {
      capturedOnDragEnd = props.onDragEnd;
      return props.children;
    },
  };
});

// AS-162: the previous version of this test only mocked `@dnd-kit/core`'s
// DndContext and asserted the drag handles rendered -- but `@dnd-kit/sortable`
// ships its own default context value, so `useSortable` inside
// `ComponentListItem` never throws even when `SortableContext` is removed
// entirely from `component-panel.tsx`; the old assertions kept passing on
// that mutation. To make the assertion falsifiable we spy on the real
// `SortableContext` export (delegating to the actual implementation so
// dnd-kit's own behaviour is unaffected) and assert it was rendered with an
// `items` list containing every component id -- a call that only happens if
// `<SortableContext>` is actually present in the tree.
const sortableContextSpy = vi.fn();

vi.mock("@dnd-kit/sortable", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/sortable")>(
    "@dnd-kit/sortable",
  );
  return {
    ...actual,
    SortableContext: (props: Parameters<typeof actual.SortableContext>[0]) => {
      sortableContextSpy(props);
      return actual.SortableContext(props);
    },
  };
});

import { ComponentPanel } from "@/components/architecture/component-panel";
import type { BoardComponent } from "@/lib/queries/architecture";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  capturedOnDragEnd = undefined;
});

function makeComponent(overrides: Partial<BoardComponent>): BoardComponent {
  return {
    id: "component-1",
    name: "Header",
    position: 0,
    instanceCount: 0,
    ...overrides,
  };
}

describe("F048 ComponentPanel drag-and-drop reordering", () => {
  const components: BoardComponent[] = [
    makeComponent({ id: "comp-a", name: "Header" }),
    makeComponent({ id: "comp-b", name: "Footer" }),
    makeComponent({ id: "comp-c", name: "Sidebar" }),
  ];

  it("AS-162: renders a sortable list with a drag handle per component", () => {
    render(<ComponentPanel components={components} projectId="project-1" />);

    expect(screen.getByLabelText("Reorder Header")).toBeInTheDocument();
    expect(screen.getByLabelText("Reorder Footer")).toBeInTheDocument();
    expect(screen.getByLabelText("Reorder Sidebar")).toBeInTheDocument();
    // A DndContext must have mounted (and captured its onDragEnd) for the
    // per-row useSortable() calls above to have succeeded at all.
    expect(capturedOnDragEnd).toBeInstanceOf(Function);
    // And SortableContext itself must have been rendered with every
    // component id in `items` -- this is what actually makes useSortable's
    // per-row sorting behaviour (not just dnd-kit/core's DndContext) real.
    expect(sortableContextSpy).toHaveBeenCalledWith(
      expect.objectContaining({ items: ["comp-a", "comp-b", "comp-c"] }),
    );
  });

  it("AS-163: onDragEnd calls reorderComponents with the reordered id list", () => {
    render(<ComponentPanel components={components} projectId="project-1" />);

    expect(capturedOnDragEnd).toBeInstanceOf(Function);
    capturedOnDragEnd?.({
      active: { id: "comp-a" },
      over: { id: "comp-c" },
    });

    expect(reorderComponentsMock).toHaveBeenCalledWith("project-1", [
      "comp-b",
      "comp-c",
      "comp-a",
    ]);
  });

  it("AS-164: onDragEnd calls router.refresh() after reorderComponents resolves", async () => {
    render(<ComponentPanel components={components} projectId="project-1" />);

    capturedOnDragEnd?.({
      active: { id: "comp-a" },
      over: { id: "comp-b" },
    });

    expect(reorderComponentsMock).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
  });
});
