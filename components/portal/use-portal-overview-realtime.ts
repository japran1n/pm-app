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

    const supabase = createClient();
    const unsubscribe = subscribeToPortalOverviewRealtime(
      supabase,
      workspaceId,
      onChange,
    );

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);
}
