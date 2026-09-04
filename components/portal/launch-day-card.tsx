// F023 (missions/20260903-portal): the "Your site" view's launch day
// card. Reads F001's own launch fields (`target_launch_date`,
// `launch_confidence`, `launch_note`) and this feature's own
// `warranty_until`/`warranty_terms` (20261016010000) -- all five
// nullable, all rendered as an honest "-" or omitted line when unset,
// same "don't claim a number you don't have" convention
// `overview-tiles.tsx` already documents on itself for the same three
// launch fields.
//
// No `rollback_plan_status`/`monitoring_window` column exists anywhere in
// this schema (grepped: no migration, no query file names either) -- this
// card does not invent per-project data for them. Instead it states the
// two as plain process facts, true for every launch this team runs, not
// a live per-project status the database doesn't track.
import { Calendar, RotateCcw, Radar, ShieldCheck } from "lucide-react";

import type { PortalLaunchConfidence } from "@/lib/queries/portal";

const CONFIDENCE_LABEL: Record<PortalLaunchConfidence, string> = {
  on_track: "On track",
  at_risk: "At risk",
  slipped: "Slipped",
};

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function Row({
  icon: Icon,
  label,
  value,
  testId,
}: {
  icon: typeof Calendar;
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div className="flex items-start gap-2.5" data-testid={testId}>
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-tag text-muted-foreground">{label}</span>
        <span className="text-sm text-foreground">{value}</span>
      </div>
    </div>
  );
}

export function LaunchDayCard({
  targetLaunchDate,
  launchConfidence,
  launchNote,
  warrantyUntil,
  warrantyTerms,
}: {
  targetLaunchDate: string | null;
  launchConfidence: PortalLaunchConfidence | null;
  launchNote: string | null;
  warrantyUntil: string | null;
  warrantyTerms: string | null;
}) {
  return (
    <div
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
      data-testid="launch-day-card"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Row
          icon={Calendar}
          label="Planned launch"
          value={
            targetLaunchDate
              ? `${formatDate(targetLaunchDate)}${
                  launchConfidence ? ` — ${CONFIDENCE_LABEL[launchConfidence]}` : ""
                }`
              : "Not set yet"
          }
          testId="launch-day-planned"
        />
        <Row
          icon={RotateCcw}
          label="Rollback plan"
          value="Prepared and rehearsed before every launch."
          testId="launch-day-rollback"
        />
        <Row
          icon={Radar}
          label="Monitoring window"
          value="Uptime and errors watched closely for the first 48 hours after launch."
          testId="launch-day-monitoring"
        />
        <Row
          icon={ShieldCheck}
          label="Warranty period"
          value={
            warrantyUntil
              ? `Covered until ${formatDate(warrantyUntil)}${
                  warrantyTerms ? ` — ${warrantyTerms}` : ""
                }`
              : "Not set yet"
          }
          testId="launch-day-warranty"
        />
      </div>

      {launchNote && (
        <p className="text-sm text-muted-foreground" data-testid="launch-day-note">
          {launchNote}
        </p>
      )}

      <p className="text-tag text-muted-foreground" data-testid="launch-day-friday-line">
        We never launch on a Friday, and never the day before a holiday.
      </p>
    </div>
  );
}
