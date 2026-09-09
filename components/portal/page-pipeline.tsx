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
// Supersedes AND replaces (not stacks beside) both `PageTravelStrip`
// (the seven-step explainer paragraph/strip) and the Pages view's own
// `StatusDistribution` bar — the pipeline draws the identical bucket
// counts the distribution bar drew, as steps instead of a segmented bar,
// so keeping both would be the same information twice on one screen.
// `StatusDistribution` itself is untouched and still used, unchanged, by
// the Your-list view (F014/F085's own `labels` prop) and the Overview
// tile strip's small bar.
//
// F108 round 2 (coordinator review), two real defects in the first cut:
//
// 1. "Blocked is not a step in a journey." The original four-step chain
//    (`progress → waiting → blocked → done`) drew an arrow from
//    "Blocked" into "Ready to launch", which tells a client that pages
//    pass THROUGH blocked on the way to launch — they don't. Blocked is
//    a state that can strike a page at any point in the flow, not a
//    position between two others; drawing it inline was the chart
//    lying about the data. The flow below is now only the three buckets
//    that genuinely follow one another (`progress → waiting → done`),
//    connected by arrows. Blocked is rendered as its own marker, set
//    apart from the arrow chain by a plain divider rather than an arrow
//    (an arrow implies "leads to", a divider does not), and coloured/
//    iconed distinctly (`AlertTriangle`, `--status-blocked`) rather than
//    slotted into the sequence.
// 2. "The pipeline orphans its last step" at narrow widths (the same
//    shape as the tile-grid orphan fixed for `overview-tiles.tsx`). The
//    flow no longer wraps at all — `flex-nowrap` plus `overflow-x-auto`
//    (the same "wide content scrolls inside its own container" pattern
//    `hours-burndown-chart.tsx` already uses for its own SVG) guarantees
//    every arrow always connects two steps on the same row; a narrow
//    viewport scrolls the strip horizontally instead of wrapping a
//    trailing arrow into empty space.
//
// F108 round 3 (coordinator review): fixing #2 by putting the blocked
// marker INSIDE that same scroll container created a new problem — at
// 808px the scroller's default position cut the blocked marker off
// (`asideRight` past the viewport edge), with nothing signalling there
// was more to scroll to. The one number a client most needs to act on
// was the one hidden off-screen.
//
// Fix: the blocked marker moves OUTSIDE the scroller entirely, in its
// own row beneath it, always visible regardless of scroll position or
// viewport width. This is truer to round 2's own decision, not just a
// layout patch — `Blocked` was already established as "not a step in
// the sequence"; a thing that is not part of the flow has no reason to
// live inside the flow's OWN scroll container either. Only the
// three-step arrow chain scrolls now (and only needs to, on the
// narrowest viewports); the blocked count is unconditionally on
// screen.
import { AlertTriangle, CheckCircle2, Clock3, UserRound } from "lucide-react";
import type { ComponentType } from "react";

import { cn } from "@/lib/utils";
import { CLIENT_BUCKET_LABELS, type ClientBucket } from "@/components/portal/status-label";

// The genuine flow: a page is normally being worked on, sometimes waits
// on the CLIENT specifically before it can continue, and eventually
// ships. Every arrow below connects two steps that actually follow one
// another — `blocked` is deliberately excluded from this list; see this
// file's own header for why.
const FLOW_ORDER: ClientBucket[] = ["progress", "waiting", "done"];

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

// F-visual-redesign: a bigger, colour-tinted icon "chip" behind each step's
// glyph — the same "colour + icon, never colour alone" pairing the pill
// dots already used, just given more visual weight so the pipeline reads at
// a glance instead of needing the label text to carry all of it.
const BUCKET_ICON_BG_CLASS: Record<ClientBucket, string> = {
  waiting: "bg-status-waiting-bg",
  progress: "bg-status-progress-bg",
  blocked: "bg-status-blocked-bg",
  done: "bg-status-done-bg",
};

