"use client";

// F196: the task detail sheet's Activity tab (AS-358, AS-361).
//
// Toggle, not interleave (this feature's spec: "EITHER interleave comments
// and field changes in one chronological feed, OR a toggle between
// 'Comments' and 'All activity' views — pick one and be consistent"): a
// toggle was chosen because comment-list.tsx already owns a fully-featured
// comment surface (rich-text rendering, add/delete/undo, realtime
// reconciliation) that this feature's Files scope does not include — the
// interleaved-feed approach would require either duplicating that
// rendering here (a second source of truth for "what a comment looks
// like") or reaching into comment-list.tsx's internals (out of this
// feature's file scope). A toggle lets CommentList keep owning comment
// rendering entirely, while this component owns the read-only chronicle
// of everything (including comment_added/comment_deleted EVENTS, per
// AS-356 — the fact that a comment was added/removed is still shown here,
// just not its content) — the simpler option with no new dependency and
// no second source of truth, per this feature's clarified ambiguity
// answer. See task-detail-sheet.tsx for how the two are wired into one
// Tabs control.
//
// Pattern: same "smallest possible client boundary" convention as
// CommentList/AttachmentList/TimeTracking (this Sheet's own doc comment
// explains why: it's already a Client Component, so a Server Component
// wrapper here would mean a second network round trip). Data is fetched
// lazily via the getTaskActivityFeed Server Action, once this tab is
// actually shown, rather than being bundled into the Sheet's existing
// getTaskDetail round trip — a viewer who never opens the Activity tab
// never pays for this query at all (clarified performance budget: "no
// per-item network call", read as "no unnecessary network call" for a
// section the caller invokes on demand — see lib/actions/task-activity.ts's
// own doc comment for the full rationale).
//
// AS-358: newest first, expandable to older entries. `getTaskActivityFeed`
// already returns rows newest-first (lib/queries/task-activity.ts); "Load
// more" bumps the requested window size and re-fetches, matching F141's
// audit log viewer's own bounded-window-plus-load-more pattern (that
// feature's Draft scope: "Load a bounded window ... with a load-more
// control").
//
// AS-361: grouped by day (the day boundary computed in the user's
// timezone via lib/time/user-timezone.ts's shared todayInTimeZone/
// startOfDayInTimeZone, F124/F275's infrastructure — never UTC, never the
// browser's ambient zone; that day-bucketing/label logic lives in the
// pure, independently unit-tested groupTaskActivityEntriesByDay in
// lib/activity/format-task-activity-entry.ts), AND each entry's own
// timestamp is rendered as a relative time ("2 hours ago") via
// date-fns's formatDistanceToNow — the same helper comment-list.tsx and
// notification-panel.tsx already use for their own per-item timestamps
// (F308/FU-12: this used to render an absolute clock time here; fixed to
// match the assertion text instead of re-interpreting it). The exact
// absolute time is still available via this <time> element's `title`
// attribute for anyone who hovers.

import { useEffect, useState } from "react";
import { Loader2, History } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { getTaskActivityFeed } from "@/lib/actions/task-activity";
// F330: the query module (`@/lib/queries/task-activity`) imports
// `@/lib/supabase/server`, which imports `next/headers` — server-only.
// This Client Component only ever needed the page-size constant and a
// type, both of which live in this dependency-free module instead (see
// its own header comment for the full story).
import {
  DEFAULT_TASK_ACTIVITY_PAGE_SIZE,
  type TaskActivityRow,
} from "@/lib/activity/task-activity-feed";
import {
  formatTaskActivityEntry,
  formatTaskActivityTime,
  groupTaskActivityEntriesByDay,
} from "@/lib/activity/format-task-activity-entry";
import { UserAvatar, type UserAvatarPerson } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { TaskDetailSheetMember } from "@/components/task/task-detail-sheet";

/** Same "name -> email -> id" fallback chain personLabel/authorLabel use
 * elsewhere in this Sheet (comment-list.tsx's own authorLabel) — kept as
 * a small local copy here rather than importing comment-list's private
 * helper, since it isn't exported and this component's actor shape
 * (already resolved by the query, not looked up against a `members`
 * list) is slightly different. */
function actorDisplayLabel(row: TaskActivityRow): string | null {
  if (!row.actorId) return null; // system entry — formatTaskActivityEntry renders "System"
  return row.actorName || row.actorEmail || row.actorId;
}

/** F308 (FU-12 item 2): resolves an assignee-change entry's user id to a
 * display label from the workspace `members` list — same "name -> email ->
 * id" fallback chain as `actorDisplayLabel`/task-detail-sheet's own
 * memberLabel. A user id with no matching member (e.g. a former member
 * who's since lost access) still falls back to the raw id rather than
 * silently producing "someone" for a real, resolvable-elsewhere id. */
