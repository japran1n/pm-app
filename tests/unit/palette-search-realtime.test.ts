// F012 (AS-023, AS-024): unit tests for the command palette's Realtime
// reconciliation — mirrors tests/unit/board-realtime-subscription.test.ts's
// split between "is the subscription configured correctly" (mocked
// Supabase client, no DOM) and "does the pure reconcile logic apply
// events correctly" (reconcilePaletteSearchResults).

import { describe, expect, it, vi } from "vitest";

import { subscribeToPaletteSearchRealtime } from "@/lib/palette/subscribe-palette-search-realtime";
import { reconcilePaletteSearchResults } from "@/lib/palette/reconcile-palette-search-results";
import type { PaletteRealtimeEvent } from "@/lib/palette/subscribe-palette-search-realtime";
import type { PaletteSearchResults } from "@/lib/palette/palette-search-types";

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
});
