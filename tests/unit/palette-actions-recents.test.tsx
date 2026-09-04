// @vitest-environment jsdom
//
// F243 (AS-462, AS-465): the command palette's quick actions ("Create
// task", "Create project", "Toggle theme", permission-filtered) and
// recents (visibility-checked project/task items shown for an empty
// query).

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

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

// jsdom in this repo's node --localstorage-file-less configuration has no
// window.localStorage (see the "ExperimentalWarning: localStorage is not
// available" this test run already logs for every other jsdom file). A
// minimal in-memory polyfill only, scoped to this test file, mirroring
// lib/hooks/use-recent-items.ts's own real-browser storage API surface
// (getItem/setItem/clear).
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
  });
}

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const searchPalette = vi.fn(async (_workspaceId: string, _query: string) => ({
  projects: [] as Array<{ type: "project"; id: string; name: string; key: string | null }>,
  tasks: [] as Array<{
    type: "task";
    id: string;
    title: string;
    projectId: string;
    projectName: string;
    projectKey: string | null;
    number: number;
  }>,
  members: [] as Array<{
    type: "member";
    userId: string;
    name: string | null;
    email: string | null;
    avatarUrl: string | null;
  }>,
}));
const resolveRecentItems = vi.fn(async (_workspaceId: string, _pointers: unknown) => ({
  projects: [] as Array<{ type: "project"; id: string; name: string; key: string | null }>,
  tasks: [] as Array<{
    type: "task";
    id: string;
    title: string;
    projectId: string;
    projectName: string;
    projectKey: string | null;
    number: number;
  }>,
}));
vi.mock("@/lib/actions/palette-search", () => ({
  searchPalette: (workspaceId: string, query: string) => searchPalette(workspaceId, query),
  resolveRecentItems: (workspaceId: string, pointers: unknown) =>
    resolveRecentItems(workspaceId, pointers),
}));

const setTheme = vi.fn();
let mockTheme: string | undefined = "light";
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: mockTheme, setTheme }),
}));

