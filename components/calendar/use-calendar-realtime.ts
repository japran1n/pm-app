"use client";

// F009 (AS-019, AS-020, AS-021, AS-022): the calendar's Realtime
// subscription hook. Thin `useEffect` lifecycle glue around
// `subscribeToCalendarRealtime` (lib/tasks/subscribe-calendar-realtime.ts)
// — same split as `useBoardRealtime`/`subscribeToBoardRealtime` (F049):
// the actual channel wiring is a plain, React-free function so it's
// testable without a DOM, this hook only subscribes on mount/workspaceId
// change and unsubscribes on cleanup.
//
// API contract (clarified): `useCalendarRealtime({ workspaceId,
// onDueDateChange })` — callback-based; this hook owns no state of its
// own. The calendar page's client component (calendar-day-grid.tsx) owns
// the `tasksByDate` state and decides how each event changes it (via
// lib/calendar/reconcile-realtime-task.ts).

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  subscribeToCalendarRealtime,
  type CalendarRealtimeEvent,
  type CalendarRealtimeTaskRow,
} from "@/lib/tasks/subscribe-calendar-realtime";

export type { CalendarRealtimeEvent, CalendarRealtimeTaskRow };

export function useCalendarRealtime({
  workspaceId,
  onDueDateChange,
}: {
  workspaceId: string;
  onDueDateChange: (event: CalendarRealtimeEvent) => void;
}) {
  useEffect(() => {
    if (!workspaceId) return;

    const supabase = createClient();
    const unsubscribe = subscribeToCalendarRealtime(
      supabase,
      workspaceId,
      onDueDateChange,
    );

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);
}
