// F008 (missions/20260903-portal): originally a live "Waiting on you" +
// "Delivered this week" pair for the client portal overview. Mission
// 20260914-portal-simplify, F018 (UX validation defect, AS-007/AS-018):
// the "Waiting on you" card's own empty state ("Nothing waiting on you
// right now.") sat directly beneath Home's new `WaitingOnYouCallout`
// ("N things are waiting on you") -- the same fact stated twice, and
// contradicting each other whenever the callout had a nonzero count (the
// callout counts approvals + overdue deliverables project-wide via
// `getWaitingOnYouCount`; this card only ever showed
// `pending_client_approval` tasks, a different, narrower set). F010's own
// callout, plus the "For you" page it links to, already cover "what does
// the client need to do" -- this card is removed outright rather than
// reconciled to `getWaitingOnYouCount`, per this feature's own "prefer
// removal" instruction. `PortalOverviewLive` is only ever mounted from
// the per-project Overview page (p/[projectId]/page.tsx); the
// workspace-chooser page never imported it (it reads
// `overview.waitingOnYou` directly for its own per-card badge count), so
// nothing else observes this card's removal.
//
// The realtime wiring that fed the removed card (`usePortalOverviewRealtime`,
// the `pending_client_approval` reconcile predicate) is removed with it --
// there is nothing left on this page for it to feed. What remains is the
// "Delivered this week" list, kept as the same read-only server-rendered
// snapshot it always was (it was never wired to realtime -- see the
// pre-F018 history of this file for why: it would need a
// `project_statuses` category join and a wall-clock "within the last 7
// days" check that only makes sense evaluated server-side).
"use client";

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import type { PortalOverview } from "@/lib/queries/portal";
import { formatDayMonth } from "@/lib/format";

export function PortalOverviewLive({
  workspaceSlug,
  initialOverview,
}: {
  workspaceSlug: string;
  initialOverview: PortalOverview;
}) {
  const deliveredThisWeek = initialOverview.deliveredThisWeek;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-5">
      <div className="flex items-center gap-2">
        <CheckCircle2 aria-hidden="true" className="size-4 text-emerald-600" />
        <h2 className="text-sm font-semibold">Delivered this week</h2>
      </div>
      {deliveredThisWeek.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing delivered in the last 7 days.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {deliveredThisWeek.map((task) => (
            <li key={task.id}>
              <Link
                href={`/portal/${workspaceSlug}/p/${task.projectId}/t/${task.id}`}
                className="hover-surface -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate">{task.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDayMonth(task.updatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
