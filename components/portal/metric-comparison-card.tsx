// F021 (missions/20260903-portal, AS-041, AS-042); reworked by F105
// (missions/20260903-portal, docs/client-portal-visual-plan.md §3.1) into a
// bullet chart. Same "pure layout function kept separate from rendering"
// convention hours-burndown-chart.tsx (F019) and phase-timeline.tsx (F006)
// both already establish, for the same reason: this feature's own primary-
// success unit test needs to assert the improved/regressed decision and the
// bar geometry independent of rendered pixels.
//
// Bullet chart form (dataviz skill's own procedure: form -> colour -> palette
// -> marks -> hover -> accessibility -> look; the skill file itself does not
// exist in this repo -- see the F105 handoff's Blockers/Notes for the same
// gap F104 already reported). One row per metric, one scale per metric
// (`computeMetricBarLayout`'s own scaleMax is never shared across metrics,
// per the plan's explicit "never a shared axis" instruction): a light full-
// height range behind the row is the baseline, a thinner bar in front is
// "Now", and a tick spanning the row is the target. This is Few's bullet
// graph shape, matched to what the plan literally asks for in §3.1.
//
// Status colour (AS-041's own honesty requirement): `deriveMetricMeasurementStatus`
// (lib/queries/metrics.ts, F020) is the ONE place "did this metric get
// better or worse" is decided -- this component never re-derives that
// judgement from `direction`/values itself, it only renders whatever that
// function already returned. "improved" -> the done token, "regressed" ->
// the blocked token (never hidden, never softened), "unchanged"/
// "not_measured" -> muted.
//
// Direction honesty (the brief's own "must not look like progress" case):
// bar LENGTH always encodes the metric's raw magnitude on its own scale, so
// for a `direction: 'lower'` metric (e.g. bounce rate) a worse "Now" can
// still draw a bar that runs past the target tick -- geometrically identical
// to what "beating the target" looks like on a `higher` metric. Colour alone
// is not trusted to disambiguate that (this file's own "no colour-only"
// rule, matching phase-timeline.tsx's own documented rule for itself): every
// row also prints (a) a status icon (TrendingUp/TrendingDown/Minus) next to
// the status text, and (b) an explicit "Lower is better"/"Higher is better"
// caption under the metric name, so a client who has never been told which
// metrics are lower-better still reads the row correctly from text alone,
// with colour and geometry only as reinforcement. This is a deliberate
// choice, not inferred from any existing precedent in this codebase.
import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import type { MetricMeasurementStatus, MetricSnapshot, ProjectMetric } from "@/lib/queries/metrics";

const CHART_WIDTH_PX = 260;
const ROW_HEIGHT_PX = 24;
const BAR_HEIGHT_PX = 12;
const BAR_Y_PX = (ROW_HEIGHT_PX - BAR_HEIGHT_PX) / 2;
const CHART_HEIGHT_PX = ROW_HEIGHT_PX;

export type MetricBarLayout = {
  chartWidthPx: number;
  chartHeightPx: number;
  scaleMax: number;
  beforeWidthPx: number;
  nowWidthPx: number;
  targetXPx: number | null;
  beforeYPx: number;
  nowYPx: number;
};

/** Pure pixel layout for the bullet chart: the baseline range (full row
 * height, drawn behind), the "Now" bar (thinner, drawn in front), and the
 * target tick. Only meaningful when a snapshot exists -- callers with
 * `not_measured` status never call this at all (there is no "Now" bar to
 * lay out). Exported for this feature's own primary-success unit test. */
export function computeMetricBarLayout(
  baselineValue: number,
  nowValue: number,
  targetValue: number | null,
  displayMax: number | null,
): MetricBarLayout {
  const candidateMax = Math.max(baselineValue, nowValue, targetValue ?? 0, 0);
  const scaleMax = displayMax ?? (candidateMax > 0 ? candidateMax * 1.15 : 1);

  function widthFor(value: number): number {
    const clamped = Math.min(Math.max(value, 0), scaleMax);
    return scaleMax > 0 ? (clamped / scaleMax) * CHART_WIDTH_PX : 0;
  }

  return {
    chartWidthPx: CHART_WIDTH_PX,
    chartHeightPx: CHART_HEIGHT_PX,
    scaleMax,
    beforeWidthPx: widthFor(baselineValue),
    nowWidthPx: widthFor(nowValue),
    targetXPx: targetValue === null ? null : widthFor(targetValue),
    beforeYPx: 0,
    nowYPx: BAR_Y_PX,
  };
}

