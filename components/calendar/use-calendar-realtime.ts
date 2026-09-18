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
import { subscribeWhenAuthenticated } from "@/lib/realtime/subscribe-when-authenticated";
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
  // F041 (AS-022 fix): `onDueDateChange` is an inline closure at the call
  // site (calendar-day-grid.tsx) that captures `visibleDateRange` — the
  // currently displayed month's date window. That range changes every time
  // the caller navigates months, but this effect previously only re-ran on
  // `workspaceId` change (`deps: [workspaceId]`), so the *original* mount's
  // callback — and its stale `visibleDateRange` closure — kept running the
  // subscription for the entire lifetime of the component. A realtime
  // event arriving after navigating to a different month would be scoped
  // against the OLD month's window, not the currently visible one. Adding
  // `onDueDateChange` to deps re-subscribes (tear down + re-create the
  // channel) whenever the caller's closure identity changes, keeping the
  // captured `visibleDateRange` fresh.
  useEffect(() => {
    if (!workspaceId) return;

    const supabase = createClient();
    return subscribeWhenAuthenticated(supabase, (client) =>
      subscribeToCalendarRealtime(client, workspaceId, onDueDateChange),
    );
  }, [workspaceId, onDueDateChange]);
}
