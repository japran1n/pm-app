// @vitest-environment jsdom
//
// F247 (AS-475, AS-476, AS-478): task modal routing.
//
// Reuses F246's ONE `?taskId=` deep-link contract (no second, route-based
// contract forked here) — this hook is the single place that pushes/pops
// that param when the sheet opens/closes from an in-app click, and reacts
// (via board.tsx's own effect, covered separately in
// tests/unit/board-taskid-deeplink.test.tsx) when the URL changes out from
// under it (browser Back/Forward).
//
// These tests exercise `useTaskDetailSheet` directly against a controllable
// mock of `next/navigation` so each of push/back/replace can be asserted on
// its own, rather than only through the DOM.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

let currentSearch = new URLSearchParams();
const historyLength = 2;

const push = vi.fn();
const back = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, back, replace, refresh: vi.fn() }),
  usePathname: () => "/w/acme/projects/proj-1/board",
  useSearchParams: () => currentSearch,
}));

vi.mock("@/lib/actions/tasks", () => ({
  getTaskDetail: vi.fn(async (taskId: string) => ({
    ok: true,
    data: {
      task: {
        id: taskId,
        title: "t",
        description: null,
        status: "todo",
        priority: null,
        assigneeId: null,
        dueDate: null,
        tags: [],
      },
      comments: [],
      attachments: [],
      currentUserId: "user-1",
      currentUserRole: "member",
    },
  })),
}));

import { useTaskDetailSheet } from "@/components/task/use-task-detail-sheet";

