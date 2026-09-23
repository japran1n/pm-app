// F015 (missions/20260923-180648, TT-032/TT-033): pure pixel/path layout
// math for the "Total time worked" card's hand-rolled SVG area chart, kept
// separate from the rendering component -- same convention
// components/portal/hours-burndown-chart.tsx (F019) established for its
// own computeBurndownLayout: this is what a unit test asserts against
// (point count, path non-emptiness, no NaN/Infinity for TT-033), not
// rendered pixels. No chart library per TT-063 -- this file is the entire
// "chart library" this feature gets.
export type DailyPoint = {
  /** "YYYY-MM-DD" */
  date: string;
  minutes: number;
};

export type AreaChartLayout = {
  width: number;
  height: number;
  /** Smooth cubic-bezier line path through every point, empty string when
   * there are fewer than 2 points to draw a line through. */
  linePath: string;
  /** `linePath` closed down to the baseline for the gradient fill,
   * mirrors `usedAreaPath` in hours-burndown-chart.tsx's own layout. */
  areaPath: string;
  /** Last point's own pixel position, for the static hover marker + dashed
   * guide line. `null` when there is nothing to plot. */
  lastPoint: { x: number; y: number } | null;
};

const WIDTH = 560;
const HEIGHT = 120;
const LEFT_PAD = 4;
const RIGHT_PAD = 4;
const TOP_PAD = 10;
const BOTTOM_PAD = 10;

/**
 * Builds a smooth (Catmull-Rom-ish, via simple midpoint cubic bezier)
 * area-chart layout from daily totals. Never produces NaN/Infinity: a
 * flat (all-zero or single-value) series still gets a valid, flat line
 * rather than dividing by a zero range.
 */
export function computeAreaChartLayout(points: DailyPoint[]): AreaChartLayout {
  if (points.length === 0) {
    return { width: WIDTH, height: HEIGHT, linePath: "", areaPath: "", lastPoint: null };
  }

  const maxMinutes = Math.max(...points.map((p) => p.minutes), 1);
  const plottableWidth = WIDTH - LEFT_PAD - RIGHT_PAD;
  const plottableHeight = HEIGHT - TOP_PAD - BOTTOM_PAD;
  const baselineY = HEIGHT - BOTTOM_PAD;

  const xFor = (index: number) =>
    points.length === 1
      ? LEFT_PAD + plottableWidth / 2
      : LEFT_PAD + (index / (points.length - 1)) * plottableWidth;
  const yFor = (minutes: number) => TOP_PAD + plottableHeight - (minutes / maxMinutes) * plottableHeight;

  const coords = points.map((p, i) => ({ x: xFor(i), y: yFor(p.minutes) }));

  let linePath = `M${coords[0]!.x},${coords[0]!.y}`;
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1]!;
    const curr = coords[i]!;
    const midX = (prev.x + curr.x) / 2;
    // Smooth cubic bezier through the midpoint between consecutive
    // points -- same "no external library" approach as the mockup's own
    // SVG, no data-heavy Catmull-Rom matrix needed for a daily series.
    linePath += ` C${midX},${prev.y} ${midX},${curr.y} ${curr.x},${curr.y}`;
  }

  const areaPath =
    coords.length > 0
      ? `${linePath} L${coords[coords.length - 1]!.x},${baselineY} L${coords[0]!.x},${baselineY} Z`
      : "";

  const last = coords[coords.length - 1] ?? null;

  return {
    width: WIDTH,
    height: HEIGHT,
    linePath: coords.length >= 2 ? linePath : "",
    areaPath: coords.length >= 2 ? areaPath : "",
    lastPoint: last,
  };
}

/** % delta vs a previous-period total, `null` when there is no previous
 * data to compare against (TT-032's badge is omitted, not "0%", in that
 * case -- see this feature's clarification). Never returns NaN/Infinity. */
export function computePercentDelta(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