function makeResolveAssigneeLabel(
  members: TaskDetailSheetMember[],
): (userId: string) => string | null {
  return (userId: string) => {
    const member = members.find((m) => m.userId === userId);
    if (!member) return userId;
    return member.name || member.email || member.userId;
  };
}

function actorPerson(row: TaskActivityRow): UserAvatarPerson | null {
  if (!row.actorId) return null;
  return {
    id: row.actorId,
    name: row.actorName,
    email: row.actorEmail,
    avatarUrl: row.actorAvatarUrl,
  };
}

export function ActivityFeed({
  taskId,
  timezone,
  members = [],
}: {
  taskId: string;
  /** F124/F275: the viewer's IANA timezone, same prop task-detail-sheet.tsx
   * already threads through to every other timezone-aware surface in this
   * Sheet (isOverdue, formatDueDate). */
  timezone: string;
  /** F308 (FU-12 item 2): workspace members, used to resolve an
   * assignee-change entry's old/new user id into a real display name
   * (same "name -> email -> id" fallback chain as memberLabel/
   * authorLabel elsewhere in this Sheet) instead of the generic
   * "someone" placeholder. Optional/defaulted so existing callers/tests
   * that don't pass it still render (assignee entries just fall back to
   * "someone", same as before this fix). */
  members?: TaskDetailSheetMember[];
}) {
  const [rows, setRows] = useState<TaskActivityRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  // F320 (scrutiny pass 5, AS-358): true when the server's hard
  // MAX_TASK_ACTIVITY_PAGE_SIZE cap was reached and this task genuinely
  // has more activity beyond it — "Load more" is hidden in this case
  // (nothing further CAN be fetched, see getTaskActivityPage's own doc
  // comment) and this honest notice is shown instead of silently
  // truncating with no indication.
  const [cappedAtMax, setCappedAtMax] = useState(false);
  const [limit, setLimit] = useState(DEFAULT_TASK_ACTIVITY_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchPage(pageLimit: number) {
    const result = await getTaskActivityFeed(taskId, pageLimit);
    if (result.ok) {
      setRows(result.data.rows);
      setHasMore(result.data.hasMore);
      setCappedAtMax(result.data.cappedAtMax);
      setError(null);
    } else {
      setError(result.error);
    }
  }

  // Re-fetches (from the default bounded window, discarding any
  // previously expanded "load more" state) whenever `taskId` changes —
  // covers the Sheet being reused for a different task without a full
  // remount, same "task switch resets this section's local state"
  // convention CommentList's own syncedTaskId effect follows.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      setLoading(true);
      setLimit(DEFAULT_TASK_ACTIVITY_PAGE_SIZE);
      await fetchPage(DEFAULT_TASK_ACTIVITY_PAGE_SIZE);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  async function handleLoadMore() {
    const nextLimit = limit + DEFAULT_TASK_ACTIVITY_PAGE_SIZE;
    setLoadingMore(true);
    setLimit(nextLimit);
    await fetchPage(nextLimit);
    setLoadingMore(false);
  }

  async function handleRetry() {
    setLoading(true);
    await fetchPage(limit);
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-2/3" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button type="button" variant="outline" size="sm" onClick={handleRetry}>
          Retry
        </Button>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <History className="size-4" aria-hidden="true" />
        No activity yet.
      </div>
    );
  }

  // AS-358: rows already arrive newest-first from the query; the group
  // function preserves that ordering, it does not re-sort.
  const groups = groupTaskActivityEntriesByDay(rows, timezone);
  const resolveAssigneeLabel = makeResolveAssigneeLabel(members);

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            {group.label}
          </h4>
          <ul className="flex flex-col gap-2">
            {group.entries.map((row) => {
              const person = actorPerson(row);
              const sentence = formatTaskActivityEntry({
                kind: row.kind,
                field: row.field,
                oldValue: row.oldValue,
                newValue: row.newValue,
                actorLabel: actorDisplayLabel(row),
                timeZone: timezone,
                resolveAssigneeLabel,
              });

              return (
                <li key={row.id} className="flex items-start gap-2 text-sm">
                  {person ? (
                    <UserAvatar person={person} size="sm" />
                  ) : (
                    <span
                      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground"
                      aria-hidden="true"
                    >
                      <History className="size-3.5" />
                    </span>
                  )}
                  <span className="flex-1">{sentence}</span>
                  <time
                    dateTime={row.createdAt}
                    title={formatTaskActivityTime(row.createdAt, timezone)}
                    className="shrink-0 text-xs text-muted-foreground"
                  >
                    {formatDistanceToNow(new Date(row.createdAt), {
                      addSuffix: true,
                    })}
                  </time>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {hasMore && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={loadingMore}
          onClick={handleLoadMore}
        >
          {loadingMore ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            "Load more"
          )}
        </Button>
      )}

      {cappedAtMax && (
        <p className="text-xs text-muted-foreground">
          Showing the first 200 activity items.
        </p>
      )}
    </div>
  );
}