function formatValue(value: number, unit: string | null): string {
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return unit ? `${rounded}${unit}` : rounded;
}

// F079 (missions/20260903-portal audit, defect 3): `baseline_at` /
// `measured_at` are genuine `date` columns
// (20261013010000_f020_metrics_snapshots_improvements_baseline_freeze
// .sql). The synthetic `T00:00:00Z` was already appended so the Date
// parses as UTC midnight rather than the browser's local midnight, but
// `toLocaleDateString` was never told to RENDER in UTC either — without
// `timeZone: "UTC"` here it still formats that same instant in the
// browser's own timezone, which is exactly this defect's bug for a
// caller west of UTC. Matches deliverable-row.tsx's own `formatDate`,
// which pairs the same synthetic timestamp with the same `timeZone`
// option.
function formatDate(dateIso: string): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const STATUS_LABEL: Record<MetricMeasurementStatus, string> = {
  improved: "Improved",
  regressed: "Regressed",
  unchanged: "Unchanged",
  not_measured: "Not yet measured",
};

const STATUS_TEXT_CLASS: Record<MetricMeasurementStatus, string> = {
  improved: "text-status-done",
  regressed: "text-status-blocked",
  unchanged: "text-muted-foreground",
  not_measured: "text-muted-foreground",
};

const STATUS_BAR_FILL_CLASS: Record<MetricMeasurementStatus, string> = {
  improved: "fill-status-done",
  regressed: "fill-status-blocked",
  unchanged: "fill-muted-foreground",
  not_measured: "fill-muted-foreground",
};

// No-colour-only rule: an icon accompanies the status text on every
// measured row, so the improved/regressed distinction survives greyscale
// printing or colour-blindness, not just the (still-present) colour and
// text. "unchanged" gets a neutral dash rather than either trend arrow.
const STATUS_ICON: Record<MetricMeasurementStatus, typeof TrendingUp | null> = {
  improved: TrendingUp,
  regressed: TrendingDown,
  unchanged: Minus,
  not_measured: null,
};

const DIRECTION_CAPTION: Record<ProjectMetric["direction"], string> = {
  higher: "Higher is better",
  lower: "Lower is better",
};

export function MetricComparisonCard({
  metric,
  latestSnapshot,
  status,
}: {
  metric: ProjectMetric;
  latestSnapshot: MetricSnapshot | null;
  status: MetricMeasurementStatus;
}) {
  const hasMeasurement = status !== "not_measured" && latestSnapshot !== null && metric.baselineValue !== null;
  const StatusIcon = STATUS_ICON[status];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-5" data-testid="metric-comparison-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-mini font-semibold text-foreground">{metric.name}</h3>
          <span className="text-[11px] text-muted-foreground" data-testid="metric-direction-caption">
            {DIRECTION_CAPTION[metric.direction]}
          </span>
        </div>
        <span
          className={`flex items-center gap-1 text-micro font-medium ${STATUS_TEXT_CLASS[status]}`}
          data-testid="metric-status-label"
        >
          {StatusIcon && <StatusIcon aria-hidden="true" className="h-3.5 w-3.5" />}
          {STATUS_LABEL[status]}
        </span>
      </div>

      {!hasMeasurement ? (
        <NotMeasuredBars metric={metric} />
      ) : (
        <MeasuredBullet metric={metric} snapshot={latestSnapshot!} status={status} />
      )}
    </div>
  );
}

