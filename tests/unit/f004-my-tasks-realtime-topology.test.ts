// F004: M1 wiring regression tests for the two-channel My Tasks Realtime
// topology introduced by F003 (components/my-tasks/use-my-tasks-realtime.ts).
//
// This suite is deliberately independent from tests/unit/f008-my-tasks-realtime.test.ts
// (which already covers AS-007/AS-010 at the "does it work" level) and instead
// asserts the topology itself FROM THE OUTSIDE, strictly enough that a mutant
// which collapses both `postgres_changes` bindings back onto a single shared
// channel object is caught even if it still uses two different topic
// *strings* (e.g. by accident reusing the same channel instance for both
// calls) -- we assert on `.on()` call counts PER CHANNEL OBJECT, not just on
// topic name equality.
//
// AS-007: exactly two distinct topics are acquired by one
// `subscribeToMyTasksRealtime` call, and each topic's channel object
// receives exactly ONE `postgres_changes` binding.
// AS-010: the single returned unsubscribe releases BOTH channel objects,
// and no channel object is left un-released.

import { describe, expect, it, vi } from "vitest";

import { subscribeToMyTasksRealtime } from "@/components/my-tasks/use-my-tasks-realtime";

// Mock that tracks, per DISTINCT channel OBJECT (not just per topic
// string), how many `postgres_changes` bindings were registered on it via
// `.on(...)`. `supabase.channel(topic)` returns the SAME object for a
// topic seen twice (matching real `@supabase/realtime-js` dedupe
// behaviour, see lib/realtime/shared-topic-channel.ts's comment block) so
// a mutant that mistakenly passes the same topic string for both tables
// would collapse to one channel object here too -- this mock does not
// paper over that.
function createMockSupabaseClient() {
  const channelObjectsByTopic = new Map<
    string,
    { topic: string; on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }
  >();
  const channelCallOrder: string[] = [];
  const removedChannelObjects: unknown[] = [];

  const supabase = {
    channel: vi.fn((topic: string) => {
      channelCallOrder.push(topic);
      let obj = channelObjectsByTopic.get(topic);
      if (!obj) {
        const channelObject = {
          topic,
          on: vi.fn(() => channelObject),
          subscribe: vi.fn(() => channelObject),
        };
        obj = channelObject;
        channelObjectsByTopic.set(topic, obj);
      }
      return obj;
    }),
    removeChannel: vi.fn((ch: unknown) => {
      removedChannelObjects.push(ch);
    }),
  };

  return { supabase, channelObjectsByTopic, channelCallOrder, removedChannelObjects };
}

describe("F004: My Tasks Realtime two-channel topology (AS-007, AS-010)", () => {
  it("AS-007: acquires exactly two distinct topics, and each topic's channel object receives exactly ONE postgres_changes binding", () => {
    const { supabase, channelObjectsByTopic } = createMockSupabaseClient();

    subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onAssigned: vi.fn(),
      onUnassigned: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });

    // Exactly two distinct topics were acquired.
    expect(channelObjectsByTopic.size).toBe(2);
    const topics = Array.from(channelObjectsByTopic.keys());
    expect(new Set(topics).size).toBe(2);

    // Each topic's channel object got exactly one `postgres_changes`
    // binding registered on it. A mutant that puts both bindings on one
    // channel (whether by reusing the same topic string, or by calling
    // `.on()` twice on the object returned for one of the two topics)
    // fails this assertion: one object would show 2 calls, and only one
    // distinct object would exist for the topics that matter.
    for (const [topic, obj] of channelObjectsByTopic) {
      expect(obj.on, `channel object for topic "${topic}" binding count`).toHaveBeenCalledTimes(1);
    }

    // Total bindings across the whole subscription is exactly 2 (one per
    // channel) -- guards against a mutant adding a third channel/binding
    // that would otherwise slip past the per-topic loop above.
    const totalBindings = Array.from(channelObjectsByTopic.values()).reduce(
      (sum, obj) => sum + obj.on.mock.calls.length,
      0,
    );
    expect(totalBindings).toBe(2);
  });

  it("AS-010: the single returned unsubscribe releases BOTH channel objects, and nothing is left subscribed", async () => {
    const { supabase, channelObjectsByTopic, removedChannelObjects } = createMockSupabaseClient();

    const unsubscribe = subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onAssigned: vi.fn(),
      onUnassigned: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });

    expect(channelObjectsByTopic.size).toBe(2);
    const acquiredChannelObjects = Array.from(channelObjectsByTopic.values());

    unsubscribe();
    // Teardown of the shared-topic-channel registry is deferred one
    // macrotask (see lib/realtime/shared-topic-channel.ts) to survive a
    // synchronous StrictMode remount -- flush it.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Both release paths fired: every channel object acquired by this
    // subscription was passed to `removeChannel`, individually.
    for (const obj of acquiredChannelObjects) {
      expect(
        removedChannelObjects.includes(obj),
        `channel object for topic "${obj.topic}" was released`,
      ).toBe(true);
    }
    expect(removedChannelObjects).toHaveLength(2);

    // Nothing is left subscribed: no channel object remains that was
    // acquired but never released. (Guards against a mutant that releases
    // only one of the two channels, or releases the same one twice while
    // leaving the other live.)
    const uniqueReleased = new Set(removedChannelObjects);
    expect(uniqueReleased.size).toBe(2);
    for (const obj of acquiredChannelObjects) {
      expect(uniqueReleased.has(obj)).toBe(true);
    }
  });

  it("AS-010: calling unsubscribe a second time does not double-release or throw (idempotent teardown)", async () => {
    const { supabase, removedChannelObjects } = createMockSupabaseClient();

    const unsubscribe = subscribeToMyTasksRealtime(supabase as never, "user-1", {
      onAssigned: vi.fn(),
      onUnassigned: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });

    unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(removedChannelObjects).toHaveLength(2);

    expect(() => unsubscribe()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // No further release calls beyond the original two.
    expect(removedChannelObjects).toHaveLength(2);
  });
});
