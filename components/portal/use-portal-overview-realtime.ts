// F008 (AS-024): thin React lifecycle glue over
// lib/portal/subscribe-portal-overview-realtime.ts -- subscribe on mount
// (or workspaceId change), unsubscribe on cleanup. Same two-line-wrapper
// shape as components/board/use-board-realtime.ts.
"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";
import { subscribeWhenAuthenticated } from "@/lib/realtime/subscribe-when-authenticated";
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
 *
 * F012 diagnosed a real Realtime auth-hydration race here: on a fresh page
 * load, `createClient()`'s underlying Realtime socket starts unauthenticated
 * and only adopts the real session's JWT once `@supabase/ssr`'s async
 * cookie hydration resolves. A channel created before that finishes joins
 * unauthenticated and every RLS-gated INSERT/UPDATE is silently filtered
 * out (confirmed live, tests/e2e/portal-approve.spec.ts, AS-029). F023
 * hoisted that fix into `subscribeWhenAuthenticated` (see
 * lib/realtime/subscribe-when-authenticated.ts) so every portal subscriber
 * gets it, not just this one.
 */
export function usePortalOverviewRealtime(
  workspaceId: string,
  onChange: (event: PortalOverviewRealtimeEvent) => void,
) {
  useEffect(() => {
    if (!workspaceId) return;

    const supabase = createClient();
    return subscribeWhenAuthenticated(supabase, (client) =>
      subscribeToPortalOverviewRealtime(client, workspaceId, onChange),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);
}
