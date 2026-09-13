// @vitest-environment jsdom
//
// Mission 20260910-182104, F023 (AS-048, AS-049): keyboard-driven drag and
// drop for both section reordering (within/across page columns) and page
// (column) reordering. dnd-kit's KeyboardSensor already ships generic
// keyboard support once it's registered with useSensors -- these tests
// assert the pieces this feature is responsible for: the sensor is wired,
// the drag handles are reachable via the accessibility tree (a real
// `<button>` with a meaningful aria-label, so keyboard/AT users can Tab to
// it and activate it with Space/Enter to start a keyboard drag), and the
// DndContext carries custom accessibility announcements (rather than
// dnd-kit's generic defaults) naming the actual dragged/target ids.

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { BoardPage } from "@/lib/queries/architecture";

// PageColumnHeader (F014) calls next/navigation's useRouter, which throws
// outside a real Next.js app-router tree ("invariant expected app router
// to be mounted") -- stub it out so this file can mount the full
// <ArchitectureBoard> the same way tests/unit/f006-...-shell.test.tsx
// already does.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ projectId: "project-1" }),
}));

// Capture the sensors + accessibility props board.tsx passes into
// DndContext without needing real pointer/keyboard event plumbing --
// same "swap DndContext for a prop-capturing stand-in, keep everything
// else (KeyboardSensor, useSensor(s), SortableContext, useSortable,
// sortableKeyboardCoordinates) as real dnd-kit" approach the F022 board
// realtime-guard test file uses for DndContext/DragOverlay.
let capturedProps: {
  sensors?: unknown[];
  accessibility?: {
    announcements?: {
      onDragStart?: (e: { active: { id: string } }) => string | undefined;
      onDragOver?: (e: {
        active: { id: string };
        over: { id: string } | null;
      }) => string | undefined;
      onDragEnd?: (e: {
        active: { id: string };
        over: { id: string } | null;
      }) => string | undefined;
      onDragCancel?: (e: { active: { id: string } }) => string | undefined;
    };
  };
} | null = null;

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: {
      sensors?: unknown[];
      accessibility?: unknown;
      children?: React.ReactNode;
    }) => {
      capturedProps = props as typeof capturedProps;
      return createElement(actual.DndContext, props as never);
    },
  };
});

import { ArchitectureBoard } from "@/components/architecture/board";

afterEach(() => {
  cleanup();
  capturedProps = null;
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

describe("F023 keyboard drag and drop", () => {
  it("AS-048, AS-049: the board's DndContext is configured with a KeyboardSensor alongside PointerSensor", () => {
    const pages: BoardPage[] = [
      makePage({
        id: "page-1",
        title: "Home",
        pageSlug: "home",
        sections: [
          {
            id: "section-1",
            title: "Hero",
            position: 0,
            kind: "static",
            component: null,
          },
        ],
      }),
    ];

    render(<ArchitectureBoard pages={pages} components={[]} projectId={"00000000-0000-4000-8000-000000000001"} />);

    expect(capturedProps).not.toBeNull();
    expect(capturedProps?.sensors?.length).toBeGreaterThanOrEqual(2);
  });

  it("AS-048: a section's drag handle is a focusable, accessibly-labelled control reachable via keyboard", () => {
    const pages: BoardPage[] = [
      makePage({
        id: "page-1",
        title: "Home",
        pageSlug: "home",
        sections: [
          {
            id: "section-1",
            title: "Hero",
            position: 0,
            kind: "static",
            component: null,
          },
        ],
      }),
    ];

    render(<ArchitectureBoard pages={pages} components={[]} projectId={"00000000-0000-4000-8000-000000000001"} />);

    const handle = screen.getByRole("button", { name: "Reorder Hero" });
    expect(handle).toBeInTheDocument();
    expect(handle.tagName).toBe("BUTTON");
  });

  it("AS-049: a page column's drag handle is a focusable, accessibly-labelled control reachable via keyboard", () => {
    const pages: BoardPage[] = [
      makePage({ id: "page-1", title: "Home", pageSlug: "home" }),
      makePage({ id: "page-2", title: "Pricing", pageSlug: "pricing" }),
    ];

    render(<ArchitectureBoard pages={pages} components={[]} projectId={"00000000-0000-4000-8000-000000000001"} />);

    expect(
      screen.getByRole("button", { name: "Reorder Home" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reorder Pricing" }),
    ).toBeInTheDocument();
  });

  it("AS-048, AS-049: the DndContext defines accessibility announcements naming the dragged and target ids", () => {
    const pages: BoardPage[] = [
      makePage({ id: "page-1", title: "Home", pageSlug: "home" }),
    ];

    render(<ArchitectureBoard pages={pages} components={[]} projectId={"00000000-0000-4000-8000-000000000001"} />);

    const announcements = capturedProps?.accessibility?.announcements;
    expect(announcements).toBeDefined();
    expect(announcements?.onDragStart?.({ active: { id: "page-1" } })).toBe(
      "Picked up item page-1",
    );
    expect(
      announcements?.onDragOver?.({
        active: { id: "page-1" },
        over: { id: "page-2" },
      }),
    ).toBe("Moving over page-2");
    expect(
      announcements?.onDragOver?.({ active: { id: "page-1" }, over: null }),
    ).toBeUndefined();
    expect(
      announcements?.onDragEnd?.({
        active: { id: "page-1" },
        over: { id: "page-2" },
      }),
    ).toBe("Dropped page-1 on page-2");
    expect(
      announcements?.onDragEnd?.({ active: { id: "page-1" }, over: null }),
    ).toBe("Dropped page-1");
    expect(
      announcements?.onDragCancel?.({ active: { id: "page-1" } }),
    ).toBe("Cancelled drag of page-1");
  });
});
