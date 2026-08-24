import Link from "next/link";

import { PriorityBarChart } from "@/components/dashboard/priority-bar-chart";
import { StatusPieChart } from "@/components/dashboard/status-pie-chart";
import { OverdueTile } from "@/components/dashboard/overdue-tile";
import { DashboardRetryButton } from "@/components/dashboard/dashboard-retry-button";
import { SampleProjectOffer } from "@/components/onboarding/sample-project-offer";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  PriorityCountDatum,
  StatusCountDatum,
} from "@/lib/queries/dashboard";

// F074 (AS-130): "A workspace with zero tasks shows an empty-state
// dashboard, not an error or blank chart." Pulled out of
// app/(workspace)/w/[workspaceSlug]/page.tsx (F073) into its own pure,
// props-only component so the error/empty/populated branching can be unit
// tested directly (renderToStaticMarkup, same pattern as
// tests/unit/list-view-empty-state.test.ts) without a Supabase-backed
// Server Component render. The Server Component (page.tsx) still owns all
// data-fetching — this component only renders what it's given, per the
// clarified spec's "smallest possible client boundary" pattern applied to
// the presentational layer.
//
// Recharts (PriorityBarChart / StatusPieChart) renders awkwardly or
// blank when handed all-zero data — rather than letting that fall
// through, `isEmpty` (computed by the caller as `totalTasks === 0`) short
// -circuits straight to an explicit empty-state message with a link to
// the projects page, before either chart ever mounts.
export type DashboardContentProps = {
  workspaceId: string;
  workspaceSlug: string;
  hasError: boolean;
  isEmpty: boolean;
  priorityData: PriorityCountDatum[];
  statusData: StatusCountDatum[];
  overdueCount: number;
  // F254 (AS-494): the sample-project offer is only ever mounted for a
  // caller who could actually create a project (`canWrite` — viewers are
  // read-only, AS-216/AS-217) — a plain UI-only convenience gate, since
  // `createSampleProject`'s own `createProject` call already independently
  // re-checks membership + `canWrite` server-side (AS-143 convention).
  canOfferSampleProject: boolean;
};

export function DashboardContent({
  workspaceId,
  workspaceSlug,
  hasError,
  isEmpty,
  priorityData,
  statusData,
  overdueCount,
  canOfferSampleProject,
}: DashboardContentProps) {
  if (hasError) {
    return (
      <Card data-testid="dashboard-error-state">
        <CardContent className="flex flex-col items-start gap-3 py-6">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load your dashboard charts.
          </p>
          <DashboardRetryButton />
        </CardContent>
      </Card>
    );
  }

  if (isEmpty) {
    return (
      <Card data-testid="dashboard-empty-state">
        <CardContent className="flex flex-col items-start gap-4 py-6">
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              No tasks yet — create your first project to get started.
            </p>
            <Link
              href={`/w/${workspaceSlug}/projects`}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              View projects
            </Link>
          </div>

          {/* F254 (AS-494): offered, never forced — a viewer (read-only)
              never sees this control at all. */}
          {canOfferSampleProject && (
            <SampleProjectOffer
              workspaceId={workspaceId}
              workspaceSlug={workspaceSlug}
            />
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <OverdueTile count={overdueCount} />
      </div>
      <div className="grid gap-4 md:grid-cols-2" data-testid="dashboard-charts">
        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Tasks by priority
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PriorityBarChart data={priorityData} />
          </CardContent>
        </Card>
        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Tasks by status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StatusPieChart data={statusData} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
