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
import { getWorkspaceContext } from "@/lib/queries/workspaces";
import { DashboardTaskTable } from "@/components/dashboard/dashboard-task-table";
// P2-17: DashboardContent no longer needs ssr:false — Recharts is gone;
// import directly instead of through the dashboard-content-lazy wrapper.
import { DashboardContent } from "@/components/dashboard/dashboard-content";
import { PersonalTodoList } from "@/components/my-tasks/personal-todo-list";
import { getPersonalTodos } from "@/lib/queries/personal-todos";

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

  // P2-17: wave 1 — context (workspace, user, role) and timezone in
  // parallel. getWorkspaceContext is cache()-wrapped and batches the user
  // lookup, workspace-by-slug query, and membership role check into one
  // chain without extra round trips (see lib/queries/workspaces.ts).
  // getCurrentUserTimezone only needs the current user (not workspace_id),
  // so it runs alongside the context fetch rather than waiting for it.
  const [ctx, timezone] = await Promise.all([
    getWorkspaceContext(workspaceSlug),
    getCurrentUserTimezone(supabase),
  ]);

  const { user, workspace, role } = ctx;

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
  const canOfferSampleProject = user
    ? canWrite({
        role: (role ?? "member") as Parameters<typeof canWrite>[0]["role"],
      })
    : false;

  // P2-17: wave 2 — every remaining fetch depends only on workspace.id
  // and/or timezone (both resolved above), so all run in parallel.
  // Consolidation (20261116010000): personalTodos joins the same wave.
  // UX-20: all six workspace-scoped counts run here in one Promise.all.
  const [
    personalTodos,
    priorityResult,
    statusResult,
    overdueResult,
    dueSoonResult,
    blockedResult,
    completedResult,
  ] = await Promise.all([
    getPersonalTodos(workspace.id),
    getPriorityCounts(supabase, workspace.id),
    getStatusCounts(supabase, workspace.id),
    getOverdueCount(supabase, workspace.id, timezone),
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
    <div className="flex flex-1 flex-col gap-6 p-6 pt-4 lg:p-8 lg:pt-8">
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

      {/* UX audit: the personal to-do list is a lower-priority personal
          reminder, so it sits below the workspace-wide stats/charts above
          instead of competing with them for the top of the page. */}
      <PersonalTodoList
        workspaceId={workspace.id}
        workspaceSlug={workspaceSlug}
        initialTodos={personalTodos}
      />

      {/* F078 (AS-134): workspace-wide task table below the charts, only
          once there's something to show a table of — the empty/error
          states above already cover "no tasks"/"charts failed to load". */}
      {!hasError && !isEmpty && (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold tracking-tight">
            All tasks
          </h2>
          <DashboardTaskTable
            workspaceId={workspace.id}
            workspaceSlug={workspaceSlug}
            searchParams={query}
            timezone={timezone}
          />
        </div>
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
