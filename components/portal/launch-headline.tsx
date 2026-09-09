// F107 (missions/20260903-portal, docs/client-portal-visual-plan.md 2.1):
// the headline answer to "are we on track?" and "when, and how sure?" --
// promoted to the largest thing on the page, from the same
// `target_launch_date`/`launch_confidence`/`launch_note` fields the
// topbar's own small chip (`PortalTopbar`) and `LaunchDayCard` (Your
// site) already read. The topbar chip is left in place rather than
// removed: AS-005's own tests assert it renders on every route
// (including the Overview root) with the project's launch date and
// confidence, and it is the one persistent reference once a client has
// scrolled past this headline -- so the two are sized to make it obvious
// which is the answer and which is the reminder (this headline is the
// single largest text on the page; the topbar chip stays a small
// `Badge`), rather than deleting a tested, still-useful surface to avoid
// a duplicate fact.
import { AlertTriangle, CheckCircle2, OctagonAlert } from "lucide-react";

import type { PortalLaunchConfidence } from "@/lib/queries/portal";

const CONFIDENCE_LABEL: Record<PortalLaunchConfidence, string> = {
  on_track: "On track",
  at_risk: "At risk",
  slipped: "Slipped",
};

// No colour-only encoding: each confidence gets its own icon, not just a
// tinted word, so the state survives greyscale (chart-rules instruction).
const CONFIDENCE_ICON: Record<PortalLaunchConfidence, typeof CheckCircle2> = {
  on_track: CheckCircle2,
  at_risk: AlertTriangle,
  slipped: OctagonAlert,
};

const CONFIDENCE_COLOR: Record<PortalLaunchConfidence, string> = {
  on_track: "text-status-done",
  at_risk: "text-status-waiting",
  slipped: "text-status-blocked",
};

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function LaunchHeadline({
  targetLaunchDate,
  launchConfidence,
  launchNote,
  nextFromYou,
  today,
}: {
  targetLaunchDate: string | null;
  launchConfidence: PortalLaunchConfidence | null;
  launchNote: string | null;
  // F115 (missions/20260903-portal, docs/client-portal-phase-2-plan.md
  // C): "when will you need me again, and for what?" -- one line in the
  // same voice as the headline itself, placed here rather than as a
  // fifth OverviewTiles card. Optional (not `nextFromYou: string`) so
  // this component's own pre-existing tests, which render it without
  // this prop, keep passing unchanged -- omitting the prop omits the
  // line, it never renders an empty string.
  nextFromYou?: string;
  // F115 round 2 (coordinator review): the headline used to say
  // "Launching 26 August 2026" about a project that shipped ten days
  // ago -- a live site described in the future tense undermines every
  // other number on the page. `today` (the same ISO date the Overview
  // page already computes once for `daysToLaunch`) is what turns
  // "Launching" into "Launched" once the date is in the past. Optional
  // and defaulting to "not launched yet" so this component's
  // pre-existing tests (which don't pass it) keep asserting the
  // "Launching" phrasing they already assert.
  today?: string;
}) {
  // Honest empty state (this file's own "never a fabricated figure"
  // convention, same as overview-tiles.tsx and launch-day-card.tsx): no
  // launch date and no confidence set yet is not silently rendered as
  // "on track".
  if (!targetLaunchDate && !launchConfidence) {
    return (
      <div data-testid="launch-headline" className="flex flex-col gap-1">
        <p className="text-h3 font-semibold tracking-tight text-muted-foreground">
          Launch date not set yet
        </p>
        {nextFromYou && (
          <p className="text-sm text-muted-foreground" data-testid="launch-headline-next">
            {nextFromYou}
          </p>
        )}
      </div>
    );
  }

  const Icon = launchConfidence ? CONFIDENCE_ICON[launchConfidence] : CheckCircle2;
  const colorClass = launchConfidence ? CONFIDENCE_COLOR[launchConfidence] : "text-muted-foreground";
  const hasLaunched = Boolean(today && targetLaunchDate && targetLaunchDate < today);

  return (
    <div
      data-testid="launch-headline"
      data-confidence={launchConfidence ?? "unknown"}
      className="flex flex-col gap-1.5"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`flex items-center gap-2 text-h2 font-semibold tracking-tight ${colorClass}`}>
          <Icon aria-hidden="true" className="size-7 shrink-0" />
          {launchConfidence ? CONFIDENCE_LABEL[launchConfidence] : "Confidence not set yet"}
        </span>
        <span className="text-h4 font-medium text-muted-foreground">
          {targetLaunchDate
            ? `${hasLaunched ? "Launched" : "Launching"} ${formatDate(targetLaunchDate)}`
            : "Launch date not set yet"}
        </span>
      </div>
      {launchNote && (
        <p className="text-sm text-muted-foreground" data-testid="launch-headline-note">
          {launchNote}
        </p>
      )}
      {nextFromYou && (
        <p className="text-sm text-muted-foreground" data-testid="launch-headline-next">
          {nextFromYou}
        </p>
      )}
    </div>
  );
}
