import type { PortalProject } from "@/lib/queries/portal";
import { projectHealthLabel } from "@/components/portal/status-label";

const TONE_CLASS: Record<"ok" | "warn" | "crit", string> = {
  ok: "bg-emerald-500/10 text-emerald-700",
  warn: "bg-amber-500/10 text-amber-700",
  crit: "bg-destructive/10 text-destructive",
};

function formatDate(iso: string): string {
  // Deliberately locale-fixed rather than using the viewer's locale: this
  // renders on the server, so a locale-dependent format would differ
  // between the server-rendered HTML and a client re-render and produce a
  // hydration mismatch. A day-month-year short form is unambiguous for the
  // audiences this app targets, unlike a numeric-only format.
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// The shared progress readout used by both the portal overview cards and
// the project page header. A plain div-based bar rather than the app's
// Progress primitive: this needs a three-segment stacked bar (done /
// in progress / not started) that the single-value primitive does not
// express, and inventing a variant of it for one consumer would be the
// worse trade.
export function ProjectProgress({ project }: { project: PortalProject }) {
  const { done, inProgress, total, percentComplete, nextDue, overdueCount } =
    project;

  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing shared with you on this project yet.
      </p>
    );
  }

  const donePct = (done / total) * 100;
  const inProgressPct = (inProgress / total) * 100;

  const health = projectHealthLabel({ overdueCount, percentComplete });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-2xl font-semibold tabular-nums">
          {percentComplete}%
        </span>
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[0.65rem] font-medium tracking-wide uppercase ${TONE_CLASS[health.tone]}`}
        >
          {health.label}
        </span>
      </div>
      <span className="-mt-2 text-xs text-muted-foreground">
        {done} of {total} done
      </span>

      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${done} done, ${inProgress} in progress, ${
          total - done - inProgress
        } not started`}
      >
        <div
          className="bg-emerald-500"
          style={{ width: `${donePct}%` }}
        />
        <div
          className="bg-blue-500"
          style={{ width: `${inProgressPct}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {nextDue ? (
          <span>
            Next: {nextDue.title}
            {nextDue.dueDate ? ` · ${formatDate(nextDue.dueDate)}` : ""}
          </span>
        ) : (
          <span>No upcoming dates</span>
        )}
        {overdueCount > 0 && (
          <span className="font-medium text-destructive">
            {overdueCount} overdue
          </span>
        )}
      </div>
    </div>
  );
}
