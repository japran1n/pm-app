import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import {
  getPriorityCounts,
  getStatusCounts,
  getOverdueCount,
  getDueSoonCount,
  getBlockedCount,
  getCompletedCount,
} from "@/lib/queries/dashboard";
import { logger } from "@/lib/observability/logger";
import { getCurrentUserTimezone } from "@/lib/queries/profile";
import { canWrite } from "@/lib/auth/permissions";
import { DashboardTaskTable } from "@/components/dashboard/dashboard-task-table";
import { DashboardContentLazy as DashboardContent } from "@/components/dashboard/dashboard-content-lazy";

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // F124 (AS-207): the viewer's timezone is resolved ONCE per request here
  // (lib/queries/profile.ts's getCurrentUserTimezone), run alongside the
  // independent workspace lookup rather than sequentially awaited, then
  // threaded through to getOverdueCount (the SQL-side "is this task
  // overdue" definition) and down to <DashboardTaskTable> as a prop.
  const [{ data: workspace }, timezone] = await Promise.all([
    supabase
      .from("workspaces")
      .select("id, name")
      .eq("slug", workspaceSlug)
      .maybeSingle(),
    getCurrentUserTimezone(supabase),
  ]);

  // The layout above already redirects away when the workspace can't be
  // resolved, so this is just a defensive fallback, not the primary guard.
  if (!workspace) {
    redirect("/onboarding");
  }

  // F254 (AS-494): UI-only gate for the sample-project offer — the layout
  // guard above already means `user` is an active member of this
  // workspace, so this only decides the finer-grained `canWrite` question
  // (viewers are read-only, AS-216/AS-217). `createSampleProject` itself
  // independently re-checks this server-side via `createProject`.
  let canOfferSampleProject = false;
  if (user) {
    const { data: callerMembership } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspace.id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    canOfferSampleProject = canWrite({
      role: (callerMembership?.role ?? "member") as Parameters<
        typeof canWrite
      >[0]["role"],
    });
  }

  const [
    priorityResult,
    statusResult,
    overdueResult,
    dueSoonResult,
    blockedResult,
    completedResult,
  ] = await Promise.all([
    getPriorityCounts(supabase, workspace.id),
    getStatusCounts(supabase, workspace.id),
    getOverdueCount(supabase, workspace.id, timezone),
    // UX-20: three more small workspace-scoped counts, fetched alongside
    // the three that already existed — same "server-fetched RPC results
    // passed down as plain props" shape, no new round trip pattern.
    getDueSoonCount(supabase, workspace.id, timezone),
    getBlockedCount(supabase, workspace.id),
    getCompletedCount(supabase, workspace.id, timezone),
  ]);

  // Error state: log the real error (Sentry-equivalent per this
  // codebase's existing convention — see lib/actions/attachments.ts) and
  // render an inline retry rather than throwing, so one failed RPC doesn't
  // take down the whole workspace home page.
  const hasError = Boolean(
    priorityResult.error ||
      statusResult.error ||
      overdueResult.error ||
      dueSoonResult.error ||
      blockedResult.error ||
      completedResult.error,
  );
  if (priorityResult.error) {
    logger.error(`[dashboard] get_priority_counts failed for workspace ${workspace.id}: ${priorityResult.error}`);
  }
  if (statusResult.error) {
    logger.error(`[dashboard] get_status_counts failed for workspace ${workspace.id}: ${statusResult.error}`);
  }
  if (overdueResult.error) {
    logger.error(`[dashboard] get_overdue_count failed for workspace ${workspace.id}: ${overdueResult.error}`);
  }
  if (dueSoonResult.error) {
    logger.error(`[dashboard] get_due_soon_count failed for workspace ${workspace.id}: ${dueSoonResult.error}`);
  }
  if (blockedResult.error) {
    logger.error(`[dashboard] get_blocked_count failed for workspace ${workspace.id}: ${blockedResult.error}`);
  }
  if (completedResult.error) {
    logger.error(`[dashboard] get_completed_count failed for workspace ${workspace.id}: ${completedResult.error}`);
  }

  const priorityData = priorityResult.data ?? [];
  const statusData = statusResult.data ?? [];
  const overdueCount = overdueResult.data ?? 0;
  const dueSoonCount = dueSoonResult.data ?? 0;
  const blockedCount = blockedResult.data ?? 0;
  const completedCount = completedResult.data ?? 0;
  const totalTasks = statusData.reduce((sum, datum) => sum + datum.count, 0);
  const isEmpty = !hasError && totalTasks === 0;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 md:p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {workspace.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          An overview of what&apos;s happening across your workspace.
        </p>
      </div>

      <DashboardContent
        workspaceId={workspace.id}
        workspaceSlug={workspaceSlug}
        hasError={hasError}
        isEmpty={isEmpty}
        priorityData={priorityData}
        statusData={statusData}
        overdueCount={overdueCount}
        dueSoonCount={dueSoonCount}
        blockedCount={blockedCount}
        completedCount={completedCount}
        canOfferSampleProject={canOfferSampleProject}
      />

      {/* F078 (AS-134): workspace-wide task table below the charts, only
          once there's something to show a table of — the empty/error
          states above already cover "no tasks"/"charts failed to load". */}
      {!hasError && !isEmpty && (
        <DashboardTaskTable
          workspaceId={workspace.id}
          workspaceSlug={workspaceSlug}
          searchParams={query}
          timezone={timezone}
        />
      )}

      {/* F027: natural next stop from the dashboard. */}
      <Link
        href={`/w/${workspaceSlug}/projects`}
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        View projects
      </Link>
    </div>
  );
}
