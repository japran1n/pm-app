// F008 (AS-024): thin React lifecycle glue over
// lib/portal/subscribe-portal-overview-realtime.ts -- subscribe on mount
// (or workspaceId change), unsubscribe on cleanup. Same two-line-wrapper
// shape as components/board/use-board-realtime.ts.
"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  subscribeToPortalOverviewRealtime,
  type PortalOverviewRealtimeEvent,
} from "@/lib/portal/subscribe-portal-overview-realtime";

export type { PortalOverviewRealtimeEvent };

/**
 * Subscribes to Realtime changes on `tasks` relevant to the client
 * portal overview for `workspaceId`. Calls `onChange` for every event
 * received while mounted. Cleanup (unsubscribe) happens automatically on
 * unmount or when `workspaceId` changes (AS-024).
 */
export function usePortalOverviewRealtime(
  workspaceId: string,
  onChange: (event: PortalOverviewRealtimeEvent) => void,
) {
  useEffect(() => {
    if (!workspaceId) return;

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const supabase = createClient();

    // F012: on a fresh page load, `createClient()`'s underlying Realtime
    // socket starts with `accessTokenValue === null` (unauthenticated) and
    // only adopts the real session's JWT once `@supabase/ssr`'s async
    // cookie hydration completes and fires its own internal
    // `onAuthStateChange` -> `realtime.setAuth(token)`. If a channel is
    // created and `.subscribe()`d BEFORE that resolves (as this effect
    // used to do, synchronously on mount), the join is sent
    // unauthenticated -- confirmed live against the real linked Supabase
    // project (tests/e2e/portal-approve.spec.ts, AS-029): the channel
    // still reports "Subscribed to PostgreSQL", so this fails silently.
    // An UNAUTHENTICATED join receives every table-wide DELETE (Realtime
    // does not apply RLS to DELETE payloads at all) but is filtered out of
    // every RLS-gated INSERT/UPDATE -- exactly the failure mode observed:
    // the client's own approval UPDATE never arrived on this channel.
    // Once the real session's `setAuth(token)` DOES eventually fire, a
    // race inside `@supabase/realtime-js`'s `_performAuth` (multiple
    // concurrent `setAuth` calls racing on the same `accessTokenValue`
    // comparison) can drop the token push to an already-joined channel
    // entirely, so the anon-scoped join never gets upgraded either.
    // Fix: explicitly await the session and hand its JWT to
    // `realtime.setAuth()` BEFORE ever creating the channel, so the very
    // first `phx_join` this effect sends already carries the real,
    // authenticated `access_token` -- no race, no silent anon fallback.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const accessToken = data.session?.access_token;
      const afterAuth = accessToken
        ? supabase.realtime.setAuth(accessToken)
        : Promise.resolve();
      afterAuth.then(() => {
        if (cancelled) return;
        unsubscribe = subscribeToPortalOverviewRealtime(
          supabase,
          workspaceId,
          onChange,
        );
      });
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);
}
