import { notFound } from "next/navigation";
import { Clock } from "lucide-react";

import { getPortalProjects } from "@/lib/queries/portal";
import { getProjectHoursClient, getProjectCurrentBudgetPeriod } from "@/lib/queries/hours";
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
// F021b (missions/20260903-portal, M4 remediation -- blocker): this used
// to query a WIDE_FROM = "2000-01-01" .. today window, letting
// `project_hours_client` aggregate weekly/by-category totals across
// EVERY budget period a project has ever had while `sold_minutes` came
// from a single budget chosen by overlap -- a project with a closed
// 2025 budget (40h used) and a current 2026 budget (5h of 40h used)
// reported Used 45h, Remaining 0h, "+5h Over". Every tile was wrong, in
// the direction that starts a false conversation about an overrun.
//
// Fixed: `getProjectCurrentBudgetPeriod` (lib/queries/hours.ts,
// 20261015020000_f021b_hours_period_scoping.sql) picks exactly ONE
// period -- the one covering today, or the most recently ended one if
// none is current -- and `getProjectHoursClient` is queried with THAT
// period's own [period_start, period_end], so Used/Remaining/Planned
// and the weekly series all describe the same window as sold_minutes.
// A project with no budget at all still falls back to the wide range
// below (sold_minutes stays null either way, so F019's honest empty
// treatment is unchanged when there is also no time logged).
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
  const currentPeriod = await getProjectCurrentBudgetPeriod(project.id);
  const summary = await getProjectHoursClient(
    project.id,
    currentPeriod?.periodStart ?? WIDE_FROM,
    currentPeriod?.periodEnd ?? today,
  );

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

  const periodFormatter = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const formatPeriodDate = (dateIso: string) => {
    const [y, m, d] = dateIso.split("-").map(Number);
    return periodFormatter.format(new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)));
  };

  return (
    <div className="flex flex-col gap-8">
      {currentPeriod && (
        <p className="text-xs text-muted-foreground" data-testid="hours-period-scope">
          Showing the current billing period: {formatPeriodDate(currentPeriod.periodStart)}
          {" – "}
          {formatPeriodDate(currentPeriod.periodEnd)}.
          {currentPeriod.hasOtherPeriods
            ? " Earlier periods are not included in these figures."
            : ""}
        </p>
      )}

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
