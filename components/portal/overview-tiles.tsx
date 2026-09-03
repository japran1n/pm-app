// F006 (missions/20260903-portal): the overview's four tiles -- Waiting
// on you, Pages ready, Hours used, Days to launch -- as "identical
// objects (same padding, same baseline, same foot line)" (this
// feature's own clarified spec), so they read as one family at a glance
// rather than four one-off cards. `Tile` is the single shared primitive
// every one of the four renders through.
//
// Hours used is not available until M4 (this feature's own explicit,
// non-negotiable instruction): its value is a literal em dash and its
// foot line always reads "Available with the next release" -- it takes
// no data props at all, so there is no code path that could ever put a
// number there before the feature that computes one honestly (F019)
// exists. This is the one tile whose props are deliberately narrower
// than the other three.
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
}: {
  label: string;
  value: string;
  footnote: string;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-2 rounded-lg border border-border p-5"
    >
      <span className="text-tag text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{footnote}</span>
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

export function OverviewTiles({
  waitingOnYouCount,
  pagesReadyCount,
  pagesTotalCount,
  daysToLaunch,
  launchConfidence,
}: {
  waitingOnYouCount: number;
  pagesReadyCount: number;
  pagesTotalCount: number;
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
        value={String(waitingOnYouCount)}
        footnote={
          waitingOnYouCount === 0
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
      {/* AS-031's own neighbour rule for this feature: never a fabricated
          figure. Hours used has no real source until F019 (M4) -- this
          tile's value/footnote are hard-coded, not derived from any
          prop, so there is no way a future edit could accidentally wire
          a guessed number through here. */}
      <Tile
        testId="tile-hours-used"
        label="Hours used"
        value="—"
        footnote="Available with the next release"
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
