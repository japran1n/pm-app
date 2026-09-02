// F008 (AS-018, AS-019, AS-020, AS-024): live "Waiting on you" and
// "Delivered this week" regions for the client portal overview
// (app/(portal)/portal/[workspaceSlug]/page.tsx), extracted out of that
// RSC into the smallest possible Client Component boundary -- the page
// itself stays server-rendered and keeps its RLS-scoped queries (those
// define what a client is even allowed to see; converting the whole page
// to a client component would lose that), and is only ever seeded here
// via `initialOverview` props.
//
// Follows the same "server-seeded state + realtime reconciler" shape as
// components/task/task-list-table.tsx's useListRealtime wiring: this
// component owns local `useState` initialized from the server props, a
// realtime hook feeds raw postgres_changes events in, and every event is
// run through F007's pure `reconcilePortalRealtimeTask` before being
// applied -- so the client_visible/deleted_at/pending_client_approval
// membership rule is enforced in exactly one place (AS-020), never
// re-derived here.
//
// "Waiting on you" (AS-018, AS-019): surfacePredicate is
// `pending_client_approval === true`, matching those assertions' text
// exactly (they don't mention the task's board-column category). This is
// a deliberate, narrower rule than the server query's own
// `isAwaitingReview && category !== "done"` (lib/queries/portal.ts,
// getPortalOverview) -- the server-computed `category` (done/in_progress/
// not_started) comes from a join with `project_statuses` keyed by
// `status_id`, and a `tasks` Realtime payload never carries that joined
// column. Re-deriving it client-side would mean carrying a second copy of
// `project_statuses` into this component and keeping it in sync with its
// own Realtime stream -- out of scope for what AS-018/AS-019 actually ask
// for. In the rare case a task is marked done AND its
// `pending_client_approval` flag is still true, this list would show it
// live where a full page load wouldn't; that is flagged in this feature's
// handoff as out-of-scope follow-up work, not silently "fixed" by
// inventing an assertion nobody wrote.
//
// "Delivered this week" is NOT assigned any assertion in this feature
// (only AS-018/AS-019/AS-020/AS-024 are). It is intentionally left
// UN-reconciled here rather than wired to a best-effort predicate: like
// "Waiting on you"'s category gap above, "delivered" requires the same
// `project_statuses` category join AND a "was this task's `updated_at`
// within the last 7 days AS OF NOW" check that only makes sense evaluated
// against wall-clock time, which is exactly the kind of computation that
// silently drifts client-side. Attempting to synthesize category from a
// bare `tasks` Realtime row would risk exactly what the spec warned
// against -- a stale-window or wrongly-categorized row appearing without
// the server ever having computed it that way. The safe, honest choice is
// to leave this list as the server-rendered snapshot until the page is
// next loaded; see this feature's handoff for the out-of-scope follow-up
// that would properly wire it (forwarding category via a view, or a
// second query on each `tasks` UPDATE).
"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Clock3 } from "lucide-react";

import type {
  PortalOverview,
  PortalOverviewTask,
} from "@/lib/queries/portal";
import { reconcilePortalRealtimeTask } from "@/lib/portal/reconcile-portal-realtime-task";
import {
  usePortalOverviewRealtime,
  type PortalOverviewRealtimeEvent,
} from "@/components/portal/use-portal-overview-realtime";
import type { PortalOverviewRealtimeRow } from "@/lib/portal/subscribe-portal-overview-realtime";

function formatDate(iso: string): string {
  // Same fixed en-GB short form used by the page/project-progress.tsx, for
  // the same server/client hydration reason.
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function toOverviewTask(
  row: PortalOverviewRealtimeRow,
  projectNameById: Map<string, string>,
): PortalOverviewTask {
  return {
    id: row.id,
    title: row.title,
    projectId: row.project_id,
    projectName: projectNameById.get(row.project_id) ?? "",
    dueDate: row.due_date,
    updatedAt: row.updated_at,
  };
}

function waitingOnYouPredicate(row: PortalOverviewRealtimeRow): boolean {
  // AS-018, AS-019 -- see this file's header comment for why this doesn't
  // also check the task's status category.
  return row.pending_client_approval === true;
}

export function PortalOverviewLive({
  workspaceId,
  workspaceSlug,
  initialOverview,
}: {
  workspaceId: string;
  workspaceSlug: string;
  initialOverview: PortalOverview;
}) {
  const [waitingOnYou, setWaitingOnYou] = useState<PortalOverviewTask[]>(
    initialOverview.waitingOnYou,
  );
  const deliveredThisWeek = initialOverview.deliveredThisWeek;

  const projectNameById = new Map(
    initialOverview.waitingOnYou
      .concat(initialOverview.deliveredThisWeek)
      .map((task) => [task.projectId, task.projectName] as const),
  );

  usePortalOverviewRealtime(workspaceId, (event: PortalOverviewRealtimeEvent) => {
    setWaitingOnYou((current) => {
      const currentAsRows = current.map(
        (task): PortalOverviewRealtimeRow => ({
          id: task.id,
          title: task.title,
          project_id: task.projectId,
          due_date: task.dueDate,
          updated_at: task.updatedAt,
          pending_client_approval: true,
          // AS-020: every row already in this list passed the
          // client_visible/deleted_at membership predicate when it was
          // added (either by the server seed or a prior reconcile pass),
          // so it's re-asserted here rather than re-derived.
          client_visible: true,
          deleted_at: null,
        }),
      );

      const next = reconcilePortalRealtimeTask(
        currentAsRows,
        event,
        waitingOnYouPredicate,
      );

      return next.map((row) => toOverviewTask(row, projectNameById));
    });
  });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-3 rounded-lg border border-border p-5">
        <div className="flex items-center gap-2">
          <Clock3
            aria-hidden="true"
            className="size-4 text-amber-600 dark:text-amber-400"
          />
          <h2 className="text-sm font-semibold">Waiting on you</h2>
        </div>
        {waitingOnYou.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing waiting on you right now.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {waitingOnYou.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/portal/${workspaceSlug}/t/${task.id}`}
                  className="hover-surface flex items-center justify-between gap-3 rounded-md px-2 py-1.5 -mx-2 text-sm"
                >
                  <span className="min-w-0 truncate">{task.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {task.projectName}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border p-5">
        <div className="flex items-center gap-2">
          <CheckCircle2
            aria-hidden="true"
            className="size-4 text-emerald-600 dark:text-emerald-400"
          />
          <h2 className="text-sm font-semibold">Delivered this week</h2>
        </div>
        {deliveredThisWeek.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing delivered in the last 7 days.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {deliveredThisWeek.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/portal/${workspaceSlug}/t/${task.id}`}
                  className="hover-surface flex items-center justify-between gap-3 rounded-md px-2 py-1.5 -mx-2 text-sm"
                >
                  <span className="min-w-0 truncate">{task.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDate(task.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
