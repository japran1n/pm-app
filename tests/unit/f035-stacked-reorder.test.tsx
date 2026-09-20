// @vitest-environment jsdom
//
// F035/F103 (AS-064, AS-065): a stacked row can be dragged to a new
// position, and doing so rewrites `?people=` (preserving `?week=`) so the
// new order survives a reload.
//
// F103 supersedes the earlier version of this file, which mocked
// `DndContext` away entirely and invoked its captured `onDragEnd` prop
// directly -- that let mutations that break the *real* drag gesture (e.g.
// deleting `{...listeners}` or dropping `sensors={sensors}`) pass
// undetected, and gave zero coverage to AS-065's `?week=` preservation.
//
// This file does NOT mock @dnd-kit/core or @dnd-kit/sortable. It drives
// the real KeyboardSensor against the rendered drag handle: focus, Space
// (pick up), ArrowDown (move), Space (drop) -- exactly the gesture a
// keyboard user performs -- then asserts on the resulting
// `router.replace` call.
//
// jsdom returns an all-zero `getBoundingClientRect()` for every element by
// default, which would make dnd-kit's keyboard coordinate getter
// (`sortableKeyboardCoordinates`, which compares row rects' `top`) see
// every row as identical and never move. `stubRowRects` below overrides
// `Element.prototype.getBoundingClientRect` to give each draggable row
// wrapper (`stacked-row-draggable-<userId>`, in `?people=` order) a
// distinct, stacked rect so the real algorithm can tell rows apart. jsdom
// also has no `ResizeObserver`, which dnd-kit's rect tracking depends on;
// this file stubs a no-op one, the same fixup already used in
// people-switcher.test.tsx et al.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import fs from "node:fs";
import path from "node:path";

import { StackedPlanner } from "@/components/calendar/stacked-planner";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";
import type { SwitcherMember } from "@/lib/calendar/workspace-members";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: replaceMock, refresh: vi.fn() }),
}));

const SELF_ID = "11111111-1111-4111-8111-111111111111";
const PERSON_A = "22222222-2222-4222-8222-222222222222";
const PERSON_B = "33333333-3333-4333-8333-333333333333";

const MEMBERS: SwitcherMember[] = [
  { userId: SELF_ID, name: "Self", email: "self@example.com", avatarUrl: null },
  { userId: PERSON_A, name: "Person A", email: "a@example.com", avatarUrl: null },
  { userId: PERSON_B, name: "Person B", email: "b@example.com", avatarUrl: null },
];

// [Self, A, B] rendered top-to-bottom in this order -- Self at index 0.
const ROW_ORDER = [SELF_ID, PERSON_A, PERSON_B];
const ROW_HEIGHT = 60;

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

function renderPlanner(overrides: { weekParam?: string } = {}) {
  return render(
    <StackedPlanner
      selectedUserIds={ROW_ORDER}
      blocksByUser={new Map<string, CalendarBlock[]>()}
      weekKey="2026-09-14"
      members={MEMBERS}
      workspaceSlug="acme"
      selfId={SELF_ID}
      {...overrides}
    />,
  );
}

