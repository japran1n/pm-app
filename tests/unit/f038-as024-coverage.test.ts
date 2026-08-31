// @vitest-environment jsdom
//
// F038 (AS-024): closes two mutation-survivable gaps left by F034's
// coverage:
//
// 1. Nothing called `usePaletteSearchRealtime`'s `onDeletedTaskId` via a
//    RAW `DELETE` event (table `tasks`, `eventType: "DELETE"`) and
//    asserted it fired — every existing test only exercised the
//    soft-delete `UPDATE` (`deleted_at` set) path, so both
//    `onDeletedTaskId(...)` call sites in
//    lib/hooks/use-palette-search-realtime.ts (one per branch) could be
//    deleted/stubbed without failing the suite.
// 2. Nothing asserted that `command-palette.tsx`'s `navigate()` clears the
//    realtime patch/tombstone map via `resetPaletteState()` — every
//    existing AS-024 test asserted on the map's CONTENTS within a single
//    open/close session, never on it being reset by `navigate` across
//    sessions, so deleting the `resetPaletteState()` call from `navigate`
//    left the suite green.

import { createElement } from "react";
import { renderHook } from "@testing-library/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { usePaletteSearchRealtime } from "@/lib/hooks/use-palette-search-realtime";
import type { PaletteSearchResults } from "@/lib/palette/palette-search-types";

// jsdom has no ResizeObserver/scrollIntoView; cmdk's CommandList uses both.
// Test-environment shims only, matching
// tests/unit/palette-search-realtime.test.ts's own setup.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (typeof HTMLElement.prototype.scrollIntoView !== "function") {
  HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
}

// --- Shared fake Supabase client (both parts of this file lazily
// `createClient()` from this single mocked module — a second `vi.mock` for
// the same module path would silently override this one rather than
// stacking, so both the hook-level and component-level tests below share
// the one fake client/`onCalls` array, reset between tests).

const sharedOnCalls: Array<{ callback: (payload: unknown) => void }> = [];

function makeFakeSupabase() {
  const channelObject = {
    on: vi.fn(
      (_event: string, _filter: unknown, callback: (payload: unknown) => void) => {
        sharedOnCalls.push({ callback });
        return channelObject;
      },
    ),
    subscribe: vi.fn(() => channelObject),
  };

  return {
    channel: vi.fn(() => channelObject),
    removeChannel: vi.fn(),
  };
}

const fakeSupabase = makeFakeSupabase();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => fakeSupabase,
}));

// --- Part 1: hook-level DELETE -> onDeletedTaskId coverage -----------------

describe("usePaletteSearchRealtime: raw DELETE fires onDeletedTaskId", () => {
  afterEach(() => {
    sharedOnCalls.length = 0;
    vi.useRealTimers();
  });

  it("test_AS_024_raw_delete_event_invokes_onDeletedTaskId_with_the_deleted_id", async () => {
    const onDeletedTaskId = vi.fn();
    const setResults = vi.fn();

    const { unmount } = renderHook(() =>
      usePaletteSearchRealtime("ws-1", "old", setResults, onDeletedTaskId),
    );

    await waitFor(() => {
      expect(sharedOnCalls.length).toBeGreaterThan(0);
    });

    const callback = sharedOnCalls[0].callback;

    // A raw postgres DELETE (not a soft-delete UPDATE with deleted_at) —
    // this is the branch that stayed untested: without it, both
    // `onDeletedTaskId` call sites in the hook could be removed/stubbed
    // and every other test in the suite would still pass.
    callback({
      eventType: "DELETE",
      schema: "public",
      table: "tasks",
      new: {},
      old: { id: "t-raw-deleted" },
    });

    // The hook debounces flush at 100ms.
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(onDeletedTaskId).toHaveBeenCalledExactlyOnceWith("t-raw-deleted");

    unmount();
  });
});

// --- Part 2: command-palette navigate() clears the patch map ---------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const searchResultsWithT1: PaletteSearchResults = {
  projects: [],
  tasks: [
    {
      type: "task",
      id: "t1",
      title: "Old title",
      projectId: "p1",
      projectName: "Project 1",
      projectKey: "P1",
      number: 1,
    },
  ],
  members: [
    {
      type: "member",
      userId: "u1",
      name: "Jane Doe",
      email: "jane@example.com",
      avatarUrl: null,
    },
  ],
};

vi.mock("@/lib/actions/palette-search", () => ({
  searchPalette: vi.fn(async () => searchResultsWithT1),
  resolveRecentItems: vi.fn(async () => ({ projects: [], tasks: [] })),
}));

import { CommandPalette } from "@/components/command/command-palette";