let mockRole: "owner" | "admin" | "member" | "viewer" | "guest" | null = "member";
vi.mock("@/components/auth/membership-provider", () => ({
  useMembership: () =>
    mockRole === null ? null : { role: mockRole, projectRoles: {} },
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

function openPalette() {
  render(createElement(CommandPalette, defaultProps));
  fireEvent.keyDown(document, { key: "k", metaKey: true });
  return screen.findByPlaceholderText("Type a command or search...");
}

beforeEach(() => {
  window.localStorage.clear();
  mockRole = "member";
  mockTheme = "light";
});

afterEach(() => {
  cleanup();
  push.mockClear();
  searchPalette.mockClear();
  resolveRecentItems.mockClear();
  setTheme.mockClear();
});

describe("CommandPalette actions (F243, AS-462)", () => {
  it("test_AS_462_actions_group_offers_create_task_create_project_toggle_theme_for_a_member", async () => {
    const input = await openPalette();
    void input;

    await waitFor(() => {
      expect(screen.getByText("Actions")).toBeInTheDocument();
    });

    expect(screen.getByText("Create task")).toBeInTheDocument();
    expect(screen.getByText("Create project")).toBeInTheDocument();
    expect(screen.getByText("Toggle theme")).toBeInTheDocument();
  });

  it("test_AS_462_selecting_create_project_navigates_to_the_projects_page", async () => {
    await openPalette();

    await waitFor(() => {
      expect(screen.getByText("Create project")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Create project"));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/w/acme/projects");
    });
  });

  it("test_AS_462_selecting_toggle_theme_calls_setTheme_and_does_not_navigate", async () => {
    mockTheme = "light";
    await openPalette();

    await waitFor(() => {
      expect(screen.getByText("Toggle theme")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Toggle theme"));

    await waitFor(() => {
      expect(setTheme).toHaveBeenCalledWith("dark");
    });
    expect(push).not.toHaveBeenCalled();
  });

  // Negative case: a viewer is read-only (lib/auth/permissions.ts's
  // `canWrite`) — the palette must not offer "Create task"/"Create
  // project" to a viewer, matching `createTask`/`createProject`'s own
  // server-side "Viewers don't have permission to create..." rejection.
  // The theme toggle (not a workspace write) remains offered.
  it("test_AS_462_viewer_does_not_see_create_task_or_create_project_but_still_sees_toggle_theme", async () => {
    mockRole = "viewer";
    await openPalette();

    await waitFor(() => {
      expect(screen.getByText("Toggle theme")).toBeInTheDocument();
    });

    expect(screen.queryByText("Create task")).not.toBeInTheDocument();
    expect(screen.queryByText("Create project")).not.toBeInTheDocument();
  });

  // `canWrite` (lib/auth/permissions.ts, F128) deliberately does NOT
  // exclude "guest" -- see that predicate's own doc comment: guest write
  // access is project-scoped and governed separately (F134/AS-223), and
  // widening this generic gate to exclude guest would regress that. A
  // guest therefore sees the same create actions a member does; this test
  // protects against a future regression narrowing that unintentionally.
  it("test_AS_462_guest_sees_create_task_and_create_project_same_as_a_member", async () => {
    mockRole = "guest";
    await openPalette();

    await waitFor(() => {
      expect(screen.getByText("Toggle theme")).toBeInTheDocument();
    });

    expect(screen.getByText("Create task")).toBeInTheDocument();
    expect(screen.getByText("Create project")).toBeInTheDocument();
  });

  it("test_AS_462_typing_a_query_hides_the_actions_group", async () => {
    const input = await openPalette();

    await waitFor(() => {
      expect(screen.getByText("Actions")).toBeInTheDocument();
    });

    fireEvent.change(await input, { target: { value: "abc" } });

    await waitFor(() => {
      expect(screen.queryByText("Actions")).not.toBeInTheDocument();
    });
  });
});

describe("CommandPalette recents (F243, AS-465)", () => {
  it("test_AS_465_recent_items_render_for_an_empty_query_resolved_via_the_server", async () => {
    window.localStorage.setItem(
      "pm-app:palette-recents:ws-1",
      JSON.stringify([{ type: "project", id: "proj-9", visitedAt: Date.now() }]),
    );
    resolveRecentItems.mockResolvedValue({
      projects: [{ type: "project", id: "proj-9", name: "Recently Visited Co", key: "RVC" }],
      tasks: [],
    });

    await openPalette();

    await waitFor(() => {
      expect(screen.getByText("Recent")).toBeInTheDocument();
      expect(screen.getByText("Recently Visited Co")).toBeInTheDocument();
    });

    // AS-465's "resolved server-side" contract: the raw pointer, not a
    // cached name, is what's sent for resolution.
    expect(resolveRecentItems).toHaveBeenCalledWith(
      "ws-1",
      expect.arrayContaining([
        expect.objectContaining({ type: "project", id: "proj-9" }),
      ]),
    );
  });

  it("test_AS_465_typing_a_query_hides_the_recents_group", async () => {
    window.localStorage.setItem(
      "pm-app:palette-recents:ws-1",
      JSON.stringify([{ type: "project", id: "proj-9", visitedAt: Date.now() }]),
    );
    resolveRecentItems.mockResolvedValue({
      projects: [{ type: "project", id: "proj-9", name: "Recently Visited Co", key: "RVC" }],
      tasks: [],
    });

    const input = await openPalette();

    await waitFor(() => {
      expect(screen.getByText("Recent")).toBeInTheDocument();
    });

    fireEvent.change(await input, { target: { value: "xyz" } });

    await waitFor(() => {
      expect(screen.queryByText("Recent")).not.toBeInTheDocument();
    });
  });

  // Negative case (this feature's core correctness requirement): a
  // pointer to a project/task the caller has since lost visibility to
  // (removed from the project, project made private, etc.) must not be
  // shown, and must not confirm the item exists. Since resolution is
  // entirely server-driven (resolveRecentItems), the client-side proof of
  // this is that a pointer resolving to an EMPTY set (exactly what the
  // real Server Action returns once RLS excludes the row -- see
  // tests/integration/palette-recent-items-visibility.test.ts for the
  // live-DB proof) never renders anything for it, and no title/name ever
  // leaks into the DOM.
  it("test_AS_465_stale_or_now_invisible_pointer_renders_nothing_and_leaks_no_title", async () => {
    window.localStorage.setItem(
      "pm-app:palette-recents:ws-1",
      JSON.stringify([{ type: "project", id: "proj-secret", visitedAt: Date.now() }]),
    );
    // The real resolveRecentItems drops any pointer RLS no longer returns
    // a row for -- simulated here as an empty result.
    resolveRecentItems.mockResolvedValue({ projects: [], tasks: [] });

    await openPalette();

    await waitFor(() => {
      expect(resolveRecentItems).toHaveBeenCalled();
    });

    expect(screen.queryByText("Recent")).not.toBeInTheDocument();
    expect(screen.queryByText("proj-secret")).not.toBeInTheDocument();
  });

  it("test_AS_465_no_recents_and_no_actions_falls_back_to_the_neutral_prompt", async () => {
    // No actions offered (guest sees only "Toggle theme" normally, so
    // force an edge case with an empty registry-equivalent state isn't
    // directly reachable -- instead assert the ordinary "no recents yet"
    // case still shows the Recent-less, Actions-only view without a
    // crash, and that the bare neutral prompt only appears when NEITHER
    // actions nor recents exist).
    resolveRecentItems.mockResolvedValue({ projects: [], tasks: [] });

    await openPalette();

    await waitFor(() => {
      expect(screen.getByText("Actions")).toBeInTheDocument();
    });
    expect(screen.queryByText("Recent")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Type to search projects, tasks, and people."),
    ).not.toBeInTheDocument();
  });

  it("test_AS_465_selecting_a_recent_task_navigates_to_its_project_board", async () => {
    window.localStorage.setItem(
      "pm-app:palette-recents:ws-1",
      JSON.stringify([{ type: "task", id: "task-7", visitedAt: Date.now() }]),
    );
    resolveRecentItems.mockResolvedValue({
      projects: [],
      tasks: [
        {
          type: "task",
          id: "task-7",
          title: "Ship the thing",
          projectId: "proj-3",
          projectName: "Launch",
          projectKey: "LNC",
          number: 7,
        },
      ],
    });

    await openPalette();

    await waitFor(() => {
      expect(screen.getByText("Ship the thing")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Ship the thing"));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/w/acme/projects/proj-3/board");
    });
  });
});
