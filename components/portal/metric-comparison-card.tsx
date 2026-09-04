// F021 (missions/20260903-portal, AS-041, AS-042): one paired-bar card per
// client-visible metric. Same "pure layout function kept separate from
// rendering" convention hours-burndown-chart.tsx (F019) and
// phase-timeline.tsx (F006) both already establish, for the same reason:
// this feature's own primary-success unit test needs to assert the
// improved/regressed decision and the bar geometry independent of
// rendered pixels.
//
// Status colour (AS-041's own honesty requirement): `deriveMetricMeasurementStatus`
// (lib/queries/metrics.ts, F020) is the ONE place "did this metric get
// better or worse" is decided -- this component never re-derives that
// judgement from `direction`/values itself, it only renders whatever that
// function already returned. "improved" -> the done token, "regressed" ->
// the blocked token (never hidden, never softened), "unchanged"/
// "not_measured" -> muted. Colour is never the only signal: every card
// also states the status in text (the row's own value label), matching
// plan.md's Design constraint #4 the same way phase-timeline.tsx's own
// header documents for itself.
import type { MetricMeasurementStatus, MetricSnapshot, ProjectMetric } from "@/lib/queries/metrics";

const BAR_WIDTH_PX = 260;
const BAR_HEIGHT_PX = 16;
const BAR_GAP_PX = 10;
const CHART_TOP_PAD_PX = 4;
const CHART_BOTTOM_PAD_PX = 4;
const CHART_HEIGHT_PX = BAR_HEIGHT_PX * 2 + BAR_GAP_PX + CHART_TOP_PAD_PX + CHART_BOTTOM_PAD_PX;

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

/** Pure pixel layout for the paired Before/Now bars plus the target tick.
 * Only meaningful when a snapshot exists -- callers with `not_measured`
 * status never call this at all (there is no "Now" bar to lay out).
 * Exported for this feature's own primary-success unit test. */
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
    return scaleMax > 0 ? (clamped / scaleMax) * BAR_WIDTH_PX : 0;
  }

  return {
    chartWidthPx: BAR_WIDTH_PX,
    chartHeightPx: CHART_HEIGHT_PX,
    scaleMax,
    beforeWidthPx: widthFor(baselineValue),
    nowWidthPx: widthFor(nowValue),
    targetXPx: targetValue === null ? null : widthFor(targetValue),
    beforeYPx: CHART_TOP_PAD_PX,
    nowYPx: CHART_TOP_PAD_PX + BAR_HEIGHT_PX + BAR_GAP_PX,
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

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-5" data-testid="metric-comparison-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{metric.name}</h3>
        <span
          className={`text-xs font-medium ${STATUS_TEXT_CLASS[status]}`}
          data-testid="metric-status-label"
        >
          {STATUS_LABEL[status]}
        </span>
      </div>

      {!hasMeasurement ? (
        <NotMeasuredBars metric={metric} />
      ) : (
        <MeasuredBars metric={metric} snapshot={latestSnapshot!} status={status} />
      )}
    </div>
  );
}

function NotMeasuredBars({ metric }: { metric: ProjectMetric }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 text-xs">
        <span className="w-14 shrink-0 text-muted-foreground">Before</span>
        {metric.baselineValue === null ? (
          <span className="text-muted-foreground">No baseline recorded yet.</span>
        ) : (
          <span className="font-medium text-foreground">
            {formatValue(metric.baselineValue, metric.unit)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs">
        <span className="w-14 shrink-0 text-muted-foreground">Now</span>
        <span className="text-muted-foreground" data-testid="metric-not-measured">
          Not measured yet — the team will record the next measurement using the same
          method used for the baseline above.
        </span>
      </div>
    </div>
  );
}

function MeasuredBars({
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

  const summary = `${metric.name}: before ${formatValue(metric.baselineValue!, metric.unit)}, now ${formatValue(
    snapshot.value,
    metric.unit,
  )}${metric.targetValue !== null ? `, target ${formatValue(metric.targetValue, metric.unit)}` : ""} — ${STATUS_LABEL[status].toLowerCase()}.`;

  return (
    <div className="flex flex-col gap-2">
      <div role="img" aria-label={summary} data-testid="metric-bar-chart" className="overflow-x-auto">
        <svg width={layout.chartWidthPx} height={layout.chartHeightPx} role="presentation" className="block">
          <rect
            x={0}
            y={layout.beforeYPx}
            width={layout.beforeWidthPx}
            height={BAR_HEIGHT_PX}
            rx={2}
            className="fill-muted-foreground/40"
          />
          <rect
            x={0}
            y={layout.nowYPx}
            width={layout.nowWidthPx}
            height={BAR_HEIGHT_PX}
            rx={2}
            className={STATUS_BAR_FILL_CLASS[status]}
          />
          {layout.targetXPx !== null && (
            <line
              x1={layout.targetXPx}
              x2={layout.targetXPx}
              y1={0}
              y2={layout.chartHeightPx}
              className="stroke-foreground/50"
              strokeWidth={1}
              strokeDasharray="3 2"
              data-testid="metric-target-tick"
            />
          )}
        </svg>
      </div>

      <div className="flex flex-col gap-1 text-xs">
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
