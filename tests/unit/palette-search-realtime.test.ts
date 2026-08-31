// @vitest-environment jsdom
//
// F012 (AS-023, AS-024): unit tests for the command palette's Realtime
// reconciliation — mirrors tests/unit/board-realtime-subscription.test.ts's
// split between "is the subscription configured correctly" (mocked
// Supabase client, no DOM) and "does the pure reconcile logic apply
// events correctly" (reconcilePaletteSearchResults).
//
// F026: also proves the command palette component itself is WIRED to
// `usePaletteSearchRealtime` (not just the pure reconcile function in
// isolation) — mirrors tests/unit/f027-calendar-realtime-wiring.test.tsx's
// "mock the channel, fire its callback, assert on screen" shape. Covers
// both a plain title UPDATE and a soft-delete UPDATE (deleted_at set,
// since deleteTask never issues a SQL DELETE in this app — see
// lib/palette/reconcile-palette-search-results.ts's header comment).

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { subscribeToPaletteSearchRealtime } from "@/lib/palette/subscribe-palette-search-realtime";
import { reconcilePaletteSearchResults } from "@/lib/palette/reconcile-palette-search-results";
import type { PaletteRealtimeEvent } from "@/lib/palette/subscribe-palette-search-realtime";
import type { PaletteSearchResults } from "@/lib/palette/palette-search-types";

// jsdom has no ResizeObserver/scrollIntoView; cmdk's CommandList uses both.
// Test-environment shims only, matching
// tests/unit/command-palette-shell.test.tsx's own setup.
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/actions/palette-search", () => ({
  searchPalette: vi.fn(async () => ({
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
    members: [],
  })),
  resolveRecentItems: vi.fn(async () => ({ projects: [], tasks: [] })),
}));

const wiringOnCalls: Array<{ callback: (payload: unknown) => void }> = [];
const wiringChannelCalls: string[] = [];

function makeFakeWiringSupabase() {
  const channelObject = {
    on: vi.fn(
      (_event: string, _filter: unknown, callback: (payload: unknown) => void) => {
        wiringOnCalls.push({ callback });
        return channelObject;
      },
    ),
    subscribe: vi.fn(() => channelObject),
  };

  return {
    channel: vi.fn((name: string) => {
      wiringChannelCalls.push(name);
      return channelObject;
    }),
    removeChannel: vi.fn(),
  };
}

const fakeWiringSupabase = makeFakeWiringSupabase();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => fakeWiringSupabase,
}));

import { CommandPalette } from "@/components/command/command-palette";

function createMockSupabaseClient() {
  const onCalls: Array<{
    event: string;
    filter: Record<string, unknown>;
    callback: (payload: PaletteRealtimeEvent) => void;
  }> = [];
  const channelCalls: string[] = [];

  const channelObject = {
    on: vi.fn(
      (
        event: string,
        filter: Record<string, unknown>,
        callback: (payload: PaletteRealtimeEvent) => void,
      ) => {
        onCalls.push({ event, filter, callback });
        return channelObject;
      },
    ),
    subscribe: vi.fn(() => channelObject),
  };

  const supabase = {
    channel: vi.fn((name: string) => {
      channelCalls.push(name);
      return channelObject;
    }),
    removeChannel: vi.fn(),
  };

  return { supabase, onCalls, channelCalls };
}

describe("subscribeToPaletteSearchRealtime", () => {
  it("subscribes on a workspace-scoped tasks channel for all events", () => {
    const { supabase, onCalls, channelCalls } = createMockSupabaseClient();

    subscribeToPaletteSearchRealtime(supabase as never, "ws-1", vi.fn());

    expect(channelCalls).toEqual(["tasks:ws-1"]);
    expect(onCalls).toHaveLength(1);
    expect(onCalls[0].event).toBe("postgres_changes");
    expect(onCalls[0].filter).toEqual({
      event: "*",
      schema: "public",
      table: "tasks",
    });
  });

  // AS-024: without this assertion, deleting the `.subscribe()` call from
  // subscribe-palette-search-realtime.ts leaves this suite green -- `.on()`
  // wiring alone doesn't join the Realtime channel, so no event would ever
  // actually be delivered in production even though every other assertion
  // here (which drives events directly through the captured `.on()`
  // callback) would still pass.
  it("AS-024: calls .subscribe() on the channel so events are actually delivered", () => {
    const { supabase, channelCalls } = createMockSupabaseClient();

    subscribeToPaletteSearchRealtime(supabase as never, "ws-1", vi.fn());

    expect(channelCalls).toEqual(["tasks:ws-1"]);
    const channelObject = (supabase.channel as unknown as { mock: { results: Array<{ value: { subscribe: (...args: unknown[]) => unknown } }> } }).mock.results[0].value;
    expect(channelObject.subscribe).toHaveBeenCalledTimes(1);
  });
});

