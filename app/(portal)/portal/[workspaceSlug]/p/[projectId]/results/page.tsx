import { notFound } from "next/navigation";
import { AlertTriangle, BarChart3 } from "lucide-react";

import { getPortalProjects } from "@/lib/queries/portal";
import {
  getProjectImprovements,
  getProjectMetricsWithLatestSnapshot,
  deriveMetricMeasurementStatus,
} from "@/lib/queries/metrics";
import { getImprovementImageSignedUrl } from "@/lib/actions/metrics";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import { MetricComparisonCard } from "@/components/portal/metric-comparison-card";
import { ResultsImprovements, type ResolvedImprovement } from "@/components/portal/results-improvements";
import { formatDateLong } from "@/lib/format";

export default async function PortalResultsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) notFound();

  const projects = await getPortalProjects(workspace.id);
  const project = projects.find((p) => p.id === projectId);

  if (!project) notFound();

  // The header's own "when the baseline was frozen" line -- read directly
  // rather than through getPortalProjects (whose own PortalProject shape
  // has no reason to carry a field none of its other callers need). RLS
  // already scopes this SELECT the same as every other read on this page.
  const { data: projectRow } = await supabase
    .from("projects")
    .select("baseline_frozen_at")
    .eq("id", projectId)
    .maybeSingle();
  const baselineFrozenAt = projectRow?.baseline_frozen_at ?? null;

  const [metricsResult, improvementsResult] = await Promise.all([
    getProjectMetricsWithLatestSnapshot(projectId),
    getProjectImprovements(projectId),
  ]);

  // F021c: a failed metrics read used to fall through the exact same
  // `metrics.length === 0` branch as "no metrics recorded yet" — the same
  // failure-presented-as-reassuring-fact defect F006f's own header
  // describes for getProjectPhases (lib/queries/portal.ts), in the one
  // view whose entire purpose is credibility with the client. A failed
  // read renders an honest "couldn't load" state instead, never a `[]`
  // this page can't tell apart from "genuinely nothing yet".
  if (!metricsResult.ok) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load results"
        description="Something went wrong loading this project's metrics. Try refreshing the page."
        testId="results-view-error"
      />
    );
  }

  const metrics = metricsResult.data;
  const improvements = improvementsResult.ok ? improvementsResult.data : [];

  if (metrics.length === 0 && improvements.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No results yet."
        description="Once the team records a baseline and starts tracking metrics, before/after results will show up here."
        testId="results-view-empty"
      />
    );
  }

  // Resolve every before/after image to a fresh signed URL up front --
  // signed URLs expire, so this page must never persist or reuse one
  // (getImprovementImageSignedUrl's own header comment). A single failed
  // signing (e.g. a since-deleted object) degrades to "no image for that
  // side" rather than failing the whole page, matching this section's own
  // "must not require images to be worth reading" instruction.
  const resolvedImprovements: ResolvedImprovement[] = await Promise.all(
    improvements.map(async (item) => {
      const [beforeImageUrl, afterImageUrl] = await Promise.all([
        item.beforePath
          ? getImprovementImageSignedUrl(item.id, "before").then((r) => (r.ok ? r.signedUrl : null))
          : Promise.resolve(null),
        item.afterPath
          ? getImprovementImageSignedUrl(item.id, "after").then((r) => (r.ok ? r.signedUrl : null))
          : Promise.resolve(null),
      ]);
      return {
        id: item.id,
        area: item.area,
        explanation: item.explanation,
        beforeImageUrl,
        afterImageUrl,
      };
    }),
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="rounded-lg border border-border bg-muted/40 p-4">
        <p className="text-sm text-muted-foreground" data-testid="results-header-note">
          {baselineFrozenAt
            ? `Baseline frozen on ${formatDateLong(baselineFrozenAt)}. Every "Now" measurement below is taken the same way as the baseline, so the two numbers are directly comparable.`
            : "This project's baseline has not been frozen yet — measurements below may still change as the baseline method is finalised."}
        </p>
      </div>

      {metrics.length > 0 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-foreground">Metrics</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="metric-comparison-cards">
            {metrics.map((metric) => (
              <MetricComparisonCard
                key={metric.id}
                metric={metric}
                latestSnapshot={metric.latestSnapshot}
                status={deriveMetricMeasurementStatus(metric, metric.latestSnapshot)}
              />
            ))}
          </div>
        </div>
      )}

      <ResultsImprovements improvements={resolvedImprovements} />
    </div>
  );
}
