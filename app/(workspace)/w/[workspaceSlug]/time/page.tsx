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
import { Clock } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceMembers } from "@/lib/queries/members";
import { getWorkspaceTimeByPerson } from "@/lib/queries/time-entries";
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
  let loadError = false;

  try {
    [members, totals] = await Promise.all([
      getWorkspaceMembers(workspace.id),
      getWorkspaceTimeByPerson(workspace.id, startDate, endDate),
    ]);
  } catch (error) {
    logger.error("TimeReportPage: failed to load time report", { error: error });
    loadError = true;
  }

  const totalsByUserId = new Map(totals.map((t) => [t.userId, t]));

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Clock className="size-5" aria-hidden="true" />
          Time report
        </h1>
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

                return (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{label}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMinutes(billable)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMinutes(nonBillable)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMinutes(billable + nonBillable)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
