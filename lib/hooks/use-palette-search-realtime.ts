// F012 (AS-023, AS-024): keeps the command palette's search results in
// sync with live task title/deletion changes while the palette is open
// with a non-empty query.
//
// Thin Client Component hook, mirroring components/board/use-board-realtime.ts's
// split — the actual channel wiring lives in
// lib/palette/subscribe-palette-search-realtime.ts (a plain, React-free
// function), and the merge logic lives in
// lib/palette/reconcile-palette-search-results.ts (also plain/pure), so both
// halves are unit-testable without a DOM/React runtime.
//
// Only subscribes when `query.length > 0` — an empty query renders recents,
// not search results (command-palette.tsx), so there is nothing to
// reconcile and no channel is opened. Effect cleanup (unmount, or `query`
// transitioning back to empty / palette closing which clears `query`)
// releases the shared channel subscription.
//
// Reconciliation is debounced to at most once per 100ms (clarified
// "Debounce: don't reconcile more than once per 100ms") — a burst of
// events (e.g. several tasks updated at once) coalesces into a single
// state update using the LATEST payload per task id rather than replaying
// every intermediate event, which also keeps this from firing a new server
// search (side-effect verification: reconcile never calls searchPalette).

"use client";

import { useEffect, useRef } from "react";

import { createClient } from "@/lib/supabase/client";
import type { PaletteSearchResults } from "@/lib/palette/palette-search-types";
import { reconcilePaletteSearchResults } from "@/lib/palette/reconcile-palette-search-results";
import {
  subscribeToPaletteSearchRealtime,
  type PaletteRealtimeEvent,
} from "@/lib/palette/subscribe-palette-search-realtime";

const RECONCILE_DEBOUNCE_MS = 100;

// AS-024 (F037 fix): `onDeletedTaskId` fires for EVERY delete/soft-delete
// event this hook observes, unconditionally — independent of whether the
// task happens to be present in the caller's current results state. The
// caller previously derived "was this task deleted?" by diffing its own
// results before/after `setResults`, which meant a DELETE arriving for a
// task that hadn't made it into `results` yet (e.g. still mid-debounce on
// the initial search) produced no signal at all, so no tombstone was ever
// recorded and a slower, later-resolving search response could resurrect
// the task. Deriving the deleted id straight from the raw event here closes
// that gap.
export function usePaletteSearchRealtime(
  workspaceId: string,
  query: string,
  setResults: React.Dispatch<React.SetStateAction<PaletteSearchResults>>,
  onDeletedTaskId?: (id: string) => void,
) {
  const pendingEvents = useRef<PaletteRealtimeEvent[]>([]);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setResultsRef = useRef(setResults);
  const onDeletedTaskIdRef = useRef(onDeletedTaskId);

  useEffect(() => {
    setResultsRef.current = setResults;
  }, [setResults]);

  useEffect(() => {
    onDeletedTaskIdRef.current = onDeletedTaskId;
  }, [onDeletedTaskId]);

  useEffect(() => {
    if (!workspaceId || query.length === 0) return;

    // Guard against environments where a Supabase browser client cannot be
    // constructed (e.g. missing NEXT_PUBLIC_SUPABASE_* env vars in a test
    // environment that renders this component without mocking the client).
    // Mirrors the "lazy-initialize only when actually subscribing" pattern
    // so a misconfigured/absent client degrades to "no live updates"
    // instead of crashing the whole component tree.
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }

    function flush() {
      debounceTimer.current = null;
      const events = pendingEvents.current;
      pendingEvents.current = [];
      if (events.length === 0) return;

      // AS-024: report every delete/soft-delete unconditionally, BEFORE
      // (and independent of) the results reduce below, so the caller can
      // record a tombstone even for a task it never had in `results`.
      const onDeletedTaskId = onDeletedTaskIdRef.current;
      if (onDeletedTaskId) {
        for (const event of events) {
          if (event.eventType === "DELETE") {
            const id = (event.old as { id?: string } | undefined)?.id;
            if (id) onDeletedTaskId(id);
            continue;
          }
          if (event.eventType === "UPDATE") {
            const row = event.new as
              | { id?: string; deleted_at?: string | null }
              | undefined;
            if (row?.id && row.deleted_at) onDeletedTaskId(row.id);
          }
        }
      }

      setResultsRef.current((current) =>
        events.reduce(
          (acc, event) => reconcilePaletteSearchResults(acc, event),
          current,
        ),
      );
    }

    function onChange(event: PaletteRealtimeEvent) {
      pendingEvents.current.push(event);
      if (debounceTimer.current === null) {
        debounceTimer.current = setTimeout(flush, RECONCILE_DEBOUNCE_MS);
      }
    }

    const unsubscribe = subscribeToPaletteSearchRealtime(
      supabase,
      workspaceId,
      onChange,
    );

    return () => {
      unsubscribe();
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      pendingEvents.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, query.length > 0]);
}
