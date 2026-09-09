// Per-person time drill-down (extends F115's workspace Time report,
// app/(workspace)/w/[workspaceSlug]/time/page.tsx): clicking a row in the
// workspace-wide per-person table lands here, showing that ONE person's
// logged time for the same date range — a per-project breakdown, a daily
// bar chart, and (subject to the note-visibility gate below) the
// individual entries themselves.
//
// Server Component, same GET-form/searchParams convention as the parent
// Time report page — no client JS required for the date-range filter.
//
// Aggregates (breakdown by project, daily totals) stay visible to every
// active workspace member, matching the parent page's own "visible to all
// active members, not admin-only" policy — this drill-down does not
// introduce a stricter gate for numbers alone.
//
// Individual entries WITH their notes are a separate, stricter tier: per
// the clarified spec, a caller viewing another person's drill-down only
// sees the raw entry list (with notes) if they are workspace owner/admin,
// or hold `project_role = 'lead'` on at least one project the target
// person logged time against in this range. A caller viewing their OWN
// drill-down (`userId` param === their own id) always sees their own
// entries — `canViewIndividualTimeEntryNotes`
// (lib/auth/permissions.ts) encodes this exact rule so the UI gate here
// and any future server-action re-check can never drift apart (AS-230
// convention).
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceMembers } from "@/lib/queries/members";
import {
  getPersonTimeByProject,
  getPersonTimeDaily,
  getPersonTimeEntriesInRange,
} from "@/lib/queries/time-entries";
import { canViewIndividualTimeEntryNotes, type WorkspaceRole } from "@/lib/auth/permissions";
import { PersonDailyBarChart } from "@/components/time/person-daily-bar-chart";
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

export default async function PersonTimeDrilldownPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string; userId: string }>;
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const { workspaceSlug, userId: targetUserId } = await params;
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

  if (!workspace) {
    redirect("/onboarding");
  }

  const { data: callerMembership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  const callerRole = (callerMembership?.role ?? "member") as WorkspaceRole;

  const defaults = defaultRange();
  const startDate = query.start?.trim() || defaults.start;
  const endDate = query.end?.trim() || defaults.end;

  const members = await getWorkspaceMembers(workspace.id);
  const targetMember = members.active.find((m) => m.userId === targetUserId);

  if (!targetMember) {
    redirect(`/w/${workspaceSlug}/time`);
  }

  const [byProject, daily] = await Promise.all([
    getPersonTimeByProject(targetUserId, startDate, endDate),
    getPersonTimeDaily(targetUserId, startDate, endDate),
  ]);

  const isSelf = targetUserId === user.id;

  // Only bother resolving project-lead status (and fetching the raw entry
  // list at all) for non-self targets who aren't already owner/admin —
  // those two cases already resolve `canViewIndividualTimeEntryNotes`
  // without it.
  let isProjectLeadOnResource = false;
  if (!isSelf && callerRole !== "owner" && callerRole !== "admin" && byProject.length > 0) {
    const projectIds = byProject.map((p) => p.projectId);
    const { data: leadRows } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", user.id)
      .eq("project_role", "lead")
      .in("project_id", projectIds);
    isProjectLeadOnResource = Boolean(leadRows && leadRows.length > 0);
  }

  const canViewNotes = canViewIndividualTimeEntryNotes({
    role: callerRole,
    resourceOwnerId: targetUserId,
    callerId: user.id,
    isProjectLeadOnResource,
  });

  const entries = canViewNotes
    ? await getPersonTimeEntriesInRange(targetUserId, startDate, endDate)
    : [];

  const totalBillable = byProject.reduce((sum, p) => sum + p.billableMinutes, 0);
  const totalMinutes = byProject.reduce((sum, p) => sum + p.totalMinutes, 0);
  const label = targetMember.name ?? targetMember.email ?? "Unknown member";

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/w/${workspaceSlug}/time`}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Back to Time report
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Clock className="size-5" aria-hidden="true" />
          {label}
        </h1>
        <p className="text-sm text-muted-foreground">
          Logged time in {workspace.name} for the selected date range.
        </p>
      </div>

      <form
        action={`/w/${workspaceSlug}/time/${targetUserId}`}
        method="get"
        className="flex flex-wrap items-end gap-3"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="start" className="text-xs font-medium text-muted-foreground">
            From
          </label>
          <input
            id="start"
            type="date"
            name="start"
            defaultValue={startDate}
            className="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="end" className="text-xs font-medium text-muted-foreground">
            To
          </label>
          <input
            id="end"
            type="date"
            name="end"
            defaultValue={endDate}
            className="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <button
          type="submit"
          className="hover-surface inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium"
        >
          Apply
        </button>
      </form>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-2xl font-semibold tabular-nums">{formatMinutes(totalMinutes)}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Billable</p>
          <p className="text-2xl font-semibold tabular-nums">{formatMinutes(totalBillable)}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-xs text-muted-foreground">Non-billable</p>
          <p className="text-2xl font-semibold tabular-nums">
            {formatMinutes(totalMinutes - totalBillable)}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Logged time by day</h2>
        <PersonDailyBarChart data={daily} />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Breakdown by project</h2>
        {byProject.length === 0 ? (
          <p className="text-sm text-muted-foreground">No logged time in this range.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Billable</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byProject.map((row) => (
                  <TableRow key={row.projectId}>
                    <TableCell>{row.projectName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMinutes(row.billableMinutes)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMinutes(row.totalMinutes)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Individual entries</h2>
        {!canViewNotes ? (
          <p
            data-testid="entries-restricted-notice"
            className="text-sm text-muted-foreground"
          >
            Individual entries with notes are only visible to workspace owners,
            admins, or a lead on one of this person&apos;s projects.
          </p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No entries in this range.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead className="text-right">Minutes</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.entryDate}</TableCell>
                    <TableCell>{entry.taskTitle}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMinutes(entry.minutes)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {entry.note ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
