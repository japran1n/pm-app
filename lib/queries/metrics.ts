// F020 (missions/20260903-portal, M4 — Hours and results): read-side for
// `project_metrics` / `metric_snapshots` / `project_improvements`
// (AS-039, AS-040, AS-041). Same posture as `lib/queries/deliverables.ts`
// (see that file's header comment): the ordinary RLS-respecting server
// client, never the admin client — the two-tier RLS on all three tables
// (20261013010000) already decides which rows a given caller gets back.

import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import type { PortalQueryResult } from "@/lib/queries/portal";

export type MetricSource = "gsc" | "ga4" | "lighthouse" | "crux" | "manual" | "other";
export type MetricDirection = "higher" | "lower";

export type ProjectMetric = {
  id: string;
  projectId: string;
  name: string;
  unit: string | null;
  source: MetricSource;
  baselineValue: number | null;
  baselineAt: string | null;
  targetValue: number | null;
  direction: MetricDirection;
  displayMax: number | null;
  clientVisible: boolean;
  position: number;
};

export type MetricSnapshot = {
  id: string;
  metricId: string;
  value: number;
  measuredAt: string;
  note: string | null;
  createdBy: string;
  createdAt: string;
};

export type ProjectImprovement = {
  id: string;
  projectId: string;
  area: string;
  explanation: string;
  beforePath: string | null;
  afterPath: string | null;
  position: number;
  clientVisible: boolean;
};

const METRIC_COLUMNS =
  "id, project_id, name, unit, source, baseline_value, baseline_at, target_value, direction, display_max, client_visible, position";

const SNAPSHOT_COLUMNS = "id, metric_id, value, measured_at, note, created_by, created_at";

const IMPROVEMENT_COLUMNS =
  "id, project_id, area, explanation, before_path, after_path, position, client_visible";

function mapMetric(row: {
  id: string;
  project_id: string;
  name: string;
  unit: string | null;
  source: string;
  baseline_value: number | string | null;
  baseline_at: string | null;
  target_value: number | string | null;
  direction: string;
  display_max: number | string | null;
  client_visible: boolean;
  position: number;
}): ProjectMetric {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    unit: row.unit,
    source: row.source as MetricSource,
    baselineValue: row.baseline_value === null ? null : Number(row.baseline_value),
    baselineAt: row.baseline_at,
    targetValue: row.target_value === null ? null : Number(row.target_value),
    direction: row.direction as MetricDirection,
    displayMax: row.display_max === null ? null : Number(row.display_max),
    clientVisible: row.client_visible,
    position: row.position,
  };
}

function mapSnapshot(row: {
  id: string;
  metric_id: string;
  value: number | string;
  measured_at: string;
  note: string | null;
  created_by: string;
  created_at: string;
}): MetricSnapshot {
  return {
    id: row.id,
    metricId: row.metric_id,
    value: Number(row.value),
    measuredAt: row.measured_at,
    note: row.note,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapImprovement(row: {
  id: string;
  project_id: string;
  area: string;
  explanation: string;
  before_path: string | null;
  after_path: string | null;
  position: number;
  client_visible: boolean;
}): ProjectImprovement {
  return {
    id: row.id,
    projectId: row.project_id,
    area: row.area,
    explanation: row.explanation,
    beforePath: row.before_path,
    afterPath: row.after_path,
    position: row.position,
    clientVisible: row.client_visible,
  };
}

// AS-039: every metric on this project, in display order. RLS decides
// which rows a given caller gets back — a client only ever sees
// client_visible=true metrics of a portal-enabled project it belongs to.
export async function getProjectMetrics(
  projectId: string,
): Promise<PortalQueryResult<ProjectMetric[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_metrics")
    .select(METRIC_COLUMNS)
    .eq("project_id", projectId)
    .order("position");

  if (error) {
    logger.error("getProjectMetrics: failed to load metrics", { error });
    return { ok: false, error: error.message };
  }

  return { ok: true, data: (data ?? []).map(mapMetric) };
}

// Every snapshot for the given metric ids, newest first — the caller (team
// settings panel or F021's Results view) already scoped `metricIds` to
// metrics it is authorized to see; RLS re-checks visibility per snapshot
// row regardless (a metric id supplied out of scope simply returns no
// rows for it, per metric_snapshots' own join-based RLS).
export async function getMetricSnapshots(
  metricIds: string[],
): Promise<PortalQueryResult<MetricSnapshot[]>> {
  if (metricIds.length === 0) {
    return { ok: true, data: [] };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("metric_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .in("metric_id", metricIds)
    .order("measured_at", { ascending: false });

  if (error) {
    logger.error("getMetricSnapshots: failed to load snapshots", { error });
    return { ok: false, error: error.message };
  }

  return { ok: true, data: (data ?? []).map(mapSnapshot) };
}

// AS-039/AS-040/AS-041 combined read: every metric plus its most recent
// snapshot (or `null` when none exists yet — the shape AS-041 depends on).
export type MetricWithLatestSnapshot = ProjectMetric & {
  latestSnapshot: MetricSnapshot | null;
};

export async function getProjectMetricsWithLatestSnapshot(
  projectId: string,
): Promise<PortalQueryResult<MetricWithLatestSnapshot[]>> {
  const metricsResult = await getProjectMetrics(projectId);
  if (!metricsResult.ok) return metricsResult;

  const metricIds = metricsResult.data.map((metric) => metric.id);
  const snapshotsResult = await getMetricSnapshots(metricIds);
  if (!snapshotsResult.ok) return snapshotsResult;

  const latestByMetricId = new Map<string, MetricSnapshot>();
  // snapshotsResult.data is already ordered newest-first, so the first
  // occurrence per metric id is the latest one.
  for (const snapshot of snapshotsResult.data) {
    if (!latestByMetricId.has(snapshot.metricId)) {
      latestByMetricId.set(snapshot.metricId, snapshot);
    }
  }

  return {
    ok: true,
    data: metricsResult.data.map((metric) => ({
      ...metric,
      latestSnapshot: latestByMetricId.get(metric.id) ?? null,
    })),
  };
}

// AS-041: a metric with no post-baseline snapshot is "not yet measured",
// never "improved"/"regressed" — this is the ONE place that decision is
// made, so F021's Results view (also assigned AS-041) reads this instead
// of re-deriving its own status from `latestSnapshot`/`direction`.
//
// F021c: "no post-baseline snapshot" means exactly that — a snapshot
// whose `measuredAt` is before the metric's own `baselineAt` is not a
// measurement of the work at all, it predates it. Without this
// comparison a metric baselined 2026-03-01 with a single snapshot from
// 2026-01-15 rendered "Improved", in green, from data taken before the
// baseline existed (M4 gate finding). `baselineAt` therefore has to be
// part of this function's own parameter type, not just `baselineValue`/
// `direction` — a caller that omits it cannot express the case this
// function exists to catch.
//
// `direction` (AS-039's own weight): for 'lower' metrics (e.g. LCP), a
// smaller latest value than baseline is an improvement; for 'higher'
// metrics (e.g. sessions), a larger one is. Getting this backwards is
// exactly the failure mode this feature's spec warns about.
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

// AS-039: every improvement on this project, in display order.
export async function getProjectImprovements(
  projectId: string,
): Promise<PortalQueryResult<ProjectImprovement[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_improvements")
    .select(IMPROVEMENT_COLUMNS)
    .eq("project_id", projectId)
    .order("position");

  if (error) {
    logger.error("getProjectImprovements: failed to load improvements", { error });
    return { ok: false, error: error.message };
  }

  return { ok: true, data: (data ?? []).map(mapImprovement) };
}
