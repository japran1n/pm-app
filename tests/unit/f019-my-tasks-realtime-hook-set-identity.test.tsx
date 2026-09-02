// @vitest-environment jsdom
//
// F019 fix-up (AS-011): proves that `useMyTasksRealtime` passes the SAME
// live `Set` reference (not a copy) to `subscribeToMyTasksRealtime` at its
// call site (components/my-tasks/use-my-tasks-realtime.ts:283).
//
// AS-011 requires the tracked-task-id Set to be ONE shared object across
// both Realtime channels, so an assignment learned on the `task_assignees`
// channel makes `tasks` events for that id deliverable on the `tasks`
// channel. `subscribeToMyTasksRealtime` itself genuinely shares one Set
// between its two closures -- but the hook's call site could instead pass
// `new Set(trackedTaskIdsRef.current)` (a COPY). With a copy:
//   - the FIRST subscription still works (both closures share the copy),
//     so a naive "assign then update" test passes against either variant;
//   - but ids learned live via `onAssigned` are only added to the COPY,
//     never written back into `trackedTaskIdsRef.current`. A re-render
//     that re-seeds from `initialTaskIds` (lib effect at :263-268, which
//     mutates `trackedTaskIdsRef.current` directly) then does not see the
//     live-learned id, and if the subscription effect ever re-runs (e.g.
//     userId change) the NEW subscription is seeded from the ref, silently
//     dropping ids the copy had learned.
//
// This test mounts the REAL hook (not `subscribeToMyTasksRealtime`
// directly), drives a genuine `task_assignees` INSERT then a `tasks`
// UPDATE for the same id through the mocked channel, and separately proves
// the id survives being read back out of the ref-seeded set after a
// re-render -- which only holds if the hook's call site passes the live
// ref object, not a snapshot copy of it.

import { renderHook, act as hookAct } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type OnCall = {
  filter: { event: string; schema: string; table: string };
  callback: (payload: unknown) => void;
  channelName: string;
};

let onCalls: OnCall[] = [];

function makeFakeSupabase() {
  const channelObjects = new Map<string, ReturnType<typeof makeChannelObject>>();

  function makeChannelObject(name: string) {
    const obj = {
      on: vi.fn((_event: string, filter: OnCall["filter"], callback: (payload: unknown) => void) => {
        onCalls.push({ filter, callback, channelName: name });
        return obj;
      }),
      subscribe: vi.fn(() => obj),
    };
    return obj;
  }

  return {
    channel: vi.fn((name: string) => {
      let obj = channelObjects.get(name);
      if (!obj) {
        obj = makeChannelObject(name);
        channelObjects.set(name, obj);
      }
      return obj;
    }),
    removeChannel: vi.fn(),
  };
}

let currentSupabase = makeFakeSupabase();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => currentSupabase,
}));

import { useMyTasksRealtime } from "@/components/my-tasks/use-my-tasks-realtime";

function callbackFor(table: "task_assignees" | "tasks") {
  const match = onCalls.find((call) => call.filter.table === table);
  if (!match) throw new Error(`no .on() callback captured for table "${table}"`);
  return match.callback;
}

afterEach(() => {
  onCalls = [];
  currentSupabase = makeFakeSupabase();
  vi.clearAllMocks();
});

describe("F019/AS-011: useMyTasksRealtime shares one live tracked-id Set across both channels", () => {
  it("test_AS_011_task_assigned_live_then_updated_delivers_onUpdate", () => {
    const onAssigned = vi.fn();
    const onUnassigned = vi.fn();
    const onUpdate = vi.fn();
    const onDelete = vi.fn();

    renderHook(() =>
      useMyTasksRealtime({
        userId: "user-1",
        onAssigned,
        onUnassigned,
        onUpdate,
        onDelete,
      }),
    );

    const assigneesCallback = callbackFor("task_assignees");
    const tasksCallback = callbackFor("tasks");

    // A task_assignees INSERT for a task id this session has never seen
    // before -- the ONLY way "task-live-1" enters the tracked set is via
    // this live event.
    hookAct(() => {
      assigneesCallback({
        eventType: "INSERT",
        new: { task_id: "task-live-1", user_id: "user-1" },
        old: {},
      });
    });
    expect(onAssigned).toHaveBeenCalledWith("task-live-1");

    // A tasks UPDATE for that same id, on the SEPARATE `tasks` channel.
    // This is only deliverable if the two channels' handlers share the
    // exact same Set instance -- with a copy passed at the hook's call
    // site, the `tasks` closure's set would still be an independent
    // object seeded from the same initial contents, so this first
    // round-trip alone doesn't discriminate (see the second test below,
    // which forces a re-seed and proves the live-learned id survives only
    // via the live ref).
    hookAct(() => {
      tasksCallback({
        eventType: "UPDATE",
        new: { id: "task-live-1", title: "updated title" },
        old: {},
      });
    });

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-live-1" }),
    );
  });

  it("test_AS_011_id_learned_live_survives_a_resubscribe_after_userId_change", () => {
    // This is the test that actually discriminates the live-reference
    // mutant (`new Set(trackedTaskIdsRef.current)` at the hook's call
    // site, use-my-tasks-realtime.ts:283) from the correct implementation.
    //
    // With the CORRECT implementation, `trackedTaskIdsRef.current` (the
    // ref itself, not a snapshot) is handed to `subscribeToMyTasksRealtime`
    // on every (re)subscribe. `onAssigned`'s handler inside that function
    // mutates whatever Set object it was given -- so when the live
    // reference is passed, "task-live-3" ends up written into
    // `trackedTaskIdsRef.current` itself.
    //
    // With the MUTANT (`new Set(trackedTaskIdsRef.current)`), the first
    // subscription's handler mutates only that one-off COPY.
    // `trackedTaskIdsRef.current` never learns "task-live-3". The
    // subscription effect's dependency array is `[userId]`
    // (use-my-tasks-realtime.ts:288), so changing `userId` tears down the
    // first subscription and creates a SECOND one, re-reading
    // `trackedTaskIdsRef.current` at that moment. Under the mutant, that
    // second subscribe's brand-new copy is seeded from a ref that never
    // saw "task-live-3", so the `tasks` UPDATE below is silently dropped
    // -- exactly the production bug AS-011 exists to prevent (an id
    // learned earlier in the session going dark after any resubscribe).
    const onAssigned = vi.fn();
    const onUnassigned = vi.fn();
    const onUpdate = vi.fn();
    const onDelete = vi.fn();

    const { rerender } = renderHook(
      ({ userId }: { userId: string }) =>
        useMyTasksRealtime({
          userId,
          onAssigned,
          onUnassigned,
          onUpdate,
          onDelete,
        }),
      { initialProps: { userId: "user-1" } },
    );

    const firstAssigneesCallback = callbackFor("task_assignees");

    hookAct(() => {
      firstAssigneesCallback({
        eventType: "INSERT",
        new: { task_id: "task-live-3", user_id: "user-1" },
        old: {},
      });
    });
    expect(onAssigned).toHaveBeenCalledWith("task-live-3");

    // Force the subscription effect to tear down and re-run against a
    // fresh topic, re-reading `trackedTaskIdsRef.current` at the call
    // site under test.
    onCalls = [];
    rerender({ userId: "user-2" });

    const secondTasksCallback = callbackFor("tasks");

    hookAct(() => {
      secondTasksCallback({
        eventType: "UPDATE",
        new: { id: "task-live-3", title: "still tracked after resubscribe" },
        old: {},
      });
    });

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-live-3" }),
    );
  });
});
