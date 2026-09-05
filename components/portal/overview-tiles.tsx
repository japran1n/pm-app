// F006 (missions/20260903-portal): the overview's four tiles -- Waiting
// on you, Pages ready, Hours used, Days to launch -- as "identical
// objects (same padding, same baseline, same foot line)" (this
// feature's own clarified spec), so they read as one family at a glance
// rather than four one-off cards. `Tile` is the single shared primitive
// every one of the four renders through.
//
// F085 (missions/20260903-portal audit, defect 1): Hours used shipped as
// a permanent, hard-coded "Available with the next release" placeholder
// -- correct when F006 landed (F019, the Hours view, did not exist yet),
// stale and actively contradicted the moment F019 shipped a fully
// working Hours view one click away in the sidebar. This tile is now
// wired to that same real read (`usedMinutes`/`soldMinutes`, computed by
// the Overview page from `getProjectHoursClient` -- the identical query
// F019's own Hours page uses, never a second, independently-fetched
// number). `usedMinutes: null` still renders an honest "-" for a project
// with no hours budget/logged time at all, the same "never a fabricated
// figure" convention every other tile here already follows.
//
// F085 (defect 2): "Waiting on you" used to be a link -- the tile
// answered "what's waiting on me?" with a number a client could read but
// never click through on.
//
// F107 (missions/20260903-portal, docs/client-portal-visual-plan.md 2.3):
// "a number with its trend behind it answers 'and is that good?' without
// a click." Two of the three tiles now carry that trend, from data that
// ALREADY exists elsewhere on the page -- neither is a new query:
//   - Hours used: `usedMinutesSeries`, the same cumulative-minutes series
//     `computeBurndownSeries` (hours-burndown-chart.tsx) already computes
//     for the Hours view's own burn-down chart.
//   - Pages ready: `pagesStatusDistribution`, the same four-bucket counts
//     `resolveClientBucket` (status-label.ts) already assigns each page
//     on this same page (`pagesReadyCount`/`pagesTotalCount` above are
//     themselves derived from it).
// "Days to launch" stays bare: no history of `target_launch_date` changes
// exists anywhere in this schema (grepped every migration under
// supabase/migrations for a `target_launch_date`-adjacent audit/history
// table and found none) -- Part 4 of the same plan names this same gap
// for `launch_confidence` and asks that the decision be explicit rather
// than incidental; the same applies here, so no slip indicator is drawn
// rather than faking one from a shape the data doesn't have.
//
// F107 round 2 (docs/client-portal-visual-plan.md, coordinator review):
// the "Waiting on you" TILE is removed entirely -- `WaitingOnYouBlock`
// (rendered above this strip on the Overview page) already names every
// one of the same items with its own age and inline action; the tile
// restated only the bare count of the exact same rows twelve rows below
// it. The coordinator's own instruction was explicit that the block is
// "strictly more informative" and the tile, not the block, should go.
//
// F107 round 4 (coordinator review): three tiles in a grid that stepped
// through a two-column tier orphaned the third -- fixed below in the
// grid className, not by adding a tile to fill the hole. A fourth tile
// was considered against the coordinator's own bar ("does it answer
// something a client currently cannot see on this PAGE, not whether it
// fills a hole") and rejected for every candidate found:
//   - "Billable vs. total hours" is already the Hours-used tile's own
//     number + footnote (`usedMinutes` of `soldMinutes` budgeted) --
//     restating it a second time is the exact redundancy this feature's
//     earlier rounds removed elsewhere on this same page.
//   - "Next dated milestone" is already visible on this same page, in
//     the phase timeline directly below this tile strip (every phase's
//     own date range) -- a tile repeating one phase's date is a smaller,
//     less informative copy of a chart already on screen, not new
//     information.
// Nothing else read anywhere in this codebase's portal queries answers a
// question this page doesn't already answer elsewhere on itself. Three
// columns, not four tiles, is the honest answer here.
import Link from "next/link";
import type { ReactNode } from "react";

import type { PortalLaunchConfidence } from "@/lib/queries/portal";
import type { ClientBucket } from "@/components/portal/status-label";

const LAUNCH_CONFIDENCE_LABEL: Record<PortalLaunchConfidence, string> = {
  on_track: "On track",
  at_risk: "At risk",
  slipped: "Slipped",
};

