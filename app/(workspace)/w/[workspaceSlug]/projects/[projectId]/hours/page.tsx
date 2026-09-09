import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { canWrite, type WorkspaceRole } from "@/lib/auth/permissions";
import { getProjectHoursTeam } from "@/lib/queries/hours";
import { getProjectBudgets } from "@/lib/queries/project-budgets";
import { resolvePeople } from "@/lib/queries/people";
import { TeamHoursView } from "@/components/project/team-hours-view";
// F118 (AS-068): the one compact time-by-type card this feature adds —
// rendered on this project-team-only surface, same visibility gate
// (client role -> notFound() above) as everything else on this page.
import { getProjectTaskTypeTimeTotals } from "@/lib/queries/task-type-time-totals";
import { TaskTypeTimeCard } from "@/components/task/task-type-time-card";

// F018 (missions/20260903-portal): the team hours view (AS-038) --
// "the full picture: by person, by category, billable and not, with the
// client-visible subset marked so a PM can see exactly what the client
// sees without switching context" (this feature's own spec).
//
// Team-only route, same as project_hours_team's own RPC gate
// (is_project_visible_to + NOT is_project_client) -- a client caller
// gets notFound() here rather than an empty page, so "you don't have
// access" reads the same way a private project's 404 already does
// elsewhere in this codebase, not a silently blank table.
//
// "Client-visible subset marked": project_hours_client (F017) counts
// exactly the billable entries in a period -- it applies no other filter
// (see that RPC's own header: it joins tasks only to scope project_id/
// deleted_at, never to check a per-task visibility flag). So "billable"
// IS "what the client sees" for hours purposes; this page marks each
// entry's row with that same predicate rather than inventing a second,
// possibly-diverging definition of "client-visible" here.
export default async function ProjectHoursPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  const supabase = await createClient();

  const [
    {
      data: { user },
    },
    { data: workspace },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("workspaces").select("id, name").eq("slug", workspaceSlug).maybeSingle(),
  ]);

  if (!user) {
    redirect("/sign-in");
  }

  if (!workspace) {
    redirect("/onboarding");
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, workspace_id, name")
    .eq("id", projectId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const { data: ownWorkspaceMembership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  const workspaceRole = (ownWorkspaceMembership?.role ?? "guest") as WorkspaceRole;

  // "Team, not client": a client role never sees this route at all, per
  // this page's own doc comment above.
  if (workspaceRole === "client") {
    notFound();
  }

  const budgetsResult = await getProjectBudgets(project.id);
  const budgets = budgetsResult.ok ? budgetsResult.data : [];

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const currentBudget =
    budgets.find((b) => b.periodStart <= today && b.periodEnd >= today) ?? budgets[0] ?? null;

  // Default window: the current (or most recent) budget's own period, or
  // the last 30 days if this project has no budget yet -- an empty
  // budget list is a valid state (AS-038 doesn't require a budget to
  // exist for the hours breakdown itself to be useful).
  const from =
    currentBudget?.periodStart ??
    new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = currentBudget?.periodEnd ?? today;

  const entries = await getProjectHoursTeam(project.id, from, to);

  const userIds = Array.from(new Set(entries.map((entry) => entry.userId)));
  const people = await resolvePeople(userIds);

  const canManage = canWrite({ role: workspaceRole });

  // F118 (AS-068): the whole project's time-by-type breakdown, not
  // scoped to the `from`/`to` window above — rpc_project_time_totals
  // (F116) reports a project's full totals, no date filter, per its own
  // spec ("one row of numbers, no charts, no trends").
  const taskTypeTotals = await getProjectTaskTypeTimeTotals(project.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Hours</h1>
        <p className="text-sm text-muted-foreground">
          {project.name}&apos;s logged time for {from} – {to}, by person and
          category. Rows marked &ldquo;Client sees this&rdquo; are exactly
          what shows up in the portal&apos;s hours chart.
        </p>
      </div>

      <TaskTypeTimeCard totals={taskTypeTotals} />

      <TeamHoursView
        entries={entries}
        people={Object.fromEntries(
          Array.from(people.entries()).map(([id, summary]) => [
            id,
            summary.name || summary.email || id,
          ]),
        )}
        budget={currentBudget}
        canManage={canManage}
      />
    </div>
  );
}
