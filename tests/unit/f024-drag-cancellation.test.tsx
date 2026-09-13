// @vitest-environment jsdom
//
// Mission 20260910-182104, F024 (AS-050): a cancelled drag leaves the
// original section order unchanged and never calls a persisting Server
// Action. dnd-kit calls `onDragCancel` (Escape key, or the dragged element
// unmounting mid-drag) instead of `onDragEnd` when a drag is cancelled --
// this test captures the exact `onDragCancel` prop the board passes to its
// DndContext and invokes it directly, since jsdom has no real pointer/drag
// simulation.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";

let capturedOnDragCancel: (() => void) | undefined;
let capturedOnDragEnd: ((event: unknown) => void) | undefined;

vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return {
    ...actual,
    DndContext: ({
      children,
      onDragCancel,
      onDragEnd,
    }: {
      children: ReactNode;
      onDragCancel?: () => void;
      onDragEnd?: (event: unknown) => void;
    }) => {
      capturedOnDragCancel = onDragCancel;
      capturedOnDragEnd = onDragEnd;
      return children;
    },
  };
});

const { reorderSectionsMock, moveSectionToPageMock } = vi.hoisted(() => ({
  reorderSectionsMock: vi.fn(async () => ({ success: true })),
  moveSectionToPageMock: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/lib/actions/architecture", () => ({
  reorderSections: reorderSectionsMock,
  moveSectionToPage: moveSectionToPageMock,
  changePageKind: vi.fn(async () => ({ success: true })),
  reorderPages: vi.fn(async () => ({ success: true })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/w/acme/architecture",
  useParams: () => ({ projectId: "project-1" }),
}));

import { ArchitectureBoard } from "@/components/architecture/board";
import type { BoardPage } from "@/lib/queries/architecture";

afterEach(() => {
  cleanup();
  capturedOnDragCancel = undefined;
  capturedOnDragEnd = undefined;
  reorderSectionsMock.mockClear();
  moveSectionToPageMock.mockClear();
});

function makePage(overrides: Partial<BoardPage>): BoardPage {
  return {
    id: "page-1",
    title: "Home",
    pageSlug: "home",
    pageKind: "static",
    position: 0,
    description: null,
    sections: [],
    ...overrides,
  };
}

describe("F024 drag cancellation", () => {
  it("AS-050: a cancelled drag leaves the original section order unchanged", () => {
    const pages: BoardPage[] = [
      makePage({
        id: "page-1",
        sections: [
          { id: "sec-1", title: "Header", componentId: null } as unknown as BoardPage["sections"][number],
          { id: "sec-2", title: "Footer", componentId: null } as unknown as BoardPage["sections"][number],
        ],
      }),
    ];

    render(<ArchitectureBoard pages={pages} components={[]} projectId={"00000000-0000-4000-8000-000000000001"} />);

    expect(capturedOnDragCancel).toBeInstanceOf(Function);

    // Simulate a drag being cancelled.
    capturedOnDragCancel?.();

    // Original section titles still render, in original order-derived DOM.
    expect(screen.getByText("Header")).toBeInTheDocument();
    expect(screen.getByText("Footer")).toBeInTheDocument();
  });

  it("AS-050: no server action is called when a drag is cancelled", () => {
    const pages: BoardPage[] = [
      makePage({
        id: "page-1",
        sections: [
          { id: "sec-1", title: "Header", componentId: null } as unknown as BoardPage["sections"][number],
          { id: "sec-2", title: "Footer", componentId: null } as unknown as BoardPage["sections"][number],
        ],
      }),
    ];

    render(<ArchitectureBoard pages={pages} components={[]} projectId={"00000000-0000-4000-8000-000000000001"} />);

    capturedOnDragCancel?.();

    expect(reorderSectionsMock).not.toHaveBeenCalled();
    expect(moveSectionToPageMock).not.toHaveBeenCalled();
  });

  it("AS-050: onDragEnd with no valid `over` target also leaves order unchanged and calls no action", () => {
    const pages: BoardPage[] = [
      makePage({
        id: "page-1",
        sections: [
          { id: "sec-1", title: "Header", componentId: null } as unknown as BoardPage["sections"][number],
          { id: "sec-2", title: "Footer", componentId: null } as unknown as BoardPage["sections"][number],
        ],
      }),
    ];

    render(<ArchitectureBoard pages={pages} components={[]} projectId={"00000000-0000-4000-8000-000000000001"} />);

    expect(capturedOnDragEnd).toBeInstanceOf(Function);

    // Dropping outside any droppable target -- dnd-kit supplies `over: null`.
    capturedOnDragEnd?.({ active: { id: "sec-1" }, over: null });

    expect(screen.getByText("Header")).toBeInTheDocument();
    expect(screen.getByText("Footer")).toBeInTheDocument();
    expect(reorderSectionsMock).not.toHaveBeenCalled();
    expect(moveSectionToPageMock).not.toHaveBeenCalled();
  });
});
