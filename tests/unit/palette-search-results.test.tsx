// @vitest-environment jsdom
//
// F242 (AS-460, AS-461, AS-466): palette search results — grouped by
// type, selecting a result navigates to it, and an explicit no-results
// state renders for an empty result set.

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom has no scrollIntoView; cmdk's CommandList calls it on its
// currently-selected item (F243 adds an always-visible "Actions" group
// for the empty-query state). Test-environment shim only.
if (typeof HTMLElement.prototype.scrollIntoView !== "function") {
  HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
}

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const searchPalette = vi.fn();

vi.mock("@/lib/actions/palette-search", () => ({
  searchPalette: (...args: unknown[]) => searchPalette(...args),
  resolveRecentItems: vi.fn(async () => ({ projects: [], tasks: [] })),
}));

import { CommandPalette } from "@/components/command/command-palette";


// F093 follow-up: mock the Supabase browser client so mounting the real
// <CommandPalette> never opens a real WebSocket via
// lib/hooks/use-palette-search-realtime.ts's usePaletteSearchRealtime.
// Locally (a bare `vitest run` with no NEXT_PUBLIC_SUPABASE_* env vars in
// the process) that hook's own try/catch around createClient() silently
// no-ops instead of subscribing, which is why this leak passed locally
// but failed in CI (env vars ARE set there, from `supabase status -o
// env`) -- masking the leak rather than fixing it. Same
// "channel().on().subscribe()" fake shape as
// tests/unit/f022-board-realtime-guard-call-site.test.tsx.
function makeFakeSupabaseRealtimeClient() {
  const channelObject = {
    on: vi.fn(() => channelObject),
    subscribe: vi.fn(() => channelObject),
  };
  return {
    channel: vi.fn(() => channelObject),
    removeChannel: vi.fn(),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
    },
  };
}
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => makeFakeSupabaseRealtimeClient(),
}));

const defaultProps = { workspaceId: "ws-1", workspaceSlug: "acme" };

afterEach(() => {
  cleanup();
  push.mockClear();
  searchPalette.mockReset();
});

function openPalette() {
  render(createElement(CommandPalette, defaultProps));
  fireEvent.keyDown(document, { key: "k", metaKey: true });
  return screen.findByPlaceholderText("Type a command or search...");
}

describe("CommandPalette search results (F242)", () => {
  it("test_AS_460_groups_results_by_type", async () => {
    searchPalette.mockResolvedValue({
      projects: [{ type: "project", id: "proj-1", name: "Marketing Site", key: "MKT" }],
      tasks: [
        {
          type: "task",
          id: "task-1",
          title: "Fix header",
          projectId: "proj-1",
          projectName: "Marketing Site",
          projectKey: "MKT",
          number: 42,
        },
      ],
      members: [
        {
          type: "member",
          userId: "user-1",
          name: "Ada Lovelace",
          email: "ada@example.com",
          avatarUrl: null,
        },
      ],
    });

    const input = await openPalette();
    fireEvent.change(input, { target: { value: "a" } });

    await waitFor(() => {
      expect(screen.getByText("Projects")).toBeInTheDocument();
      expect(screen.getByText("Tasks")).toBeInTheDocument();
      expect(screen.getByText("People")).toBeInTheDocument();
    });

    expect(screen.getByText("Marketing Site")).toBeInTheDocument();
    expect(screen.getByText("Fix header")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("test_AS_461_selecting_a_project_result_navigates_to_it", async () => {
    searchPalette.mockResolvedValue({
      projects: [{ type: "project", id: "proj-1", name: "Marketing Site", key: "MKT" }],
      tasks: [],
      members: [],
    });

    const input = await openPalette();
    fireEvent.change(input, { target: { value: "market" } });

    const item = await screen.findByText("Marketing Site");
    fireEvent.click(item);

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/w/acme/projects/proj-1/board");
    });
  });

  it("test_AS_461_selecting_a_task_result_navigates_to_it", async () => {
    searchPalette.mockResolvedValue({
      projects: [],
      tasks: [
        {
          type: "task",
          id: "task-1",
          title: "Fix header",
          projectId: "proj-9",
          projectName: "Marketing Site",
          projectKey: "MKT",
          number: 42,
        },
      ],
      members: [],
    });

    const input = await openPalette();
    fireEvent.change(input, { target: { value: "fix" } });

    const item = await screen.findByText("Fix header");
    fireEvent.click(item);

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/w/acme/projects/proj-9/board");
    });
  });

  it("test_AS_466_empty_result_set_shows_explicit_no_results_state", async () => {
    searchPalette.mockResolvedValue({ projects: [], tasks: [], members: [] });

    const input = await openPalette();
    fireEvent.change(input, { target: { value: "zzzzznotfound" } });

    await waitFor(() => {
      expect(screen.getByText("No results found.")).toBeInTheDocument();
    });
  });

  it("test_AS_466_empty_query_shows_neutral_prompt_not_no_results", async () => {
    // F243 (AS-462, AS-465): an empty query now shows quick actions
    // (always at least "Toggle theme") instead of the old bare "Type to
    // search..." text — updated here to match that intentional change.
    // The assertion this test protects (AS-466: an empty query must never
    // show the "no results" state, which is reserved for a query that
    // resolved to zero results) still holds.
    const input = await openPalette();

    expect(screen.getByText("Actions")).toBeInTheDocument();
    expect(screen.queryByText("No results found.")).not.toBeInTheDocument();
    expect(searchPalette).not.toHaveBeenCalled();
    void input;
  });

  it("test_AS_460_stale_slower_response_does_not_clobber_a_newer_faster_one", async () => {
    // The FIRST debounced search (for "first") is dispatched, then goes
    // pending; before it resolves, the query changes again and a SECOND
    // debounced search (for "second") fires and resolves quickly. The
    // stale first response, arriving after, must not overwrite the
    // already-current second result.
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });

    searchPalette
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async () => ({
        projects: [{ type: "project", id: "proj-2", name: "Second Query Result", key: "SQR" }],
        tasks: [],
        members: [],
      }));

    const input = await openPalette();

    fireEvent.change(input, { target: { value: "first" } });
    // Let the debounce timer for "first" fire and dispatch the (pending)
    // search call, without resolving it yet.
    await waitFor(() => {
      expect(searchPalette).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(input, { target: { value: "second" } });

    await waitFor(() => {
      expect(screen.getByText("Second Query Result")).toBeInTheDocument();
    });

    resolveFirst({
      projects: [{ type: "project", id: "proj-1", name: "First Query Result", key: "FQR" }],
      tasks: [],
      members: [],
    });

    // Give the (already-superseded) first promise a tick to resolve and
    // confirm it never overwrites what's on screen.
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.getByText("Second Query Result")).toBeInTheDocument();
    expect(screen.queryByText("First Query Result")).not.toBeInTheDocument();
  });
});
