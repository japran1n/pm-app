// F023 (AS-021, AS-022, AS-023, AS-024): unit coverage for
// lib/realtime/subscribe-when-authenticated.ts in isolation, independent
// of any one portal component. Exercises the mechanism directly: the
// caller's `subscribe` callback must only run after the session and
// realtime auth are hydrated, never after an unmount that happened first,
// and a rejected hydration must never throw or subscribe.
import { describe, expect, it, vi } from "vitest";

import { subscribeWhenAuthenticated } from "@/lib/realtime/subscribe-when-authenticated";

function makeSupabase(overrides: {
  getSession?: () => Promise<{
    data: { session: { access_token: string } | null };
  }>;
  setAuth?: () => Promise<unknown>;
} = {}) {
  return {
    auth: {
      getSession:
        overrides.getSession ??
        vi.fn(() =>
          Promise.resolve({
            data: { session: { access_token: "token-123" } },
          }),
        ),
    },
    realtime: {
      setAuth: overrides.setAuth ?? vi.fn(() => Promise.resolve()),
    },
    // Minimal stand-in; `subscribe` never actually touches this in these
    // tests -- it's the argument being passed through.
  } as unknown as Parameters<typeof subscribeWhenAuthenticated>[0];
}

async function flush(times = 4) {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe("subscribeWhenAuthenticated", () => {
  it("test_AS_021_022_023_subscribes_only_after_session_and_setAuth_resolve", async () => {
    const supabase = makeSupabase();
    const subscribe = vi.fn(() => vi.fn());

    subscribeWhenAuthenticated(supabase, subscribe);

    // Not yet -- getSession()/setAuth() haven't resolved.
    expect(subscribe).not.toHaveBeenCalled();

    await flush();

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith(supabase);
    expect(supabase.realtime.setAuth).toHaveBeenCalledWith("token-123");
  });

  it("test_AS_024_release_before_session_resolves_prevents_subscribe", async () => {
    let resolveSession: (value: {
      data: { session: { access_token: string } | null };
    }) => void = () => {};
    const supabase = makeSupabase({
      getSession: () =>
        new Promise<{
          data: { session: { access_token: string } | null };
        }>((resolve) => {
          resolveSession = resolve;
        }),
    });
    const subscribe = vi.fn(() => vi.fn());

    const release = subscribeWhenAuthenticated(supabase, subscribe);
    release();

    resolveSession({ data: { session: { access_token: "token-123" } } });
    await flush();

    expect(subscribe).not.toHaveBeenCalled();
  });

  // Distinct from the case above: here `getSession()` has already resolved
  // (so the FIRST `cancelled` check already passed) and only `setAuth()`
  // is still pending when release() runs. This targets the SECOND
  // `cancelled` guard specifically -- deleting only that one leaves the
  // test above green but must fail this one.
  it("test_AS_024_release_after_getSession_but_before_setAuth_resolves_prevents_subscribe", async () => {
    let resolveAuth: () => void = () => {};
    const supabase = makeSupabase({
      setAuth: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveAuth = resolve;
          }),
      ),
    });
    const subscribe = vi.fn(() => vi.fn());

    const release = subscribeWhenAuthenticated(supabase, subscribe);

    // Let `getSession()` resolve and `setAuth()` get called, but not yet
    // resolve.
    await flush(2);
    expect(supabase.realtime.setAuth).toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();

    release();
    resolveAuth();
    await flush();

    expect(subscribe).not.toHaveBeenCalled();
  });

  it("test_AS_024_release_after_subscribe_calls_the_returned_unsubscribe", async () => {
    const supabase = makeSupabase();
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);

    const release = subscribeWhenAuthenticated(supabase, subscribe);
    await flush();
    expect(subscribe).toHaveBeenCalledTimes(1);

    release();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("test_AS_024_rejected_getSession_never_throws_or_subscribes", async () => {
    const supabase = makeSupabase({
      getSession: () => Promise.reject(new Error("network down")),
    });
    const subscribe = vi.fn(() => vi.fn());

    // Must not reject/throw synchronously or produce an unhandled
    // rejection -- vitest fails the run on an unhandled rejection, so
    // simply reaching the assertions below is part of the proof.
    subscribeWhenAuthenticated(supabase, subscribe);

    await flush();

    expect(subscribe).not.toHaveBeenCalled();
  });

  it("test_AS_024_rejected_setAuth_never_throws_or_subscribes", async () => {
    const supabase = makeSupabase({
      setAuth: () => Promise.reject(new Error("setAuth failed")),
    });
    const subscribe = vi.fn(() => vi.fn());

    subscribeWhenAuthenticated(supabase, subscribe);

    await flush();

    expect(subscribe).not.toHaveBeenCalled();
  });

  it("test_AS_024_no_access_token_still_subscribes_without_calling_setAuth", async () => {
    const supabase = makeSupabase({
      getSession: () => Promise.resolve({ data: { session: null } }),
    });
    const subscribe = vi.fn(() => vi.fn());

    subscribeWhenAuthenticated(supabase, subscribe);
    await flush();

    expect(supabase.realtime.setAuth).not.toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});
