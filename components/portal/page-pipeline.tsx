// F108 (missions/20260903-portal, docs/client-portal-visual-plan.md 3.2):
// the Pages view's journey, as a picture instead of a paragraph.
//
// `status-label.ts` resolves every page down to one of four client-facing
// buckets (`ClientBucket`) — that is the only granularity the data
// actually carries (a project's real statuses are free-text, mapped to
// exactly these four buckets by `resolveClientBucket`; there is no
// seven-way "which of the seven steps is this page on" column anywhere
// in the schema). The seven-step strip this component replaces
// (`page-travel-strip.tsx`) was therefore always a STATIC explainer, the
// same seven words for every project regardless of what pages it
// actually held, with a single fixed highlight on "Waiting on you" (the
// one step where the ball is in the client's court).
//
// This pipeline keeps that same "explain the journey, highlight the
// client's own step" job, but draws it from the real per-page counts the
// Pages view already computes (`counts`, the same object
// `StatusDistribution` used to render as a segmented bar) — so "where are
// my pages" is answered by the axis itself, in one look, instead of a
// bar plus a separate paragraph plus a table beneath both.
//
// Ordered left to right the way a page actually moves: work happens
// (`progress`), sometimes the team is waiting on the CLIENT specifically
// (`waiting`) before it can continue, sometimes it stalls on the team's
// own side (`blocked`), and it eventually lands (`done`). `waiting` is
// always the highlighted step — the client's own bucket — the same
// distinction `page-travel-strip.tsx` drew with the `--status-waiting`
// token rather than a bespoke colour; this component keeps that same
// token for the same reason.
//
// Supersedes AND replaces (not stacks beside) both `PageTravelStrip`
// (the seven-step explainer paragraph/strip) and the Pages view's own
// `StatusDistribution` bar — the pipeline draws the identical bucket
// counts the distribution bar drew, as steps instead of a segmented bar,
// so keeping both would be the same information twice on one screen.
// `StatusDistribution` itself is untouched and still used, unchanged, by
// the Your-list view (F014/F085's own `labels` prop) and the Overview
// tile strip's small bar.
import { AlertTriangle, CheckCircle2, Clock3, UserRound } from "lucide-react";
import type { ComponentType } from "react";

import { cn } from "@/lib/utils";
import { CLIENT_BUCKET_LABELS, type ClientBucket } from "@/components/portal/status-label";

// F108: the journey's own left-to-right order — deliberately not
// `status-distribution.tsx`'s `BUCKET_ORDER` (`waiting, progress,
// blocked, done`), which orders buckets for a KEY (alphabetical-ish,
// doesn't matter), not a chronological pipeline. A page is normally
// being worked on, sometimes waits on the client, sometimes stalls, and
// eventually ships — that is the sequence a "how a page travels" picture
// needs to read left to right.
const PIPELINE_ORDER: ClientBucket[] = ["progress", "waiting", "blocked", "done"];

// The one step where the ball is in the CLIENT's court — same bucket
// `page-travel-strip.tsx` singled out as `CLIENT_STEP`.
const CLIENT_BUCKET: ClientBucket = "waiting";

// No colour-only encoding (chart-rules): every step pairs its
// `--status-*` token with its own icon, not just a tint.
const BUCKET_ICON: Record<ClientBucket, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  progress: Clock3,
  waiting: UserRound,
  blocked: AlertTriangle,
  done: CheckCircle2,
};

const BUCKET_DOT_CLASS: Record<ClientBucket, string> = {
  waiting: "bg-status-waiting",
  progress: "bg-status-progress",
  blocked: "bg-status-blocked",
  done: "bg-status-done",
};

const BUCKET_TEXT_CLASS: Record<ClientBucket, string> = {
  waiting: "text-status-waiting",
  progress: "text-status-progress",
  blocked: "text-status-blocked",
  done: "text-status-done",
};

export function PagePipeline({
  counts,
}: {
  counts: Record<ClientBucket, number>;
}) {
  const total = PIPELINE_ORDER.reduce((sum, bucket) => sum + counts[bucket], 0);

  return (
    <div className="flex flex-col gap-2" data-testid="page-pipeline">
      <h3 className="text-sm font-medium text-foreground">How your pages travel</h3>

      {/* AS-014/AS-017 (this feature's own definition of done): the
          pipeline is the axis AND the count in one picture — no separate
          prose paragraph beneath it. An all-zero pipeline (this
          component's own empty state, since the caller only reaches this
          view once at least one page exists, but must still not divide
          by zero or render a broken bar) states "No pages yet" rather
          than drawing four empty, meaningless steps. */}
      {total === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="page-pipeline-empty">
          No pages yet.
        </p>
      ) : (
        <ol
          className="flex flex-wrap items-stretch gap-x-1 gap-y-3"
          aria-label="How your pages travel, by count"
        >
          {PIPELINE_ORDER.map((bucket, index) => {
            const Icon = BUCKET_ICON[bucket];
            const isClientBucket = bucket === CLIENT_BUCKET;
            const count = counts[bucket];

            return (
              <li key={bucket} className="flex items-stretch gap-1">
                <div
                  data-testid={`page-pipeline-step-${bucket}`}
                  data-highlighted={isClientBucket ? "true" : "false"}
                  className={cn(
                    "flex min-w-28 flex-col items-center justify-center gap-1 rounded-lg border px-3 py-2.5 text-center",
                    isClientBucket
                      ? "border-status-waiting bg-status-waiting-bg"
                      : "border-border bg-muted/40",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <Icon
                      aria-hidden={true}
                      className={cn("size-3.5 shrink-0", BUCKET_TEXT_CLASS[bucket])}
                    />
                    <span
                      className={cn(
                        "text-xs font-medium",
                        isClientBucket ? "text-status-waiting" : "text-muted-foreground",
                      )}
                    >
                      {CLIENT_BUCKET_LABELS[bucket]}
                    </span>
                  </span>
                  <span
                    className="text-lg font-semibold tabular-nums text-foreground"
                    data-testid={`page-pipeline-count-${bucket}`}
                  >
                    {count}
                  </span>
                  <span aria-hidden="true" className={cn("h-1 w-8 rounded-full", BUCKET_DOT_CLASS[bucket])} />
                </div>
                {index < PIPELINE_ORDER.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="flex shrink-0 items-center text-muted-foreground"
                  >
                    →
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
