import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { getPriorityCounts, getStatusCounts } from "@/lib/queries/dashboard";
import { PriorityBarChart } from "@/components/dashboard/priority-bar-chart";
import { StatusPieChart } from "@/components/dashboard/status-pie-chart";
import { DashboardRetryButton } from "@/components/dashboard/dashboard-retry-button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// F073 (AS-135, and AS-155 via the clarified spec's "Performance" answer):
// the workspace home dashboard — a priority bar chart (F071's
// get_priority_counts RPC) and a status pie chart (F072's
// get_status_counts RPC), replacing F014's placeholder
// ("Minimal placeholder proving the F014 chain ... The real dashboard is
// F073+; out of scope here").
//
// Server Component: both RPCs are called here via
// lib/queries/dashboard.ts and awaited before render, so the chart data is
// part of the initial HTML (AS-155) — the two chart components themselves
// are the only Client Component boundary (Recharts needs the DOM/
// ResizeObserver), receiving already-fetched data as a plain prop, never
// fetching on their own.
//
// Access: relies on the workspace-membership layout guard above this route
// (app/(workspace)/w/[workspaceSlug]/layout.tsx, F010/F023) — reaching
// this page at all already means the caller is an active member of this
// workspace; AS-135 doesn't call for a duplicate page-level gate.
//
// AS-135: chart colors come from lib/task-colors.ts (PRIORITY_COLORS /
// STATUS_COLORS), the same shared constant now used by the priority badge
// (components/task/task-card.tsx) and the board column header dot
// (components/board/board-column.tsx), so a chart's colors always match
// those elements elsewhere in the app.
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  // The layout above already redirects away when the workspace can't be
  // resolved, so this is just a defensive fallback, not the primary guard.
  if (!workspace) {
    redirect("/onboarding");
  }

  const [priorityResult, statusResult] = await Promise.all([
    getPriorityCounts(supabase, workspace.id),
    getStatusCounts(supabase, workspace.id),
  ]);

  // Error state: log the real error (Sentry-equivalent per this
  // codebase's existing convention — see lib/actions/attachments.ts) and
  // render an inline retry rather than throwing, so one failed RPC doesn't
  // take down the whole workspace home page.
  const hasError = Boolean(priorityResult.error || statusResult.error);
  if (priorityResult.error) {
    console.error(
      `[dashboard] get_priority_counts failed for workspace ${workspace.id}: ${priorityResult.error}`,
    );
  }
  if (statusResult.error) {
    console.error(
      `[dashboard] get_status_counts failed for workspace ${workspace.id}: ${statusResult.error}`,
    );
  }

  const priorityData = priorityResult.data ?? [];
  const statusData = statusResult.data ?? [];
  const totalTasks = statusData.reduce((sum, datum) => sum + datum.count, 0);
  const isEmpty = !hasError && totalTasks === 0;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold">Welcome to {workspace.name}</h1>

      {hasError ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 py-6">
            <p className="text-sm text-muted-foreground">
              We couldn&apos;t load your dashboard charts.
            </p>
            <DashboardRetryButton />
          </CardContent>
        </Card>
      ) : isEmpty ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 py-6">
            <p className="text-sm text-muted-foreground">
              No tasks yet — charts will appear here once this workspace has
              tasks.
            </p>
            <Link
              href={`/w/${workspaceSlug}/projects`}
              className="text-sm underline"
            >
              View projects
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Tasks by priority</CardTitle>
            </CardHeader>
            <CardContent>
              <PriorityBarChart data={priorityData} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Tasks by status</CardTitle>
            </CardHeader>
            <CardContent>
              <StatusPieChart data={statusData} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* F027: natural next stop from the dashboard. */}
      <Link
        href={`/w/${workspaceSlug}/projects`}
        className="text-sm text-muted-foreground underline"
      >
        View projects
      </Link>
    </div>
  );
}
