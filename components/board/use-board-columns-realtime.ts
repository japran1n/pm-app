// F221 (AS-413): thin Client Component lifecycle glue for the board's
// COLUMNS Realtime channel -- mirrors use-board-realtime.ts's two-line
// wrapper exactly (subscribe on mount/projectId change, unsubscribe on
// cleanup), just pointed at subscribeToBoardColumnsRealtime instead.

"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  subscribeToBoardColumnsRealtime,
  type BoardColumnsRealtimeEvent,
  type BoardRealtimeColumnRow,
} from "@/lib/board/subscribe-board-columns-realtime";

export type { BoardColumnsRealtimeEvent, BoardRealtimeColumnRow };

export function useBoardColumnsRealtime(
  projectId: string,
  onChange: (event: BoardColumnsRealtimeEvent) => void,
) {
  useEffect(() => {
    if (!projectId) return;

    const supabase = createClient();
    const unsubscribe = subscribeToBoardColumnsRealtime(
      supabase,
      projectId,
      onChange,
    );

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
}
