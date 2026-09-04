// F020/F021c (missions/20260903-portal): "did this metric get better or
// worse" is a pure, client-safe judgement — it has no business depending
// on the server-only Supabase client, so it lives in its own module
// rather than lib/queries/metrics.ts. F069: components/project/
// measurement-panel.tsx ("use client") calls this function at runtime; it
// previously imported it from lib/queries/metrics.ts, which also exports
// async functions that import lib/supabase/server.ts (next/headers) —
// pulling the whole server-only chain into the browser bundle. Moving the
// pure function here (and re-exporting it from lib/queries/metrics.ts for
// server-side callers) keeps the import graph honest without changing
// behaviour. lib/queries/metrics.ts's own header comment and F021c's
// commentary on the baselineAt comparison are unchanged — read there for
// the "why" of the derivation itself.

// Type-only import: erased at compile time, so it never pulls
// lib/queries/metrics.ts's runtime (server-only) code into a bundle that
// imports this module.
import type { MetricSnapshot, ProjectMetric } from "@/lib/queries/metrics";

export type MetricMeasurementStatus = "not_measured" | "improved" | "regressed" | "unchanged";

export function deriveMetricMeasurementStatus(
  metric: Pick<ProjectMetric, "baselineValue" | "direction" | "baselineAt">,
  latestSnapshot: MetricSnapshot | null,
): MetricMeasurementStatus {
  if (!latestSnapshot || metric.baselineValue === null) {
    return "not_measured";
  }

  // F021c: a snapshot measured before the baseline was set is not a
  // post-baseline measurement — treat it the same as having none at all.
  // `baselineAt === null` alongside a non-null `baselineValue` shouldn't
  // occur (the baseline value and its timestamp are written together),
  // but if it ever did, there is no baseline date to compare against, so
  // the honest answer is still "not measured" rather than assuming the
  // snapshot qualifies.
  if (metric.baselineAt === null || latestSnapshot.measuredAt < metric.baselineAt) {
    return "not_measured";
  }

  if (latestSnapshot.value === metric.baselineValue) {
    return "unchanged";
  }

  const movedUp = latestSnapshot.value > metric.baselineValue;
  const improvedOnHigher = metric.direction === "higher" && movedUp;
  const improvedOnLower = metric.direction === "lower" && !movedUp;

  return improvedOnHigher || improvedOnLower ? "improved" : "regressed";
}