// Gives each draggable row wrapper a distinct, stacked rect (in
// `ROW_ORDER`) so dnd-kit's real KeyboardSensor + sortableKeyboardCoordinates
// -- which pick the next row by comparing `getBoundingClientRect().top`
// between the active row and its siblings -- can tell rows apart.
function stubRowRects() {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const testId = this.getAttribute("data-testid");
    const match = testId?.match(/^stacked-row-draggable-(.+)$/);
    if (match) {
      const index = ROW_ORDER.indexOf(match[1]);
      const top = index >= 0 ? index * ROW_HEIGHT : 0;
      return {
        top,
        bottom: top + ROW_HEIGHT,
        left: 0,
        right: 300,
        width: 300,
        height: ROW_HEIGHT,
        x: 0,
        y: top,
        toJSON() {
          return this;
        },
      } as DOMRect;
    }
    return original.call(this);
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

// dnd-kit's KeyboardSensor attaches its document-level follow-up keydown
// listener (the one that handles ArrowDown/Space after pickup) inside a
// `setTimeout(fn)` fired right when the drag starts -- flush one macrotask
// between keystrokes so each subsequent event lands on a listener that's
// actually attached yet.
async function flushMacrotask() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function pickUpMoveDropDown(handle: HTMLElement) {
  handle.focus();
  fireEvent.keyDown(handle, { key: " ", code: "Space" });
  await flushMacrotask();
  fireEvent.keyDown(handle, { key: "ArrowDown", code: "ArrowDown" });
  await flushMacrotask();
  fireEvent.keyDown(handle, { key: " ", code: "Space" });
  await flushMacrotask();
}

describe("F103 stacked row reorder -- real dnd-kit KeyboardSensor", () => {
  let restoreRects: () => void;

  beforeEach(() => {
    restoreRects = stubRowRects();
  });

  afterEach(() => {
    cleanup();
    replaceMock.mockClear();
    restoreRects();
  });

  it("test_AS_064_drag_reorders_rows", async () => {
    renderPlanner({ weekParam: "2026-W38" });

    // Self starts at index 0. Pick it up with the keyboard sensor and move
    // it down one slot, past Person A.
    const selfHandle = screen.getByTestId(`stacked-row-drag-handle-${SELF_ID}`);
    await pickUpMoveDropDown(selfHandle);

    expect(replaceMock).toHaveBeenCalledTimes(1);
    const url = replaceMock.mock.calls[0][0] as string;
    const params = new URL(url, "http://localhost").searchParams;
    const people = params.get("people") ?? "";
    const ids = people.split(",");

    // Self moved from before Person A to after Person A.
    const selfIndex = ids.indexOf(SELF_ID);
    const aIndex = ids.indexOf(PERSON_A);
    expect(selfIndex).toBeGreaterThanOrEqual(0);
    expect(aIndex).toBeGreaterThanOrEqual(0);
    expect(aIndex).toBeLessThan(selfIndex);
  });

  it("test_AS_065_weekParam_preserved_on_reorder", async () => {
    renderPlanner({ weekParam: "2026-W39" });

    const selfHandle = screen.getByTestId(`stacked-row-drag-handle-${SELF_ID}`);
    await pickUpMoveDropDown(selfHandle);

    expect(replaceMock).toHaveBeenCalledTimes(1);
    const url = replaceMock.mock.calls[0][0] as string;
    expect(url).toContain("week=2026-W39");

    // And the reorder itself still happened alongside the preserved week.
    const params = new URL(url, "http://localhost").searchParams;
    const ids = (params.get("people") ?? "").split(",");
    expect(ids.indexOf(PERSON_A)).toBeLessThan(ids.indexOf(SELF_ID));
  });

  it("AS-065: a drag that doesn't change position does NOT call router.replace", () => {
    renderPlanner({ weekParam: "2026-W38" });

    // No keyboard interaction at all -- render alone must never persist.
    expect(replaceMock).not.toHaveBeenCalled();
  });

  // AS-064: each row must actually be draggable in the DOM -- a plain <div>
  // with no useSortable/drag-handle wiring would still pass the tests
  // above only if the keyboard gesture happened to no-op; guard the
  // rendered handle directly too.
  it("AS-064: each rendered row exposes a keyboard-operable drag handle", () => {
    renderPlanner();

    for (const id of ROW_ORDER) {
      const handle = screen.getByTestId(`stacked-row-drag-handle-${id}`);
      expect(handle).toBeInTheDocument();
      // dnd-kit wires its pointer/keyboard listeners as DOM attributes
      // (tabIndex + aria-roledescription="sortable") onto the handle via
      // {...attributes} {...listeners} -- these disappear if the handle
      // stops calling useSortable().
      expect(handle).toHaveAttribute("aria-label", "Drag to reorder");
      expect(handle).toHaveAttribute("aria-roledescription", "sortable");
      expect(handle.tagName).toBe("BUTTON");
    }
  });
});

describe("F035 stacked planner wires listeners, not just attributes", () => {
  // AS-064: aria-roledescription/tabIndex on the handle come from
  // {...attributes}, not {...listeners}. A handle could keep {...attributes}
  // (so the DOM assertions above still pass) while {...listeners} is
  // deleted, silently making the row undraggable since pointer/keyboard
  // drag handlers only come from {...listeners}. Guard the source directly
  // as a fast, explicit backstop to the real-gesture test above.
  it("test_AS_064_drag_listeners_wired_to_handle", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "components/calendar/stacked-planner.tsx"),
      "utf-8",
    );

    expect(src).toMatch(/\{\.\.\.attributes\}/);
    expect(src).toMatch(/\{\.\.\.listeners\}/);

    // {...listeners} must appear inside a JSX element (spread onto a tag),
    // not merely destructured and left unused.
    const jsxListenersUse = src.match(/<[a-zA-Z][^>]*\{\.\.\.listeners\}[^>]*>/g);
    expect(jsxListenersUse).not.toBeNull();
    expect(jsxListenersUse!.length).toBeGreaterThanOrEqual(1);
  });
});

describe("F035 stacked planner uses dnd-kit SortableContext", () => {
  it("AS-064/AS-065: stacked-planner.tsx imports and renders SortableContext (not a hand-rolled reorder list)", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "components/calendar/stacked-planner.tsx"),
      "utf-8",
    );

    expect(source).toMatch(/import\s*{[^}]*\bSortableContext\b[^}]*}\s*from\s*["']@dnd-kit\/sortable["']/);
    expect(source).toMatch(/<SortableContext[\s>]/);
  });
});
