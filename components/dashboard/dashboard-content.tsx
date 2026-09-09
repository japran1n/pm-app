import Link from "next/link";
import {
  AlertTriangle,
  LayoutDashboard,
  Ban,
  CalendarClock,
  CheckCircle2,
} from "lucide-react";

import { PriorityBarChart } from "@/components/dashboard/priority-bar-chart";
import { StatusPieChart } from "@/components/dashboard/status-pie-chart";
import { KpiTile } from "@/components/dashboard/kpi-tile";
import { DashboardRetryButton } from "@/components/dashboard/dashboard-retry-button";
import { SampleProjectOffer } from "@/components/onboarding/sample-project-offer";
import { EmptyState } from "@/components/empty-state";
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
  /** UX-20: unfinished, due within the next 7 days (not yet overdue). */
  dueSoonCount: number;
  /** UX-20: unfinished, with at least one open (not-done) blocker. */
  blockedCount: number;
  /** UX-20: entered a done status in the last 7 days. */
  completedCount: number;
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
  dueSoonCount,
  blockedCount,
  completedCount,
  canOfferSampleProject,
}: DashboardContentProps) {
  if (hasError) {
    return (
      <Card data-testid="dashboard-error-state">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div
            aria-hidden="true"
            className="flex size-12 items-center justify-center rounded-full bg-destructive/10"
          >
            <AlertTriangle className="size-6 text-destructive" />
          </div>
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load your dashboard charts.
          </p>
          <DashboardRetryButton />
        </CardContent>
      </Card>
    );
  }

  if (isEmpty) {
    // UX-21: this used to hand-roll its own two-`<div>` markup instead of
    // the shared EmptyState component every other empty surface in the app
    // uses (board, list view, archive, …) — and this is the very first
    // screen a brand-new workspace shows. Copy is unchanged
    // (tests/unit/dashboard-empty-state.test.ts asserts on "No tasks yet",
    // "create your first project" and the /projects href verbatim).
    return (
      <EmptyState
        testId="dashboard-empty-state"
        icon={LayoutDashboard}
        title="Nothing here yet"
        description="No tasks yet — create your first project to get started."
        action={
          <>
            <Link
              href={`/w/${workspaceSlug}/projects`}
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              View projects
            </Link>
            {/* F254 (AS-494): offered, never forced — a viewer (read-only)
                never sees this control at all. */}
            {canOfferSampleProject && (
              <SampleProjectOffer
                workspaceId={workspaceId}
                workspaceSlug={workspaceSlug}
              />
            )}
          </>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          href={`/w/${workspaceSlug}?flag=overdue`}
          icon={AlertTriangle}
          label="Overdue"
          count={overdueCount}
          tone={overdueCount > 0 ? "crit" : "neutral"}
          description="Past due date, not yet done"
        />
        <KpiTile
          href={`/w/${workspaceSlug}?flag=due_soon`}
          icon={CalendarClock}
          label="Due this week"
          count={dueSoonCount}
          tone={dueSoonCount > 0 ? "warn" : "neutral"}
          description="Due in the next 7 days"
        />
        <KpiTile
          href={`/w/${workspaceSlug}?flag=blocked`}
          icon={Ban}
          label="Blocked"
          count={blockedCount}
          tone={blockedCount > 0 ? "crit" : "neutral"}
          description="Waiting on an open blocker"
        />
        <KpiTile
          href={`/w/${workspaceSlug}?flag=completed`}
          icon={CheckCircle2}
          label="Completed"
          count={completedCount}
          tone="ok"
          description="Done in the last 7 days"
        />
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
