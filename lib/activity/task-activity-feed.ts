// F196/F330: client-safe constants and types for the task activity feed.
//
// Split out of lib/queries/task-activity.ts (F330 fix): that module
// imports `createClient` from `@/lib/supabase/server`, which pulls in
// `next/headers` — a server-only API. `DEFAULT_TASK_ACTIVITY_PAGE_SIZE` is
// a runtime value (not erased at compile time like a `type` import), so a
// Client Component importing it from the query module dragged the entire
// server-only module (and `next/headers`) into the client bundle and broke
// the build. This module has zero Supabase/`next/headers` imports and is
// safe for both Client Components and server code to import.
//
// `lib/queries/task-activity.ts` re-exports everything here so existing
// server-side call sites don't need to change their import path.

/** F196's default bounded window size for one activity-feed page/request. */
export const DEFAULT_TASK_ACTIVITY_PAGE_SIZE = 20;

// F308 (FU-12 item 4): a hard server-side cap on `limit`, independent of
// whatever a caller (ultimately the client-supplied "load more" bump in
// components/task/activity-feed.tsx) asks for — that component only ever
// grows `limit` by DEFAULT_TASK_ACTIVITY_PAGE_SIZE increments today, but
// this function is reached via a Server Action a modified/malicious
// client could call directly with an arbitrary `limit`. Capped at 200 —
// 10x this feed's own default window and 2x getAuditLogPage's (F141)
// DEFAULT_AUDIT_PAGE_SIZE, generous enough that no legitimate "load more"
// click sequence would ever hit it in a real task's activity history,
// while still bounding the query.
export const MAX_TASK_ACTIVITY_PAGE_SIZE = 200;

// F194's closed `kind` CHECK-constraint vocabulary, reproduced here as a
// type so a row's `kind` is never treated as an arbitrary string by
// anything downstream of this query (the sentence-building helper in
// lib/activity/format-task-activity-entry.ts switches on this exact
// union).
export type TaskActivityKind = "field_changed" | "comment_added" | "comment_deleted";

export type TaskActivityRow = {
  id: string;
  taskId: string;
  kind: TaskActivityKind;
  /** Null for comment_added/comment_deleted kinds (F194's
   * task_activity_field_presence_check). One of F195's closed field
   * vocabulary ('title' | 'status' | 'priority' | 'due_date' | 'estimate'
   * | 'assignee_id') for field_changed kinds. */
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  /** Null for a system-generated entry (F195/AS-360: the recurrence job's
   * own writes pass p_system: true) — never a real user id standing in
   * for "system". */
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorAvatarUrl: string | null;
  createdAt: string;
};

export type TaskActivityPage = {
  rows: TaskActivityRow[];
  /** True only when requesting a LARGER window than this page would
   * actually return more rows — i.e. "Load more" is a real, useful
   * action. F320 (scrutiny pass 5, AS-358): once the requested window is
   * already clamped to `MAX_TASK_ACTIVITY_PAGE_SIZE`, this is always
   * `false` even if the task genuinely has more activity beyond the cap
   * — asking for an even bigger window would still be clamped to the
   * same 200-row cap and return the exact same page, so offering another
   * "Load more" click would be a lie (nothing further CAN be loaded).
   * See `cappedAtMax` for that case. */
  hasMore: boolean;
  /** F320 (scrutiny pass 5, AS-358): true when this task's activity
   * history is longer than `MAX_TASK_ACTIVITY_PAGE_SIZE` — i.e. there IS
   * more activity than what's shown, but it is permanently unreachable
   * through this query's hard server-side cap. Lets the caller
   * (activity-feed.tsx) render an honest "showing the first 200 items"
   * notice instead of silently truncating with no indication, now that
   * `hasMore` no longer implies "Load more" would return anything new
   * past the cap. */
  cappedAtMax: boolean;
  /** F308 (FU-12 item 6): set only when the underlying query actually
   * failed (a real DB/network error), never for a genuine "this task has
   * no activity yet" result — lets a caller (activity-feed.tsx) render a
   * visibly different state for "something went wrong" vs. "zero rows,
   * legitimately," per this mission's "typed error or null, caller
   * decides how to surface it" convention, instead of both cases
   * collapsing into the same empty array. */
  error?: string;
};
