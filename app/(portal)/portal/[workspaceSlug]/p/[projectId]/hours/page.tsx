import { notFound } from "next/navigation";
import { Clock } from "lucide-react";

import { getPortalProjects } from "@/lib/queries/portal";
import { getProjectHoursClient } from "@/lib/queries/hours";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/empty-state";
import { HoursTiles } from "@/components/portal/hours-tiles";
import {
  HoursBurndownChart,
  computeBurndownSeries,
  isoWeekToMonday,
} from "@/components/portal/hours-burndown-chart";
import { HoursByCategory } from "@/components/portal/hours-by-category";

// F019 (missions/20260903-portal, AS-034, AS-038): the Hours view --
// replaces F003's `PortalComingSoon` stub. Reads `getProjectHoursClient`
// (project_hours_client) ONLY -- this feature's own explicit scope rule
// ("the team RPC must not be importable from anything under app/(portal)
// or components/portal"). Grep proof lives in this feature's own
// handoff.
//
// The project is re-resolved via `getPortalProjects` here, same "one
// visibility path, not two" convention pages/page.tsx and p/page.tsx
// (Overview) both already document on themselves -- the enclosing
// layout already 404s for an unshared/portal-disabled project, this is
// what makes the route independently correct even reached directly.
//
// AUTONOMOUS DECISION: no clarification file exists for this feature (no
// `missions/20260903-portal/clarifications/F019-clarification.md`).
// `project_hours_client` takes an explicit `[p_from, p_to]` window and
// has no other client-visible way to learn a budget's own period_start/
// period_end (project_budgets carries no client SELECT policy at all --
// see lib/queries/hours.ts's own header). This queries a wide,
// deliberately generous window (project creation onward, through today)
// so the RPC's own "most recent overlapping budget" lookup naturally
// resolves to whatever budget has already started; the chart's own
// "period" is then the observed week range within that data, disclosed
// in the chart's own caption rather than presented as the budget's
// official date range. See components/portal/hours-burndown-chart.tsx's
// own header for the full reasoning.
const WIDE_FROM = "2000-01-01";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function PortalHoursPage({
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

  const today = todayIso();
  const summary = await getProjectHoursClient(project.id, WIDE_FROM, today);

  if (summary.weekly.length === 0 && summary.soldMinutes === null) {
    return (
      <EmptyState
        icon={Clock}
        title="No billable hours yet."
        description="Once the team logs billable time on this project, hours and the burn-down chart will show up here."
        testId="hours-view-empty"
      />
    );
  }

  const points = computeBurndownSeries(summary.weekly, summary.soldMinutes, today);
  const lastPoint = points[points.length - 1] ?? null;
  const usedMinutes = lastPoint?.usedMinutes ?? 0;
  const thisWeekMinutes = lastPoint?.weekMinutes ?? 0;
  const againstPlanMinutes =
    lastPoint && summary.soldMinutes !== null
      ? lastPoint.usedMinutes - lastPoint.plannedMinutes
      : null;

  // By month: the same weekly array aggregated up, per this feature's
  // own "do not add a third read path" instruction -- no extra query.
  const monthTotals = new Map<string, number>();
  for (const week of summary.weekly) {
    const monday = isoWeekToMonday(week.isoWeek);
    const monthKey = `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}`;
    monthTotals.set(monthKey, (monthTotals.get(monthKey) ?? 0) + week.minutes);
  }
  const months = Array.from(monthTotals.entries()).sort(([a], [b]) => (a < b ? -1 : 1));
  const monthFormatter = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });

  return (
    <div className="flex flex-col gap-8">
      <HoursTiles
        usedMinutes={usedMinutes}
        soldMinutes={summary.soldMinutes}
        thisWeekMinutes={thisWeekMinutes}
        againstPlanMinutes={againstPlanMinutes}
      />

      <HoursBurndownChart weekly={summary.weekly} soldMinutes={summary.soldMinutes} todayIso={today} />

      <HoursByCategory categories={summary.byCategory} />

      <div className="flex flex-col gap-3 rounded-lg border border-border p-5">
        <h2 className="text-sm font-semibold text-foreground">By month</h2>
        {months.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="hours-by-month-empty">
            No billable hours logged yet.
          </p>
        ) : (
          <table className="w-full text-sm" data-testid="hours-by-month">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1.5 font-normal">Month</th>
                <th className="py-1.5 font-normal">Hours</th>
                <th className="py-1.5 font-normal">Note</th>
              </tr>
            </thead>
            <tbody>
              {months.map(([monthKey, minutes]) => {
                const [year, month] = monthKey.split("-").map(Number);
                const label = monthFormatter.format(new Date(Date.UTC(year!, month! - 1, 1)));
                const hours = minutes / 60;
                const hoursLabel = Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
                return (
                  <tr key={monthKey} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5">{label}</td>
                    <td className="py-1.5 tabular-nums">{hoursLabel}</td>
                    <td className="py-1.5 text-muted-foreground">
                      {summary.soldMinutes !== null
                        ? `${Math.round((minutes / summary.soldMinutes) * 100)}% of the current budget`
                        : "Billable hours logged this month"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
