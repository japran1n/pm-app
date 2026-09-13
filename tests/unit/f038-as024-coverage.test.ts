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

// The real PALETTE_ACTIONS no longer contains any action whose `run()`
// returns no `navigateTo` (the "Toggle theme" quick action this test was
// written against was removed from the palette), but the AS-024 branch it
// exercises — `setOpen(false)` + `resetPaletteState()` without
// `navigate()` — still exists in command-palette.tsx. Append a synthetic
// no-navigate action so the branch stays covered.
vi.mock("@/components/command/actions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/command/actions")>();
  return {
    ...actual,
    PALETTE_ACTIONS: [
      ...actual.PALETTE_ACTIONS,
      {
        id: "test-no-navigate",
        label: "Toggle theme",
        isVisible: () => true,
        run: () => ({ navigateTo: null }),
      },
    ],
  };
});

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

    // Switch the query to a SINGLE SPACE, not "". This is the critical
    // detail: the quick-actions group's visibility gate
    // (`hasQuery = query.trim().length > 0`, command-palette.tsx) is
    // TRIMMED, so " " already counts as empty and the quick actions
    // render. But the realtime subscription's teardown gate in
    // `use-palette-search-realtime.ts` (`query.length === 0`) is
    // UNTRIMMED, so with a length-1 " " query the channel is judged
    // non-empty and is kept alive. That discrepancy is exactly the bug
    // AS-024 exists to guard: a DELETE event arriving while the query is
    // " " is still processed by the (still-subscribed) realtime handler
    // and tombstones a task into `realtimePatches`, even though the UI is
    // already showing the quick-actions view as if the query were fully
    // empty. `handleQueryChange` only clears the patch map on its own
    // `!trimmed` branch, which already ran once when the query became
    // " " (before the DELETE below) — it does not run again for
    // later-arriving realtime events, so this is the one state in which
    // quick actions are visible AND the patch map can still be live
    // repopulated. That makes quick-action close's own
    // `resetPaletteState()` call (command-palette.tsx:447) the only thing
    // standing between this stray tombstone and the next real search —
    // removing it lets the tombstone survive and silently suppress a real
    // task from every subsequent result set.
    fireEvent.change(input, { target: { value: " " } });

    act(() => {
      sharedOnCalls[0].callback({
        eventType: "DELETE",
        schema: "public",
        table: "tasks",
        new: {},
        old: { id: "t1" },
      });
    });

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
