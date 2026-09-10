import { logger } from "@/lib/observability/logger";

// F115 (AS-173, AS-174): per-person time report for the current workspace.
//
// Server Component for data-fetching, following SearchPage's convention
// (app/(workspace)/w/[workspaceSlug]/search/page.tsx): the date-range
// picker is a thin, unnamed GET form (no client JS needed — writes
// `?start=&end=` and Next re-renders this Server Component with the new
// `searchParams`), keeping the client boundary at zero.
//
// Access relies on the workspace-membership layout guard one level up
// (app/(workspace)/w/[workspaceSlug]/layout.tsx, F010/F023) — no
// page-level role gate, per the clarified spec: "Visible to all active
// workspace members (not admin-only)".
//
// Default date range (per the clarified spec): the first day of the
// current calendar month through today, computed server-side from the
// request so it's correct regardless of the client's clock/timezone
// assumptions.
//
// Member display names/emails reuse `getWorkspaceMembers` (F017,
// lib/queries/members.ts) rather than re-implementing the Auth Admin API
// lookup — that function already resolves the workspace's active members'
// email/name via the admin client scoped to RLS-visible user ids.

import { redirect } from "next/navigation";
import Link from "next/link";
import { Clock } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceMembers } from "@/lib/queries/members";
import { getWorkspaceTimeByPerson, getPersonTimeDaily } from "@/lib/queries/time-entries";
import { getPeriodShortcuts } from "@/lib/time/period-shortcuts";
import { buildTeamHeatmapGrid, type PersonDayMinutes } from "@/lib/time/team-heatmap-data";
import { TeamHeatmap } from "@/components/time/team-heatmap";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultRange(): { start: string; end: string } {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: formatDate(firstOfMonth), end: formatDate(now) };
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export default async function TimeReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  // Defensive fallback only — the layout guard above already redirects
  // away when the workspace can't be resolved for this caller.
  if (!workspace) {
    redirect("/onboarding");
  }

  const defaults = defaultRange();
  const startDate = query.start?.trim() || defaults.start;
  const endDate = query.end?.trim() || defaults.end;

  let members: Awaited<ReturnType<typeof getWorkspaceMembers>> | null = null;
  let totals: Awaited<ReturnType<typeof getWorkspaceTimeByPerson>> = [];
  let dailyByPerson: PersonDayMinutes[] = [];
  let loadError = false;

  try {
    [members, totals] = await Promise.all([
      getWorkspaceMembers(workspace.id),
      getWorkspaceTimeByPerson(workspace.id, startDate, endDate),
    ]);

    // No single workspace-wide "by person AND day" RPC exists yet (only
    // `get_workspace_time_by_person_and_project`, grouped by project, not
    // day) — see lib/time/team-heatmap-data.ts's header comment. One
    // `getPersonTimeDaily` call per active member, bounded by the same
    // member list already loaded above for the per-person table.
    if (members) {
      const perPersonDaily = await Promise.all(
        members.active.map(async (member) => {
          const days = await getPersonTimeDaily(member.userId, startDate, endDate);
          return days.map((d) => ({
            userId: member.userId,
            entryDate: d.entryDate,
            totalMinutes: d.totalMinutes,
          }));
        }),
      );
      dailyByPerson = perPersonDaily.flat();
    }
  } catch (error) {
    logger.error("TimeReportPage: failed to load time report", { error: error });
    loadError = true;
  }

  const totalsByUserId = new Map(totals.map((t) => [t.userId, t]));
  const periodShortcuts = getPeriodShortcuts();
  const heatmapGrid =
    members && members.active.length > 0
      ? buildTeamHeatmapGrid(
          members.active.map((m) => m.userId),
          dailyByPerson,
          startDate,
          endDate,
        )
      : null;

  return (
    <div className="flex flex-col gap-6 p-6 pt-4 lg:p-8 lg:pt-8">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Clock className="size-5" aria-hidden="true" />
            Time report
          </h1>
          <nav aria-label="Time report views" className="flex items-center gap-1 rounded-md border p-1">
            <span className="rounded bg-secondary px-3 py-1 text-sm font-medium">
              Team report
            </span>
            <Link
              href={`/w/${workspaceSlug}/time/me`}
              className="rounded px-3 py-1 text-sm text-muted-foreground hover:bg-secondary"
            >
              My time
            </Link>
          </nav>
        </div>
        <p className="text-sm text-muted-foreground">
          Logged time per member in {workspace.name} for the selected date
          range.
        </p>
      </div>

      <form
        action={`/w/${workspaceSlug}/time`}
        method="get"
        className="flex flex-wrap items-end gap-3"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="start" className="text-xs font-medium text-muted-foreground">
            From
          </label>
          <Input
            id="start"
            type="date"
            name="start"
            defaultValue={startDate}
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="end" className="text-xs font-medium text-muted-foreground">
            To
          </label>
          <Input
            id="end"
            type="date"
            name="end"
            defaultValue={endDate}
            className="w-40"
          />
        </div>
        <Button type="submit" variant="secondary" size="sm">
          Apply
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2" aria-label="Period shortcuts">
        {periodShortcuts.map((shortcut) => (
          <a
            key={shortcut.key}
            href={`/w/${workspaceSlug}/time?start=${shortcut.start}&end=${shortcut.end}`}
            data-testid={`period-shortcut-${shortcut.key}`}
            className="hover-surface rounded-md border px-3 py-1 text-xs font-medium"
          >
            {shortcut.label}
          </a>
        ))}
      </div>

      {loadError && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p>Something went wrong loading the time report. Please try again.</p>
          <a
            href={`/w/${workspaceSlug}/time?start=${startDate}&end=${endDate}`}
            className="underline"
          >
            Retry
          </a>
        </div>
      )}

      {!loadError && members && members.active.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-10 text-center">
          <p className="text-sm font-medium">No active members yet</p>
          <p className="text-sm text-muted-foreground">
            Invite teammates to start tracking their logged time here.
          </p>
        </div>
      )}

      {!loadError && members && members.active.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead className="text-right">Billable</TableHead>
                <TableHead className="text-right">Non-billable</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.active.map((member) => {
                const label = member.name ?? member.email ?? "Unknown member";
                const entry = totalsByUserId.get(member.userId);
                const billable = entry?.billableMinutes ?? 0;
                const nonBillable = entry?.nonBillableMinutes ?? 0;

                const drilldownHref = `/w/${workspaceSlug}/time/${member.userId}?start=${startDate}&end=${endDate}`;

                return (
                  <TableRow key={member.id} className="hover-surface">
                    <TableCell className="p-0">
                      <Link
                        href={drilldownHref}
                        data-testid="person-row-link"
                        className="flex flex-col px-4 py-2"
                      >
                        <span className="font-medium underline-offset-2 hover:underline">
                          {label}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatMinutes(billable)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatMinutes(nonBillable)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium tabular-nums">
                      {formatMinutes(billable + nonBillable)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {!loadError && members && members.active.length > 0 && heatmapGrid && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Team heatmap</h2>
          <TeamHeatmap
            grid={heatmapGrid}
            people={members.active.map((m) => ({
              userId: m.userId,
              label: m.name ?? m.email ?? "Unknown member",
            }))}
          />
        </div>
      )}
    </div>
  );
}
