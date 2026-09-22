// @vitest-environment jsdom
//
// F042 (M3 scrutiny FU-4): SB-041/SB-042 regression coverage for two bugs
// in components/nav/project-nav-list.tsx:
//
// (a) `readRecentProjectIds()` was previously read inside a `useState`
//     lazy initializer, so the very FIRST client render already reflected
//     localStorage recents while SSR (which never sees localStorage)
//     rendered without them -- a hydration mismatch. Fixed by moving the
//     read into a post-mount `useEffect`. This test seeds localStorage
//     with recents BEFORE render and asserts the SYNCHRONOUSLY rendered
//     static markup (captured before React flushes effects) matches what
//     a recents-unaware SSR pass would have produced, i.e. still shows
//     the "no favourites, no matched recents" truncation/empty-state
//     behaviour rather than jumping straight to the recency-filtered view.
//
// (b) `handleDragEnd` computed `otherIds` (and therefore `newPosition`)
//     from `otherProjects` -- a recency-sorted/truncated VIEW of the
//     non-favourite group used only when there are no favourites yet --
//     instead of `allOtherProjects` (the real `sidebar_position` order).
//     Fixed by sourcing `otherIds` from `allOtherProjects`. This test
//     captures the exact `onDragEnd` handler the component wires into its
//     `DndContext` (dnd-kit has no real pointer/drag simulation available
//     in jsdom, so this repo's existing convention -- see
//     f024-drag-cancellation.test.tsx -- is to intercept the prop and
//     invoke it directly) and asserts the `newPosition` passed to
//     `reorderProject` matches the drop target's index in the
//     `sidebar_position` order, not the recency-sorted view's order.

import { createElement, act } from "react";
import { render, cleanup } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";

// jsdom in this repo's node --localstorage-file-less configuration has no
// window.localStorage (see palette-actions-recents.test.tsx's own
// identical polyfill/comment). A minimal in-memory polyfill only, scoped
// to this test file, mirroring lib/nav/recent-projects.ts's own real-
// browser storage API surface (getItem/setItem/clear).
if (typeof window !== "undefined" && !window.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    },
    writable: true,
    configurable: true,
  });
}

let capturedOnDragEnd: ((event: unknown) => void) | undefined;

vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return {
    ...actual,
    DndContext: ({
      children,
      onDragEnd,
    }: {
      children: ReactNode;
      onDragEnd?: (event: unknown) => void;
    }) => {
      capturedOnDragEnd = onDragEnd;
      return children;
    },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/acme/projects/none/board",
}));

vi.mock("@/components/new-project-dialog", () => ({
  NewProjectDialog: () => null,
}));

vi.mock("@/lib/actions/favorites", () => ({
  favoriteProject: vi.fn(),
  unfavoriteProject: vi.fn(),
}));

const reorderProjectMock = vi.fn(async (_id: string, _newPosition: number) => ({
  ok: true,
  data: { order: [] as string[] },
}));
vi.mock("@/lib/actions/projects", () => ({
  reorderProject: (id: string, newPosition: number) => reorderProjectMock(id, newPosition),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ProjectNavList } from "@/components/nav/project-nav-list";

const STORAGE_KEY = "sidebar:recent-projects";

beforeEach(() => {
  window.localStorage.clear();
  reorderProjectMock.mockClear();
  capturedOnDragEnd = undefined;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("test_SB_042_recents_read_is_hydration_safe", () => {
  it("real SSR (renderToString, no localStorage) markup hydrates cleanly on a client that HAS recents in localStorage, with no recoverable hydration error", async () => {
    // Seed enough projects (> the 5-project cap) and recents so that, if
    // `readRecentProjectIds()` were read during the render phase (the
    // fixed bug: a `useState(() => readRecentProjectIds())` lazy
    // initializer), the FIRST client render would already diverge from
    // what a real server (no `window`, hence no localStorage) produced.
    const projects = [1, 2, 3, 4, 5, 6].map((n) => ({
      id: `p${n}`,
      name: `Project ${n}`,
      key: null,
      isFavorite: false,
    }));
    const element = createElement(ProjectNavList, {
      workspaceSlug: "acme",
      workspaceId: "w1",
      projects,
    });

    // Step 1: render exactly as the real server would -- with NO
    // localStorage available at all (jsdom's `window` normally exists in
    // this test file only because of our own polyfill above; a real
    // Node SSR pass has no `window` whatsoever, which is why
    // `readRecentProjectIds`'s try/catch exists). Temporarily remove the
    // polyfill to reproduce that exact condition for this render only.
    const realLocalStorage = window.localStorage;
    // @ts-expect-error -- simulating an environment with no localStorage
    delete window.localStorage;
    let serverHtml: string;
    try {
      serverHtml = renderToString(element);
    } finally {
      Object.defineProperty(window, "localStorage", {
        value: realLocalStorage,
        writable: true,
        configurable: true,
      });
    }

    // Step 2: NOW seed localStorage with recents -- simulating a real
    // browser that has visited projects before -- and hydrate the
    // server's markup on this recents-aware client.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["p4"]));

    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.appendChild(container);

    const recoverableErrors: unknown[] = [];
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, element, {
        onRecoverableError: (error) => {
          recoverableErrors.push(error);
        },
      });
    });

    try {
      // If the first client render (pre-effect) already differed from
      // the server markup (the bug), React logs a hydration mismatch as
      // a recoverable error right here, during the synchronous
      // hydrateRoot call.
      expect(recoverableErrors).toEqual([]);
    } finally {
      root.unmount();
      container.remove();
      consoleErrorSpy.mockRestore();
    }
  });
});

describe("test_SB_041_drag_persists_visual_drop_position", () => {
  it("computes newPosition from the sidebar_position order, matching the visual drop target, even when the visible list is recency-sorted", () => {
    // No favourites -> `otherProjects` (the rendered/sortable view) is the
    // recency-sorted view: p3, p1, p2. The real `sidebar_position` order
    // (`allOtherProjects`, from the `projects` prop order) is p1, p2, p3.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(["p3", "p1", "p2"]),
    );

    const projects = [
      { id: "p1", name: "Alpha Project", key: "AL", isFavorite: false },
      { id: "p2", name: "Beta Project", key: "BE", isFavorite: false },
      { id: "p3", name: "Gamma Project", key: "GA", isFavorite: false },
    ];

    render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects,
      }),
    );

    expect(capturedOnDragEnd).toBeTruthy();

    // Simulate the user dragging p1 (Alpha) and dropping it onto p3's
    // (Gamma's) slot -- as rendered in the on-screen recency view, this
    // visually means "drop Alpha where Gamma currently sits".
    capturedOnDragEnd!({ active: { id: "p1" }, over: { id: "p3" } });

    expect(reorderProjectMock).toHaveBeenCalledTimes(1);
    const [draggedId, newPosition] = reorderProjectMock.mock.calls[0];
    expect(draggedId).toBe("p1");

    // Correct (fixed) behaviour: move p1 within the REAL order
    // [p1, p2, p3] to p3's index -> [p2, p3, p1], so p1 lands at index 2.
    // The old, buggy computation sourced indices from the recency view
    // [p3, p1, p2] instead, where moving p1 (index 1) onto p3 (index 0)
    // would arrayMove to [p1, p3, p2] and report newPosition 0 -- a
    // different, wrong answer. Asserting the fixed value pins the fix.
    expect(newPosition).toBe(2);
  });
});
