// @vitest-environment jsdom
//
// F046 (M3 scrutiny attempt 2, FU-19): three fixes bundled under one
// follow-up.
//
// (a) `reorderProject(...)`'s promise chain in project-nav-list.tsx had no
//     `.catch` -- a rejected (not just `{ ok: false }`-returning) Server
//     Action produced an unhandled promise rejection and left the
//     optimistic `orderedIds` permanently out of sync with the server.
//     Fixed with a `.catch` that rolls the optimistic order back and
//     surfaces a toast, mirroring account-menu.tsx's F021/F024b sign-out
//     `catch` pattern.
//
// (b) `canReorder` now defaults to `false` (not `true`) when no
//     `MembershipProvider` is present in the tree, matching this
//     codebase's fail-closed convention for mutation-capable controls.
//
// (c) `ProjectFavoriteButton` now re-syncs its local optimistic state
//     whenever the `isFavorite` prop changes, not only when `projectId`
//     changes, so a server refresh that disagrees with local state wins.

import { createElement } from "react";
import { render, cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";

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
  favoriteProject: vi.fn(async () => ({
    ok: true,
    data: { projectId: "p1", isFavorite: true },
  })),
  unfavoriteProject: vi.fn(async () => ({
    ok: true,
    data: { projectId: "p1", isFavorite: false },
  })),
}));

const reorderProjectMock = vi.fn();
vi.mock("@/lib/actions/projects", () => ({
  reorderProject: (id: string, newPosition: number) => reorderProjectMock(id, newPosition),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ProjectNavList } from "@/components/nav/project-nav-list";
import { ProjectFavoriteButton } from "@/components/project-favorite-button";
import { toast } from "sonner";

const toastError = toast.error as unknown as ReturnType<typeof vi.fn>;

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

beforeEach(() => {
  reorderProjectMock.mockReset();
  toastError.mockReset();
  capturedOnDragEnd = undefined;
  window.localStorage.setItem(
    "sidebar:recent-projects",
    JSON.stringify(["p1", "p2", "p3"]),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("test_SB_041_reorder_rejection_rolls_back_and_toasts", () => {
  it("restores the pre-drag DOM order and surfaces a toast when reorderProject's promise REJECTS (not just returns ok:false)", async () => {
    reorderProjectMock.mockImplementation(() => Promise.reject(new Error("network down")));

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

    const nav = screen.getByRole("navigation", { name: "Projects" });
    const namesBefore = within(nav)
      .getAllByText(/Project$/)
      .map((el) => el.textContent);
    expect(namesBefore).toEqual(["Alpha Project", "Beta Project", "Gamma Project"]);

    expect(capturedOnDragEnd).toBeTruthy();
    capturedOnDragEnd!({ active: { id: "p1" }, over: { id: "p3" } });

    // Flush the rejected promise's microtask queue.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(toastError).toHaveBeenCalledTimes(1);

    const namesAfter = within(nav)
      .getAllByText(/Project$/)
      .map((el) => el.textContent);
    expect(namesAfter).toEqual(["Alpha Project", "Beta Project", "Gamma Project"]);
  });
});

describe("test_SB_041_canReorder_defaults_to_false_without_membership_provider", () => {
  it("hides the drag handle (no reorder affordance) when rendered outside a MembershipProvider", () => {
    const projects = [
      { id: "p1", name: "Alpha Project", key: "AL", isFavorite: false },
      { id: "p2", name: "Beta Project", key: "BE", isFavorite: false },
    ];

    render(
      createElement(ProjectNavList, {
        workspaceSlug: "acme",
        workspaceId: "w1",
        projects,
      }),
    );

    expect(screen.queryByLabelText("Reorder Alpha Project")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Reorder Beta Project")).not.toBeInTheDocument();
  });
});

describe("test_SB_041_favorite_button_resyncs_on_isFavorite_prop_change", () => {
  it("adopts a new isFavorite prop for the SAME projectId (server refresh disagreeing with stale local state wins)", () => {
    const { rerender } = render(
      createElement(ProjectFavoriteButton, {
        projectId: "p1",
        projectName: "Alpha Project",
        isFavorite: false,
        size: "icon" as const,
      }),
    );

    expect(
      screen.getByRole("button", { name: "Add Alpha Project to favourites" }),
    ).toHaveAttribute("aria-pressed", "false");

    // Same projectId, but the server-derived prop now disagrees with the
    // button's local state (e.g. a revalidatePath-triggered refetch after
    // this project was favourited from elsewhere). Before this fix, only a
    // projectId change re-synced local state, so this update was silently
    // discarded and the button kept showing "not favourited".
    rerender(
      createElement(ProjectFavoriteButton, {
        projectId: "p1",
        projectName: "Alpha Project",
        isFavorite: true,
        size: "icon" as const,
      }),
    );

    expect(
      screen.getByRole("button", { name: "Remove Alpha Project from favourites" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