describe("reconcilePaletteSearchResults (AS-023, AS-024)", () => {
  const baseResults: PaletteSearchResults = {
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
      {
        type: "task",
        id: "t2",
        title: "Another task",
        projectId: "p1",
        projectName: "Project 1",
        projectKey: "P1",
        number: 2,
      },
    ],
    members: [],
  };

  it("AS-023: updates the matching task's title on UPDATE", () => {
    const event = {
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: { id: "t1", title: "New title", status: "in_progress" },
      old: { id: "t1" },
    } as unknown as PaletteRealtimeEvent;

    const next = reconcilePaletteSearchResults(baseResults, event);

    expect(next.tasks.find((t) => t.id === "t1")?.title).toBe("New title");
    expect(next.tasks).toHaveLength(2);
  });

  it("AS-024: removes the matching task on DELETE", () => {
    const event = {
      eventType: "DELETE",
      schema: "public",
      table: "tasks",
      new: {},
      old: { id: "t2" },
    } as unknown as PaletteRealtimeEvent;

    const next = reconcilePaletteSearchResults(baseResults, event);

    expect(next.tasks.find((t) => t.id === "t2")).toBeUndefined();
    expect(next.tasks).toHaveLength(1);
  });

  it("is a no-op when the UPDATE payload has no id", () => {
    const event = {
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: { title: "No id" },
      old: {},
    } as unknown as PaletteRealtimeEvent;

    const next = reconcilePaletteSearchResults(baseResults, event);

    expect(next).toEqual(baseResults);
  });

  it("is a no-op when the DELETE payload has no old.id", () => {
    const event = {
      eventType: "DELETE",
      schema: "public",
      table: "tasks",
      new: {},
      old: {},
    } as unknown as PaletteRealtimeEvent;

    const next = reconcilePaletteSearchResults(baseResults, event);

    expect(next).toEqual(baseResults);
  });

  it("is a no-op when the updated task isn't in the current results", () => {
    const event = {
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: { id: "t-unknown", title: "Nope" },
      old: { id: "t-unknown" },
    } as unknown as PaletteRealtimeEvent;

    const next = reconcilePaletteSearchResults(baseResults, event);

    expect(next).toEqual(baseResults);
  });

  it("AS-024: removes the matching task on UPDATE when deleted_at is set (soft delete)", () => {
    // deleteTask sets deleted_at rather than issuing a SQL DELETE, so a
    // soft-deleted task arrives as an UPDATE event in production, not a
    // DELETE event — this is the real-world path, unlike the hard-DELETE
    // test above which is effectively dead code against this app's
    // deleteTask implementation.
    const event = {
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: { id: "t1", title: "Old title", deleted_at: "2026-08-31T00:00:00Z" },
      old: { id: "t1" },
    } as unknown as PaletteRealtimeEvent;

    const next = reconcilePaletteSearchResults(baseResults, event);

    expect(next.tasks.find((t) => t.id === "t1")).toBeUndefined();
    expect(next.tasks).toHaveLength(1);
  });
});

// F026: component-level wiring — proves <CommandPalette> is actually
// connected to `usePaletteSearchRealtime`, not just that the pure
// reconcile function behaves correctly in isolation.
describe("CommandPalette wiring to Realtime (AS-023, AS-024)", () => {
  afterEach(() => {
    cleanup();
    wiringOnCalls.length = 0;
    wiringChannelCalls.length = 0;
  });

  async function openPaletteWithQuery(query: string) {
    render(
      createElement(CommandPalette, { workspaceId: "ws-1", workspaceSlug: "acme" }),
    );

    fireEvent.keyDown(document, { key: "k", metaKey: true });

    const input = await waitFor(() =>
      screen.getByPlaceholderText("Type a command or search..."),
    );
    fireEvent.change(input, { target: { value: query } });

    await waitFor(() => {
      expect(screen.getByText("Old title")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(wiringOnCalls.length).toBeGreaterThan(0);
    });
  }

  it("AS-023: a title UPDATE realtime event updates the rendered palette result", async () => {
    await openPaletteWithQuery("old");

    const callback = wiringOnCalls[0].callback;

    act(() => {
      callback({
        eventType: "UPDATE",
        schema: "public",
        table: "tasks",
        new: { id: "t1", title: "Renamed title" },
        old: { id: "t1" },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Renamed title")).toBeInTheDocument();
    });
    expect(screen.queryByText("Old title")).not.toBeInTheDocument();
  });

  it("F030 (AS-023): a realtime title patch survives a subsequent (stale) search response returning the old title", async () => {
    const { searchPalette } = await import("@/lib/actions/palette-search");
    const searchPaletteMock = vi.mocked(searchPalette);

    await openPaletteWithQuery("old");

    const callback = wiringOnCalls[0].callback;

    act(() => {
      callback({
        eventType: "UPDATE",
        schema: "public",
        table: "tasks",
        new: { id: "t1", title: "New Title" },
        old: { id: "t1" },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("New Title")).toBeInTheDocument();
    });

    // Simulate a slower, now-resolving search response for the SAME
    // (still-current) request, returning the stale pre-patch title — the
    // realtime patch must not be clobbered.
    searchPaletteMock.mockResolvedValueOnce({
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
      members: [],
    });

    const input = screen.getByPlaceholderText("Type a command or search...");
    fireEvent.change(input, { target: { value: "old2" } });

    await waitFor(() => {
      expect(searchPaletteMock).toHaveBeenCalledWith("ws-1", "old2");
    });

    await waitFor(() => {
      expect(screen.getByText("New Title")).toBeInTheDocument();
    });
    expect(screen.queryByText("Old title")).not.toBeInTheDocument();
  });

  it("AS-024: an UPDATE event with deleted_at set removes the task from the rendered palette results", async () => {
    await openPaletteWithQuery("old");

    const callback = wiringOnCalls[0].callback;

    act(() => {
      callback({
        eventType: "UPDATE",
        schema: "public",
        table: "tasks",
        new: { id: "t1", title: "Old title", deleted_at: "2026-08-31T00:00:00Z" },
        old: { id: "t1" },
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("Old title")).not.toBeInTheDocument();
    });
  });
});