function NotMeasuredBars({ metric }: { metric: ProjectMetric }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 text-micro">
        <span className="w-14 shrink-0 text-muted-foreground">Before</span>
        {metric.baselineValue === null ? (
          <span className="text-muted-foreground">No baseline recorded yet.</span>
        ) : (
          <span className="font-medium text-foreground">
            {formatValue(metric.baselineValue, metric.unit)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-micro">
        <span className="w-14 shrink-0 text-muted-foreground">Now</span>
        <span className="text-muted-foreground" data-testid="metric-not-measured">
          Not measured yet — the team will record the next measurement using the same
          method used for the baseline above.
        </span>
      </div>
    </div>
  );
}

// The bullet chart itself: one row per metric, drawn as
//   1. a light full-height range behind (the baseline), and
//   2. a thinner, status-coloured bar in front (the current value), and
//   3. a tick spanning the row (the target).
// Direct labels sit only on the values that matter -- the current value and
// the target -- never on every mark (the baseline range carries no printed
// number on the chart itself; its value is stated once, in the text row
// below, matching the existing "Before/Now/Target" convention this
// component already used).
function MeasuredBullet({
  metric,
  snapshot,
  status,
}: {
  metric: ProjectMetric;
  snapshot: MetricSnapshot;
  status: MetricMeasurementStatus;
}) {
  const layout = computeMetricBarLayout(
    metric.baselineValue!,
    snapshot.value,
    metric.targetValue,
    metric.displayMax,
  );

  const summary = `${metric.name} (${DIRECTION_CAPTION[metric.direction].toLowerCase()}): before ${formatValue(
    metric.baselineValue!,
    metric.unit,
  )}, now ${formatValue(snapshot.value, metric.unit)}${
    metric.targetValue !== null ? `, target ${formatValue(metric.targetValue, metric.unit)}` : ""
  } — ${STATUS_LABEL[status].toLowerCase()}.`;

  return (
    <div className="flex flex-col gap-2">
      <div role="img" aria-label={summary} data-testid="metric-bar-chart" className="overflow-x-auto">
        <svg width={layout.chartWidthPx} height={layout.chartHeightPx} role="presentation" className="block">
          {/* Baseline range: recessive, no direct label on the mark itself. */}
          <rect
            x={0}
            y={layout.beforeYPx}
            width={layout.beforeWidthPx}
            height={layout.chartHeightPx}
            rx={2}
            className="fill-muted-foreground/25"
          >
            <title>{`Before: ${formatValue(metric.baselineValue!, metric.unit)}`}</title>
          </rect>
          {/* Current value: the one mark that gets a direct numeric label,
              printed in the text row below rather than on the SVG itself so
              it never collides with the target tick. */}
          <rect
            x={0}
            y={layout.nowYPx}
            width={layout.nowWidthPx}
            height={BAR_HEIGHT_PX}
            rx={2}
            className={STATUS_BAR_FILL_CLASS[status]}
          >
            <title>{`Now: ${formatValue(snapshot.value, metric.unit)}`}</title>
          </rect>
          {layout.targetXPx !== null && (
            <line
              x1={layout.targetXPx}
              x2={layout.targetXPx}
              y1={0}
              y2={layout.chartHeightPx}
              className="stroke-foreground/60"
              strokeWidth={2}
              data-testid="metric-target-tick"
            >
              <title>{`Target: ${formatValue(metric.targetValue!, metric.unit)}`}</title>
            </line>
          )}
        </svg>
      </div>

      <div className="flex flex-col gap-1 text-micro">
        <div className="flex items-center gap-3">
          <span className="w-14 shrink-0 text-muted-foreground">Before</span>
          <span className="font-medium text-foreground">{formatValue(metric.baselineValue!, metric.unit)}</span>
          {metric.baselineAt && (
            <span className="text-muted-foreground">as of {formatDate(metric.baselineAt)}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="w-14 shrink-0 text-muted-foreground">Now</span>
          <span className={`font-medium ${STATUS_TEXT_CLASS[status]}`}>
            {formatValue(snapshot.value, metric.unit)}
          </span>
          <span className="text-muted-foreground">as of {formatDate(snapshot.measuredAt)}</span>
        </div>
        {metric.targetValue !== null && (
          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-muted-foreground">Target</span>
            <span className="text-muted-foreground">{formatValue(metric.targetValue, metric.unit)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
