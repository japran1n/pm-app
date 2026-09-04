// F006 (missions/20260903-portal): the overview's four tiles -- Waiting
// on you, Pages ready, Hours used, Days to launch -- as "identical
// objects (same padding, same baseline, same foot line)" (this
// feature's own clarified spec), so they read as one family at a glance
// rather than four one-off cards. `Tile` is the single shared primitive
// every one of the four renders through.
//
// F085 (missions/20260903-portal audit, defect 1): Hours used shipped as
// a permanent, hard-coded "Available with the next release" placeholder
// -- correct when F006 landed (F019, the Hours view, did not exist yet),
// stale and actively contradicted the moment F019 shipped a fully
// working Hours view one click away in the sidebar. This tile is now
// wired to that same real read (`usedMinutes`/`soldMinutes`, computed by
// the Overview page from `getProjectHoursClient` -- the identical query
// F019's own Hours page uses, never a second, independently-fetched
// number). `usedMinutes: null` still renders an honest "-" for a project
// with no hours budget/logged time at all, the same "never a fabricated
// figure" convention every other tile here already follows.
//
// F085 (defect 2): "Waiting on you" is now a link -- the tile answered
// "what's waiting on me?" with a number a client could read but never
// click through on. It links to Approvals, the one view built for acting
// on what's pending (Your list and past-due deliverables both stay
// reachable from the sidebar one tap away).
import Link from "next/link";

import type { PortalLaunchConfidence } from "@/lib/queries/portal";

const LAUNCH_CONFIDENCE_LABEL: Record<PortalLaunchConfidence, string> = {
  on_track: "On track",
  at_risk: "At risk",
  slipped: "Slipped",
};

function Tile({
  label,
  value,
  footnote,
  testId,
  href,
}: {
  label: string;
  value: string;
  footnote: string;
  testId: string;
  /** Present only for a tile that has somewhere useful to send a client
   * -- absent tiles render as a plain, non-interactive card. */
  href?: string;
}) {
  const body = (
    <>
      <span className="text-tag text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{footnote}</span>
    </>
  );

  if (href) {
    return (
      <Link
        data-testid={testId}
        href={href}
        className="hover-surface flex flex-col gap-2 rounded-lg border border-border p-5"
      >
        {body}
      </Link>
    );
  }

  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-2 rounded-lg border border-border p-5"
    >
      {body}
    </div>
  );
}

function daysToLaunchFootnote(
  daysToLaunch: number | null,
  launchConfidence: PortalLaunchConfidence | null,
): string {
  if (daysToLaunch === null) return "Launch date not set yet";
  if (launchConfidence) return LAUNCH_CONFIDENCE_LABEL[launchConfidence];
  return "Confidence not set yet";
}

function minutesToHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

export function OverviewTiles({
  waitingOnYouCount,
  approvalsHref,
  pagesReadyCount,
  pagesTotalCount,
  usedMinutes,
  soldMinutes,
  hoursHref,
  daysToLaunch,
  launchConfidence,
}: {
  /** F006f (missions/20260903-portal, AS-002): `null` means the read
   * this tile depends on failed -- rendered as an honest "-", the same
   * "don't claim a number you don't have" convention `daysToLaunch`
   * below already uses, never coalesced to 0 (indistinguishable from a
   * real "nothing waiting on you"). F085: this is now the union of open
   * approvals, pending-approval tasks and past-due deliverables
   * (`getPortalWaitingOnYouCount`, lib/queries/portal.ts) -- not just
   * `pending_client_approval` tasks. */
  waitingOnYouCount: number | null;
  /** Where the tile links -- the Approvals view. */
  approvalsHref: string;
  pagesReadyCount: number;
  pagesTotalCount: number;
  /** F085 (defect 1): billable minutes used against the current budget
   * period, the same read F019's Hours view uses. `null` when there is
   * no budget and nothing logged yet -- rendered as an honest "-", never
   * 0h standing in for "no data". */
  usedMinutes: number | null;
  /** `null` when no budget has been set for the current period. */
  soldMinutes: number | null;
  hoursHref: string;
  /** Whole days from today to the project's target launch date, negative
   * once the date has passed. `null` when no target launch date has
   * been set yet -- rendered as an honest "-", never a default. */
  daysToLaunch: number | null;
  launchConfidence: PortalLaunchConfidence | null;
}) {
  return (
    <div
      data-testid="overview-tiles"
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <Tile
        testId="tile-waiting-on-you"
        label="Waiting on you"
        href={approvalsHref}
        value={waitingOnYouCount === null ? "—" : String(waitingOnYouCount)}
        footnote={
          waitingOnYouCount === null
            ? "We couldn't load this"
            : waitingOnYouCount === 0
              ? "Nothing waiting on you"
              : waitingOnYouCount === 1
                ? "1 item needs your review"
                : `${waitingOnYouCount} items need your review`
        }
      />
      <Tile
        testId="tile-pages-ready"
        label="Pages ready"
        value={pagesTotalCount === 0 ? "—" : `${pagesReadyCount} / ${pagesTotalCount}`}
        footnote={pagesTotalCount === 0 ? "No pages shared yet" : "Ready to launch"}
      />
      <Tile
        testId="tile-hours-used"
        label="Hours used"
        href={hoursHref}
        value={usedMinutes === null ? "—" : minutesToHours(usedMinutes)}
        footnote={
          usedMinutes === null
            ? "No billable hours yet"
            : soldMinutes === null
              ? "No budget set yet"
              : `Of ${minutesToHours(soldMinutes)} budgeted`
        }
      />
      <Tile
        testId="tile-days-to-launch"
        label="Days to launch"
        value={
          daysToLaunch === null
            ? "—"
            : daysToLaunch < 0
              ? "Passed"
              : String(daysToLaunch)
        }
        footnote={daysToLaunchFootnote(daysToLaunch, launchConfidence)}
      />
    </div>
  );
}