const BUCKET_ORDER: ClientBucket[] = ["done", "progress", "waiting", "blocked"];

// Same status tokens `status-pill.tsx` already renders these buckets
// with -- never a new hue, per this feature's own chart-rules
// instruction not to touch the validated palette.
const BUCKET_BAR_CLASS: Record<ClientBucket, string> = {
  done: "bg-status-done",
  progress: "bg-status-progress",
  waiting: "bg-status-waiting",
  blocked: "bg-status-blocked",
};

const BUCKET_LABEL: Record<ClientBucket, string> = {
  done: "done",
  progress: "in progress",
  waiting: "waiting on you",
  blocked: "blocked",
};

/** A tiny single-scale sparkline -- thin line, no axis, no grid, direct
 * label only on the endpoint. Fewer than three points renders nothing
 * (this feature's own "a sparkline is not decoration" rule): the caller
 * falls back to the number alone. */
function Sparkline({ values }: { values: number[] }) {
  // Guard: `values` has come back undefined at least once from a caller
  // mid-refactor -- never a shape this reads without checking first.
  if (!values || values.length < 3) return null;

  const width = 64;
  const height = 20;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const step = width / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  });

  return (
    <svg
      width={width}
      height={height}
      role="presentation"
      aria-hidden="true"
      data-testid="tile-sparkline"
      className="shrink-0"
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        className="stroke-brand"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A tiny single-scale stacked bar of the four client-facing status
 * buckets, with a text caption underneath carrying the same counts --
 * the caption, not the colour, is what makes the distribution readable
 * in greyscale (chart-rules: no colour-only encoding). */
function StatusDistributionBar({
  distribution,
}: {
  distribution: Record<ClientBucket, number>;
}) {
  // Guard: an undefined/partial `distribution` must render nothing, not
  // throw on an unguarded property read -- same convention as
  // `Sparkline`'s own guard above.
  if (!distribution) return null;
  const total = BUCKET_ORDER.reduce((sum, bucket) => sum + (distribution[bucket] ?? 0), 0);
  if (total === 0) return null;

  const nonZero = BUCKET_ORDER.filter((bucket) => (distribution[bucket] ?? 0) > 0);

  return (
    <div className="flex flex-col gap-1" data-testid="tile-pages-distribution">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {BUCKET_ORDER.map((bucket) =>
          (distribution[bucket] ?? 0) > 0 ? (
            <span
              key={bucket}
              className={BUCKET_BAR_CLASS[bucket]}
              style={{ width: `${((distribution[bucket] ?? 0) / total) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <span className="text-xs text-muted-foreground">
        {nonZero.map((bucket) => `${distribution[bucket]} ${BUCKET_LABEL[bucket]}`).join(" · ")}
      </span>
    </div>
  );
}

function Tile({
  label,
  value,
  footnote,
  testId,
  href,
  chart,
  belowFootnote,
}: {
  label: string;
  value: string;
  footnote: string;
  testId: string;
  /** Present only for a tile that has somewhere useful to send a client
   * -- absent tiles render as a plain, non-interactive card. */
  href?: string;
  /** F107: a compact sparkline drawn beside the value -- absent for a
   * tile with no history to show (this feature's own "say so rather than
   * faking a shape" rule). */
  chart?: ReactNode;
  /** F107: a wider chart (the pages status distribution bar) that needs
   * its own row rather than squeezing beside the value. */
  belowFootnote?: ReactNode;
}) {
  const body = (
    <>
      <span className="text-tag text-muted-foreground">{label}</span>
      <div className="flex items-end justify-between gap-2">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </span>
        {chart}
      </div>
      <span className="text-xs text-muted-foreground">{footnote}</span>
      {belowFootnote}
    </>
  );

  if (href) {
    return (
      <Link
        data-testid={testId}
        href={href}
        className="hover-surface flex flex-col gap-2 rounded-lg border border-border p-5"
      >
        {body}
      </Link>
    );
  }

  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-2 rounded-lg border border-border p-5"
    >
      {body}
    </div>
  );
}

// F115 round 2 (coordinator review): a launched project (`daysToLaunch`
// negative) used to keep the "Days to launch" label and read "Passed ·
// On track" -- a live site's own tile describing itself as still
// approaching a launch that has already happened, directly under a
// headline this same change fixed for the identical reason. Once the
// date has passed there is nothing left to "track" toward, so the
// confidence label (which answers "will we hit the date?") is dropped
// too rather than kept and made to look like it still means something.
function daysToLaunchFootnote(
  daysToLaunch: number | null,
  launchConfidence: PortalLaunchConfidence | null,
): string {
  if (daysToLaunch === null) return "Launch date not set yet";
  if (daysToLaunch < 0) return "Launched";
  if (launchConfidence) return LAUNCH_CONFIDENCE_LABEL[launchConfidence];
  return "Confidence not set yet";
}

function minutesToHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

export function OverviewTiles({
  pagesReadyCount,
  pagesTotalCount,
  pagesStatusDistribution,
  usedMinutes,
  usedMinutesSeries,
  soldMinutes,
  hoursHref,
  daysToLaunch,
  launchConfidence,
}: {
  pagesReadyCount: number;
  pagesTotalCount: number;
  /** F107: counts per client-facing status bucket (`resolveClientBucket`
   * output), the same classification `pagesReadyCount` above is derived
   * from -- drawn as a small stacked bar under the tile's own number. */
  pagesStatusDistribution: Record<ClientBucket, number>;
  /** F085 (defect 1): billable minutes used against the current budget
   * period, the same read F019's Hours view uses. `null` when there is
   * no budget and nothing logged yet -- rendered as an honest "-", never
   * 0h standing in for "no data". */
  usedMinutes: number | null;
  /** F107: cumulative billable minutes per week, the same series
   * `computeBurndownSeries` builds for the Hours view's burn-down chart
   * -- rendered as a sparkline behind the tile's own number. Fewer than
   * three points renders no sparkline (this feature's own rule). */
  usedMinutesSeries: number[];
  /** `null` when no budget has been set for the current period. */
  soldMinutes: number | null;
  hoursHref: string;
  /** Whole days from today to the project's target launch date, negative
   * once the date has passed. `null` when no target launch date has
   * been set yet -- rendered as an honest "-", never a default. */
  daysToLaunch: number | null;
  launchConfidence: PortalLaunchConfidence | null;
}) {
  return (
    <div
      data-testid="overview-tiles"
      // F107 round 4 (coordinator review): `sm:grid-cols-2 lg:grid-cols-3`
      // put three tiles into a two-column tier between `sm` and `lg` --
      // `Days to launch` orphaned alone on its own row with an empty
      // half beside it, reading as a missing fourth card rather than a
      // deliberate three. Going straight from one column (mobile) to
      // three (from `sm` up, no two-column tier at all) is the one grid
      // shape three tiles can occupy with no orphan at any width; a
      // fourth tile was considered and rejected -- see this file's own
      // header comment for why nothing on this page currently qualifies
      // as new information rather than a restated one.
      className="grid grid-cols-1 gap-4 sm:grid-cols-3"
    >
      <Tile
        testId="tile-pages-ready"
        label="Pages ready"
        value={pagesTotalCount === 0 ? "—" : `${pagesReadyCount} / ${pagesTotalCount}`}
        footnote={pagesTotalCount === 0 ? "No pages shared yet" : "Ready to launch"}
        belowFootnote={
          pagesTotalCount > 0 ? (
            <StatusDistributionBar distribution={pagesStatusDistribution} />
          ) : undefined
        }
      />
      <Tile
        testId="tile-hours-used"
        label="Hours used"
        href={hoursHref}
        value={usedMinutes === null ? "—" : minutesToHours(usedMinutes)}
        footnote={
          usedMinutes === null
            ? "No billable hours yet"
            : soldMinutes === null
              ? "No budget set yet"
              : `Of ${minutesToHours(soldMinutes)} budgeted`
        }
        chart={<Sparkline values={usedMinutesSeries} />}
      />
      <Tile
        testId="tile-days-to-launch"
        label={daysToLaunch !== null && daysToLaunch < 0 ? "Days since launch" : "Days to launch"}
        value={daysToLaunch === null ? "—" : String(Math.abs(daysToLaunch))}
        footnote={daysToLaunchFootnote(daysToLaunch, launchConfidence)}
      />
    </div>
  );
}
