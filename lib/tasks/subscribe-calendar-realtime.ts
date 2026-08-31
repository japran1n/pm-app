// F009 (AS-019, AS-020, AS-021, AS-022): the actual Realtime channel setup
// for the workspace-wide calendar, extracted out of
// components/calendar/use-calendar-realtime.ts as a plain function so it's
// testable without a React runtime/DOM — same "hook is a thin wrapper,
// this file is the real wiring" split
// lib/board/subscribe-board-realtime.ts (F049) already establishes.
//
// No `filter` on the `postgres_changes` subscription below (unlike
// subscribeToBoardRealtime's `project_id=eq.<projectId>`): the `tasks`
// table has no `workspace_id` column of its own (only `project_id` —
// see supabase/migrations/20260818013805_rls_tasks.sql's own comment on
// this exact shape), so a Realtime row-filter, which can only reference a
// literal column on the subscribed table, cannot narrow to "this
// workspace" the way the board narrows to "this project". This is a
// documented AUTONOMOUS_DECISION (deviating from the clarification's
// literal "`workspace_id = eq.{workspaceId}`" wording, which assumed a
// column that doesn't exist) — see this feature's handoff.
//
// AS-022 (private-project visibility) is still upheld for INSERT/UPDATE:
// Realtime's postgres_changes broadcasts respect the table's RLS SELECT
// policy for any row that still exists at broadcast time
// (tasks_select_active_members, same as the board's own comment
// documents), so a caller only ever receives INSERT/UPDATE events for
// tasks in projects they can see, workspace-unfiltered or not. DELETE is
// the one case RLS can't gate (the row is already gone by the time the
// WAL entry is read — see
// supabase/migrations/20260824050000_realtime_project_statuses_publication.sql's
// identical note for `project_statuses`), so the calendar's own
// reconciliation (lib/calendar/reconcile-realtime-task.ts) additionally
// drops any event — DELETE included — for a `project_id` outside the
// caller's own known-visible project set before touching local state,
// as a client-side backstop for the one path RLS doesn't cover.
//
// The channel/topic string below (`tasks:calendar:<workspaceId>`) is a
// purely local dedup/ref-count key for `shared-topic-channel.ts` (F329) —
// it does not need to correspond to a real Postgres filter, only to be
// unique per workspace so two calendar tabs for different workspaces
// never share a channel.

import type { RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";

import { acquireSharedTopicChannel } from "@/lib/realtime/shared-topic-channel";

export type CalendarRealtimeTaskRow = {
  id: string;
  project_id: string;
  title: string;
  status: string;
  priority: "urgent" | "high" | "medium" | "low" | "backlog" | null;
  due_date: string | null;
  number: number;
  deleted_at: string | null;
  updated_at: string;
};

export type CalendarRealtimeEvent =
  RealtimePostgresChangesPayload<CalendarRealtimeTaskRow>;

export function subscribeToCalendarRealtime(
  supabase: SupabaseClient,
  workspaceId: string,
  onChange: (event: CalendarRealtimeEvent) => void,
): () => void {
  const topic = `tasks:calendar:${workspaceId}`;
  return acquireSharedTopicChannel<CalendarRealtimeEvent>(
    supabase,
    topic,
    (dispatch) =>
      supabase
        .channel(topic)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "tasks",
          },
          (payload: CalendarRealtimeEvent) => {
            dispatch(payload);
          },
        )
        .subscribe(),
    onChange,
  );
}
