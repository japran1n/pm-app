import { logger } from "@/lib/observability/logger";

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

// F330: the client-safe constants/types below moved to
// lib/activity/task-activity-feed.ts (no `next/headers` in that module's
// import graph) so a Client Component can import
// `DEFAULT_TASK_ACTIVITY_PAGE_SIZE` (a runtime value, not erased like a
// `type` import) without pulling this server-only module — and therefore
// `next/headers` — into the client bundle. Re-exported here so existing
// server-side callers of this file don't need to change their import
// path.
export {
  DEFAULT_TASK_ACTIVITY_PAGE_SIZE,
  MAX_TASK_ACTIVITY_PAGE_SIZE,
  type TaskActivityKind,
  type TaskActivityRow,
  type TaskActivityPage,
} from "@/lib/activity/task-activity-feed";
import {
  DEFAULT_TASK_ACTIVITY_PAGE_SIZE,
  MAX_TASK_ACTIVITY_PAGE_SIZE,
  type TaskActivityKind,
  type TaskActivityRow,
  type TaskActivityPage,
} from "@/lib/activity/task-activity-feed";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Fetches a bounded, reverse-chronological (AS-358: newest first) window of
 * `task_activity` rows for one task, with actor display data resolved.
 * Returns `{ rows: [], hasMore: false }` for a task the caller's session
 * cannot see (RLS silently returns zero rows) or any other genuine empty
 * result — never throws. A real query failure instead returns
 * `{ rows: [], hasMore: false, error: <message> }` (F308/FU-12 item 6) so
 * the caller can distinguish "no activity" from "the fetch failed."
 */
export async function getTaskActivityPage(
  taskId: string,
  limit: number = DEFAULT_TASK_ACTIVITY_PAGE_SIZE,
): Promise<TaskActivityPage> {
  const supabase = await createClient();

  // F308 (FU-12 item 4): clamp a caller-supplied `limit` to a hard server
  // cap, independent of what the client asked for — see
  // MAX_TASK_ACTIVITY_PAGE_SIZE's own doc comment.
  const boundedLimit = Math.max(
    1,
    Math.min(limit, MAX_TASK_ACTIVITY_PAGE_SIZE),
  );

  const { data, error } = await supabase
    .from("task_activity")
    .select("id, task_id, kind, field, old_value, new_value, actor_id, created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false })
    // AS-358: fetch one extra row to detect "more entries exist beyond
    // this window" without a separate count query — same technique
    // getAuditLogPage (F141) uses.
    .limit(boundedLimit + 1);

  if (error) {
    logger.error("getTaskActivityPage: fetch failed", { error: error });
    return {
      rows: [],
      hasMore: false,
      cappedAtMax: false,
      error: "Couldn't load activity. Try again.",
    };
  }

  const allRows = data ?? [];
  const moreRowsExist = allRows.length > boundedLimit;
  const pageRows = moreRowsExist ? allRows.slice(0, boundedLimit) : allRows;

  // F320 (scrutiny pass 5, AS-358): once `boundedLimit` is already clamped
  // to the hard cap, a bigger requested `limit` would be clamped to the
  // exact same value and return the exact same page — "Load more" cannot
  // actually load anything more. `hasMore` must reflect that (false), even
  // though `moreRowsExist` is true; `cappedAtMax` carries the "there
  // really is more, but it's unreachable" signal separately so the caller
  // can be honest about why the control disappeared instead of silently
  // implying the task's activity ends here.
  const cappedAtMax = boundedLimit >= MAX_TASK_ACTIVITY_PAGE_SIZE && moreRowsExist;
  const hasMore = moreRowsExist && !cappedAtMax;

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

  return { rows, hasMore, cappedAtMax };
}