describe("CommandPalette navigate(): resetPaletteState clears the realtime patch map (AS-024)", () => {
  afterEach(() => {
    cleanup();
    sharedOnCalls.length = 0;
  });

  it("test_AS_024_navigate_clears_the_tombstone_so_a_later_session_no_longer_filters_the_task", async () => {
    render(
      createElement(CommandPalette, { workspaceId: "ws-1", workspaceSlug: "acme" }),
    );

    // Open and search — surfaces both the task (t1) and the member (Jane).
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    const input = await waitFor(() =>
      screen.getByPlaceholderText("Type a command or search..."),
    );
    fireEvent.change(input, { target: { value: "old" } });

    await waitFor(() => {
      expect(screen.getByText("Old title")).toBeInTheDocument();
      expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(sharedOnCalls.length).toBeGreaterThan(0);
    });

    // A raw realtime DELETE tombstones t1 in the patch map and removes it
    // from the currently-rendered results.
    act(() => {
      sharedOnCalls[0].callback({
        eventType: "DELETE",
        schema: "public",
        table: "tasks",
        new: {},
        old: { id: "t1" },
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("Old title")).not.toBeInTheDocument();
    });

    // Selecting the member calls `navigate()` directly (bypassing
    // `navigateAndRecord`) — this is the exact call site under test.
    // Without `resetPaletteState()` inside `navigate()`, the tombstone for
    // t1 survives into the next palette session.
    fireEvent.click(screen.getByText("Jane Doe"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // Re-open and search again. `searchPalette` unconditionally returns t1
    // (the mock never re-applies the delete server-side, mirroring "the
    // task existed in an old-but-not-stale server response") — the only
    // thing that can keep it hidden now is a leftover tombstone in the
    // patch map from the previous session.
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    const secondInput = await waitFor(() =>
      screen.getByPlaceholderText("Type a command or search..."),
    );
    fireEvent.change(secondInput, { target: { value: "old" } });

    // If `navigate()` cleared the patch map (production behaviour), t1 is
    // no longer tombstoned and reappears in this fresh session's results.
    await waitFor(() => {
      expect(screen.getByText("Old title")).toBeInTheDocument();
    });
  });

  it("test_AS_024_handleOpenChange_direct_close_clears_the_tombstone_map", async () => {
    render(
      createElement(CommandPalette, { workspaceId: "ws-1", workspaceSlug: "acme" }),
    );

    fireEvent.keyDown(document, { key: "k", metaKey: true });
    const input = await waitFor(() =>
      screen.getByPlaceholderText("Type a command or search..."),
    );
    fireEvent.change(input, { target: { value: "old" } });

    await waitFor(() => {
      expect(screen.getByText("Old title")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(sharedOnCalls.length).toBeGreaterThan(0);
    });

    // Tombstone t1 via a raw DELETE, then close the dialog via a DIRECT
    // close (Escape triggers Radix's `onOpenChange(false)` ->
    // `handleOpenChange`, NOT `navigate` and NOT the Cmd+K toggle
    // listener). Without `resetPaletteState()` inside `handleOpenChange`
    // itself, the tombstone would survive this close.
    act(() => {
      sharedOnCalls[0].callback({
        eventType: "DELETE",
        schema: "public",
        table: "tasks",
        new: {},
        old: { id: "t1" },
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("Old title")).not.toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // Re-open and search again — if `handleOpenChange` cleared the patch
    // map, t1 (which `searchPalette` unconditionally still returns) is no
    // longer tombstoned and reappears.
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    const secondInput = await waitFor(() =>
      screen.getByPlaceholderText("Type a command or search..."),
    );
    fireEvent.change(secondInput, { target: { value: "old" } });

    await waitFor(() => {
      expect(screen.getByText("Old title")).toBeInTheDocument();
    });
  });

  it("test_AS_024_quick_action_close_without_navigate_clears_the_tombstone_map", async () => {
    render(
      createElement(CommandPalette, { workspaceId: "ws-1", workspaceSlug: "acme" }),
    );

    fireEvent.keyDown(document, { key: "k", metaKey: true });
    const input = await waitFor(() =>
      screen.getByPlaceholderText("Type a command or search..."),
    );
    fireEvent.change(input, { target: { value: "old" } });

    await waitFor(() => {
      expect(screen.getByText("Old title")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(sharedOnCalls.length).toBeGreaterThan(0);
    });

    act(() => {
      sharedOnCalls[0].callback({
        eventType: "DELETE",
        schema: "public",
        table: "tasks",
        new: {},
        old: { id: "t1" },
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("Old title")).not.toBeInTheDocument();
    });

    // Clear the query to surface the quick-actions group ("Actions" is
    // only rendered for the empty-query state).
    //
    // IMPORTANT CAVEAT (documented rather than silently worked around):
    // `handleQueryChange` (command-palette.tsx) already clears the patch
    // map itself whenever the query transitions to empty (see F030's
    // AS-023 comment above it) — and quick actions are ONLY reachable
    // when the query IS empty. So by the time this quick action's own
    // `resetPaletteState()` call (command-palette.tsx:447) runs, the map
    // is *already* empty via that unrelated path, on every real code
    // path (confirmed: the realtime subscription itself is torn down —
    // its listener removed from the shared-channel `Set` in
    // lib/realtime/shared-topic-channel.ts — the instant the query goes
    // empty, so no later-arriving realtime event can repopulate the map
    // before this branch runs either). That makes line 447's
    // `resetPaletteState()` call provably equivalent-mutant with respect
    // to the patch map specifically: removing it changes no observable
    // behaviour, so no black-box test — including this one — can kill
    // that mutant without a change to the surrounding gating logic
    // (tracked as out-of-scope follow-up work below). This test still
    // asserts the map is empty post-close, exercising the branch and
    // guarding the (still real, still worth covering) invariant that a
    // quick-action close never leaves stale results/query state behind.
    fireEvent.change(input, { target: { value: "" } });

    // "Toggle theme" is the one quick action whose `run()` returns
    // `navigateTo: null` — its `onSelect` branch calls `setOpen(false)`
    // then `resetPaletteState()` directly, bypassing both `navigate()`
    // and `handleOpenChange`. This is the exact call site under test.
    const toggleThemeItem = await waitFor(() => screen.getByText("Toggle theme"));
    fireEvent.click(toggleThemeItem);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // Re-open and search again — if the action branch cleared the patch
    // map, t1 reappears since `searchPalette` unconditionally still
    // returns it.
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    const secondInput = await waitFor(() =>
      screen.getByPlaceholderText("Type a command or search..."),
    );
    fireEvent.change(secondInput, { target: { value: "old" } });

    await waitFor(() => {
      expect(screen.getByText("Old title")).toBeInTheDocument();
    });
  });
});
