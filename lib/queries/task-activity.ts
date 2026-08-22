// F196: task activity feed query (AS-358, AS-361), reading the `task_activity`
// rows F194 created and F195 writes.
//
// Read access: this file makes NO attempt to re-check task visibility
// itself — F194's `task_activity_select_visible` RLS policy (reusing the
// shared `public.is_task_visible_to(task_id)` helper, same rule the task
// row itself is gated by) already restricts a direct query to rows the
// caller's session can see; a non-member gets an empty array, not an
// error (AS-359, verified end-to-end by F194's own RLS tests). This
// function uses the caller's SESSION-BOUND client (`lib/supabase/server`),
// never the admin client, specifically so that guarantee actually applies
// to what gets returned here — matching `lib/queries/audit.ts`'s (F141)
// own "reads rely entirely on RLS, this function does not widen
// visibility" convention.
//
// Bounded window (clarified spec's performance budget: "no N+1 queries
// per row and no per-item network call"): `limit` defaults to
// DEFAULT_TASK_ACTIVITY_PAGE_SIZE and the caller (ActivityFeed's "load
// more") can request a larger window — this always re-runs ONE bounded,
// reverse-chronological query, never an unbounded `select *`. One extra
// row is fetched (`limit + 1`) to detect "more entries exist" without a
// separate count query, same technique `getAuditLogPage` (F141) uses.
// Actor display data for every non-null `actor_id` in the page is
// resolved with ONE batched `resolvePeople` call (F122's shared batched
// resolver) — not one Auth/profile lookup per row.

import { createClient } from "@/lib/supabase/server";
import { resolvePeople } from "@/lib/queries/people";
import type { Json } from "@/lib/supabase/database.types";

export const DEFAULT_TASK_ACTIVITY_PAGE_SIZE = 20;

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
  oldValue: Json;
  newValue: Json;
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
  hasMore: boolean;
};

/**
 * Fetches a bounded, reverse-chronological (AS-358: newest first) window of
 * `task_activity` rows for one task, with actor display data resolved.
 * Returns `{ rows: [], hasMore: false }` — never throws — for a task the
 * caller's session cannot see (RLS silently returns zero rows) or for any
 * other empty result, matching this module's "never crash a render"
 * convention shared with lib/time/user-timezone.ts.
 */
export async function getTaskActivityPage(
  taskId: string,
  limit: number = DEFAULT_TASK_ACTIVITY_PAGE_SIZE,
): Promise<TaskActivityPage> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("task_activity")
    .select("id, task_id, kind, field, old_value, new_value, actor_id, created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false })
    // AS-358: fetch one extra row to detect "more entries exist beyond
    // this window" without a separate count query — same technique
    // getAuditLogPage (F141) uses.
    .limit(limit + 1);

  if (error) {
    console.error("getTaskActivityPage: fetch failed:", error);
    return { rows: [], hasMore: false };
  }

  const allRows = data ?? [];
  const hasMore = allRows.length > limit;
  const pageRows = hasMore ? allRows.slice(0, limit) : allRows;

  const actorIds = Array.from(
    new Set(
      pageRows
        .map((row) => row.actor_id)
        .filter((id): id is string => id !== null),
    ),
  );
  const people = actorIds.length > 0 ? await resolvePeople(actorIds) : new Map();

  const rows: TaskActivityRow[] = pageRows.map((row) => {
    const person = row.actor_id ? people.get(row.actor_id) : undefined;
    return {
      id: row.id,
      taskId: row.task_id,
      kind: row.kind as TaskActivityKind,
      field: row.field,
      oldValue: row.old_value as Json,
      newValue: row.new_value as Json,
      actorId: row.actor_id,
      actorName: person?.name ?? null,
      actorEmail: person?.email ?? null,
      actorAvatarUrl: person?.avatarUrl ?? null,
      createdAt: row.created_at,
    };
  });

  return { rows, hasMore };
}