function PipelineStep({
  bucket,
  count,
}: {
  bucket: ClientBucket;
  count: number;
}) {
  const Icon = BUCKET_ICON[bucket];
  const isClientBucket = bucket === CLIENT_BUCKET;

  return (
    <div
      data-testid={`page-pipeline-step-${bucket}`}
      data-highlighted={isClientBucket ? "true" : "false"}
      className={cn(
        "flex min-w-32 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border px-4 py-3.5 text-center transition-colors",
        isClientBucket
          ? "border-status-waiting bg-status-waiting-bg shadow-sm"
          : "border-border bg-muted/40",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          BUCKET_ICON_BG_CLASS[bucket],
        )}
      >
        <Icon aria-hidden={true} className={cn("size-5 shrink-0", BUCKET_TEXT_CLASS[bucket])} />
      </span>
      <span className="text-2xl font-semibold tabular-nums text-foreground" data-testid={`page-pipeline-count-${bucket}`}>
        {count}
      </span>
      <span
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium",
          isClientBucket ? "text-status-waiting" : "text-muted-foreground",
        )}
      >
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", BUCKET_DOT_CLASS[bucket])} />
        {CLIENT_BUCKET_LABELS[bucket]}
      </span>
    </div>
  );
}

export function PagePipeline({
  counts,
}: {
  counts: Record<ClientBucket, number>;
}) {
  const total =
    counts.progress + counts.waiting + counts.blocked + counts.done;

  return (
    <div className="flex flex-col gap-2" data-testid="page-pipeline">
      <h3 className="text-sm font-medium text-foreground">How your pages travel</h3>

      {/* AS-014/AS-017 (this feature's own definition of done): the
          pipeline is the axis AND the count in one picture — no separate
          prose paragraph beneath it. An all-zero pipeline (this
          component's own empty state, since the caller only reaches this
          view once at least one page exists, but must still not divide
          by zero or render a broken bar) states "No pages yet" rather
          than drawing meaningless steps. */}
      {total === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="page-pipeline-empty">
          No pages yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* `overflow-x-auto` + `flex-nowrap`: the FLOW scrolls inside
              its own container rather than wrapping — a wrapped arrow
              chain would either dangle into empty space (the tile-grid
              orphan this same review already flagged once) or need a
              second, fragile "suppress the arrow at a wrap boundary"
              layout, when a three-step, always-one-row strip already
              fits comfortably at any realistic viewport and degrades to
              a scroll, never a sideways page, at the narrowest ones.
              Blocked is deliberately NOT inside this scroller — see this
              file's own round-3 header comment for why. */}
          <div className="overflow-x-auto">
            <ol
              className="flex w-max flex-nowrap items-stretch gap-x-1"
              aria-label="How your pages travel, by count"
            >
              {FLOW_ORDER.map((bucket, index) => (
                <li key={bucket} className="flex shrink-0 items-stretch gap-1">
                  <PipelineStep bucket={bucket} count={counts[bucket]} />
                  {index < FLOW_ORDER.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="flex shrink-0 items-center px-1 text-xl text-muted-foreground/70"
                    >
                      →
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>

          {/* "Blocked" is a state, not a position in the sequence — it
              can strike a page at any step, so it is never connected by
              an arrow (an arrow means "leads to") AND never inside the
              flow's own scroll container (round 3: a thing that isn't
              part of the flow has no reason to scroll with it, or to
              risk sitting off-screen at the flow's default scroll
              position). Its own row, unconditionally visible, set apart
              by a plain top divider rather than an arrow. */}
          <div className="flex items-center gap-3 border-t border-border pt-3">
            <span className="shrink-0 text-xs text-muted-foreground">Stuck at any step</span>
            <div data-testid="page-pipeline-blocked-aside">
              <PipelineStep bucket="blocked" count={counts.blocked} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