beforeEach(() => {
  currentSearch = new URLSearchParams("groupBy=status");
  Object.defineProperty(window, "history", {
    value: { length: historyLength },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AS-475: opening from the board updates the URL without a full reload", () => {
  it("test_AS_475_open_task_from_click_pushes_taskId_via_router_push_preserving_other_params", async () => {
    const { result } = renderHook(() => useTaskDetailSheet());

    await act(async () => {
      result.current.openTask("t1");
    });

    // A client-side soft navigation (router.push), never a full reload —
    // no `window.location.assign`/reload was invoked, only the mocked
    // App Router push.
    expect(push).toHaveBeenCalledTimes(1);
    const [url, options] = push.mock.calls[0];
    expect(url).toBe("/w/acme/projects/proj-1/board?groupBy=status&taskId=t1");
    expect(options).toEqual({ scroll: false });
  });

  it("test_AS_475_open_task_from_url_fromUrl_option_does_not_push_a_duplicate_history_entry", async () => {
    currentSearch = new URLSearchParams("taskId=t1");
    const { result } = renderHook(() => useTaskDetailSheet());

    await act(async () => {
      result.current.openTask("t1", { fromUrl: true });
    });

    expect(push).not.toHaveBeenCalled();
    expect(result.current.open).toBe(true);
    expect(result.current.openTaskId).toBe("t1");
  });
});

describe("AS-476: closing returns to the previous view with scroll and filters preserved", () => {
  it("test_AS_476_close_after_an_in_app_open_uses_router_back_to_restore_the_prior_entry", async () => {
    currentSearch = new URLSearchParams("groupBy=status");
    const { result, rerender } = renderHook(() => useTaskDetailSheet());

    await act(async () => {
      result.current.openTask("t1");
    });
    // Simulate the URL now reflecting the push (as the real App Router
    // would update useSearchParams on the next render).
    currentSearch = new URLSearchParams("groupBy=status&taskId=t1");
    rerender();

    await act(async () => {
      result.current.onOpenChange(false);
    });

    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(result.current.open).toBe(false);
  });

  it("test_AS_476_close_after_a_direct_load_with_no_prior_history_falls_back_to_replace", async () => {
    // Direct load / hard refresh landing on `?taskId=` — this hook never
    // pushed it, so there is no history entry of its own to go back to.
    currentSearch = new URLSearchParams("taskId=t1");
    Object.defineProperty(window, "history", {
      value: { length: 1 },
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => useTaskDetailSheet());

    await act(async () => {
      result.current.openTask("t1", { fromUrl: true });
    });

    await act(async () => {
      result.current.onOpenChange(false);
    });

    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(1);
    const [url, options] = replace.mock.calls[0];
    expect(url).toBe("/w/acme/projects/proj-1/board");
    expect(options).toEqual({ scroll: false });
  });

  it("test_AS_476_close_after_an_in_app_open_falls_back_to_replace_when_no_browser_history_exists", async () => {
    // Opened via this hook's own push (pushedTaskIdRef is true), but the
    // environment reports no navigable history (window.history.length <=
    // 1) — router.back() would strand the user, so replace must be used
    // instead. This is the exact case the spec calls out as easy to get
    // wrong.
    currentSearch = new URLSearchParams();
    Object.defineProperty(window, "history", {
      value: { length: 1 },
      writable: true,
      configurable: true,
    });
    const { result, rerender } = renderHook(() => useTaskDetailSheet());

    await act(async () => {
      result.current.openTask("t1");
    });
    currentSearch = new URLSearchParams("taskId=t1");
    rerender();

    await act(async () => {
      result.current.onOpenChange(false);
    });

    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(1);
  });
});

describe("AS-478: browser back closes the task rather than leaving the app", () => {
  it("test_AS_478_onOpenChange_false_after_a_router_back_style_url_change_does_not_double_navigate", async () => {
    // This simulates the browser's own Back button: the URL already lost
    // `?taskId=` by the time the caller (board.tsx) notices and calls
    // `closeFromUrl` — proving that path never fires another
    // back()/replace() call (it can't fight navigation that already
    // happened).
    currentSearch = new URLSearchParams("groupBy=status&taskId=t1");
    const { result } = renderHook(() => useTaskDetailSheet());

    await act(async () => {
      result.current.openTask("t1", { fromUrl: true });
    });

    currentSearch = new URLSearchParams("groupBy=status");

    await act(async () => {
      result.current.closeFromUrl();
    });

    expect(back).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(result.current.open).toBe(false);
    expect(result.current.openTaskId).toBeNull();
  });
});

// F247's Escape handling must cooperate with F244's shared Escape-layer
// stack (lib/hooks/use-shortcut.ts) rather than adding a second,
// uncoordinated close path — verified end-to-end through the real <Board>
// + <TaskDetailSheet>, using the SAME `popTopEscapeLayer()` the global
// shortcut provider calls on a real Escape keydown (see
// components/command/shortcut-provider.tsx).
describe("AS-478 (Escape cooperates with F244's Escape-layer stack)", () => {
  it("test_AS_478_escape_via_the_shared_layer_stack_closes_the_open_task_sheet", async () => {
    const { __resetEscapeLayersForTests, popTopEscapeLayer } = await import(
      "@/lib/hooks/use-shortcut"
    );
    __resetEscapeLayersForTests();

    const { render, waitFor, cleanup } = await import(
      "@testing-library/react"
    );
    const { createElement } = await import("react");

    vi.doMock("@/lib/actions/comments", () => ({
      getMentionCandidates: vi.fn(async () => ({ ok: true, data: [] })),
    }));

    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";

    currentSearch = new URLSearchParams("taskId=t1");
    const { Board } = await import("@/components/board/board");

    render(
      createElement(Board, {
        projectId: "project-1",
        initialTasks: [
          {
            id: "t1",
            title: "t",
            status: "todo",
            priority: null,
            assigneeId: null,
            dueDate: null,
            position: 1000,
          },
        ],
        timezone: "UTC",
      }),
    );

    await waitFor(() =>
      expect(document.getElementById("task-title-t1")).toBeInTheDocument(),
    );

    // This is the exact call the global shortcut provider makes on a real
    // Escape keydown — proves TaskDetailSheet registered itself as the
    // topmost layer (a layer existed and handled it) rather than the
    // event reaching nothing, or reaching some unrelated lower layer.
    const handled = popTopEscapeLayer();
    expect(handled).toBe(true);

    await waitFor(() =>
      expect(document.getElementById("task-title-t1")).not.toBeInTheDocument(),
    );

    cleanup();
  });
});
