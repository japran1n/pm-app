import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import {
  getPriorityCounts,
  getStatusCounts,
  getOverdueCount,
} from "@/lib/queries/dashboard";
import { DashboardContent } from "@/components/dashboard/dashboard-content";
import { DashboardTaskTable } from "@/components/dashboard/dashboard-task-table";

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
//
// F074 (AS-130): "A workspace with zero tasks shows an empty-state
// dashboard, not an error or blank chart." Recharts renders awkwardly or
// blank when handed all-zero series, so `isEmpty` below (computed from
// the RPC results, not just an absence of props) is checked explicitly
// before either chart ever mounts. The three-way error/empty/populated
// branch itself now lives in components/dashboard/dashboard-content.tsx
// (a pure, props-only component) so it can be unit tested directly — see
// tests/unit/dashboard-empty-state.test.ts.
export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{
    status?: string;
    priority?: string;
    assigneeId?: string;
  }>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;

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

  const [priorityResult, statusResult, overdueResult] = await Promise.all([
    getPriorityCounts(supabase, workspace.id),
    getStatusCounts(supabase, workspace.id),
    getOverdueCount(supabase, workspace.id),
  ]);

  // Error state: log the real error (Sentry-equivalent per this
  // codebase's existing convention — see lib/actions/attachments.ts) and
  // render an inline retry rather than throwing, so one failed RPC doesn't
  // take down the whole workspace home page.
  const hasError = Boolean(
    priorityResult.error || statusResult.error || overdueResult.error,
  );
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
  if (overdueResult.error) {
    console.error(
      `[dashboard] get_overdue_count failed for workspace ${workspace.id}: ${overdueResult.error}`,
    );
  }

  const priorityData = priorityResult.data ?? [];
  const statusData = statusResult.data ?? [];
  const overdueCount = overdueResult.data ?? 0;
  const totalTasks = statusData.reduce((sum, datum) => sum + datum.count, 0);
  const isEmpty = !hasError && totalTasks === 0;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold">Welcome to {workspace.name}</h1>

      <DashboardContent
        workspaceSlug={workspaceSlug}
        hasError={hasError}
        isEmpty={isEmpty}
        priorityData={priorityData}
        statusData={statusData}
        overdueCount={overdueCount}
      />

      {/* F078 (AS-134): workspace-wide task table below the charts, only
          once there's something to show a table of — the empty/error
          states above already cover "no tasks"/"charts failed to load". */}
      {!hasError && !isEmpty && (
        <DashboardTaskTable
          workspaceId={workspace.id}
          workspaceSlug={workspaceSlug}
          searchParams={query}
        />
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
