// F108 (missions/20260903-portal, docs/client-portal-visual-plan.md 3.3):
// Overview's one-glance budget figure — a single horizontal bar, used
// against sold, with the ceiling marked and any overage drawn PAST that
// ceiling in the blocked token rather than clamped to it.
//
// `usedMinutes`/`soldMinutes` are the exact same numbers the Overview
// page already computes for the "Hours used" tile (`OverviewTiles`) and
// the Hours view's own burn-down chart (`getProjectHoursClient`) — this
// draws no second query, only a second PICTURE of the same read.
//
// F085 (missions/20260903-portal audit) fixed the clamp that used to hide
// an over-budget project's real numbers — `Meridian Ops Dashboard` in the
// demo data is deliberately over budget so this exact path renders with
// real data, not a synthetic fixture.
//
// One scale (minutes), never a dual axis: the track's own width IS the
// scale, `usedMinutes` and `soldMinutes` are both plotted against it, and
// the same scale continues past the ceiling for the overage segment
// rather than compressing it into a second, unlabelled unit.
import { cn } from "@/lib/utils";

function minutesToHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

export function BudgetBar({
  usedMinutes,
  soldMinutes,
}: {
  /** `null` means nothing has been logged yet this period — same "honest
   * dash, never a fabricated number" convention as every other Overview
   * read. */
  usedMinutes: number | null;
  /** `null` means no budget has been set for this project at all. */
  soldMinutes: number | null;
}) {
  if (soldMinutes === null) {
    return (
      <div
        className="flex flex-col gap-2 rounded-lg border border-border p-5"
        data-testid="budget-bar-no-budget"
      >
        <h2 className="text-mini font-semibold text-foreground">Budget</h2>
        <p className="text-mini text-muted-foreground">No budget has been set for this project yet.</p>
      </div>
    );
  }

  const used = usedMinutes ?? 0;
  const isOverBudget = used > soldMinutes;

  // The scale extends past the ceiling by a fixed 15% headroom so the
  // ceiling mark always sits somewhere inside the track (never flush
  // against the right edge, which would read as "the end" rather than
  // "the limit") — and, on the over-budget path, extends far enough past
  // the ceiling to actually fit the overage segment rather than
  // squeezing it into that same fixed headroom.
  const headroom = soldMinutes * 0.15;
  const scaleMax = Math.max(soldMinutes + headroom, used + soldMinutes * 0.05);

  const ceilingPct = (soldMinutes / scaleMax) * 100;
  const inBudgetUsed = Math.min(used, soldMinutes);
  const inBudgetPct = (inBudgetUsed / scaleMax) * 100;
  const remainingToCeilingPct = Math.max(0, (soldMinutes - used) / scaleMax) * 100;
  const overagePct = isOverBudget ? ((used - soldMinutes) / scaleMax) * 100 : 0;

  const summary = isOverBudget
    ? `${minutesToHours(used)} used against a ${minutesToHours(soldMinutes)} budget — ${minutesToHours(used - soldMinutes)} over.`
    : `${minutesToHours(used)} used of a ${minutesToHours(soldMinutes)} budget.`;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-5" data-testid="budget-bar">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-mini font-semibold text-foreground">Budget</h2>
        <span
          className={cn(
            "text-micro font-medium tabular-nums",
            isOverBudget ? "text-status-blocked" : "text-muted-foreground",
          )}
          data-testid="budget-bar-summary"
        >
          {summary}
        </span>
      </div>

      {/* AS: named by its own title, single series (hours), no legend
          needed. Direct labels only where the value matters (the used
          figure and, when relevant, the overage) — never a number on
          every mark. */}
      <div
        role="img"
        aria-label={summary}
        title={summary}
        data-testid="budget-bar-track"
        className="relative h-3 w-full overflow-visible rounded-full bg-muted"
      >
        <div className="absolute inset-y-0 left-0 flex h-full w-full gap-0.5 overflow-hidden rounded-full">
          {/* In-budget used segment. */}
          <div
            aria-hidden="true"
            data-testid="budget-bar-used"
            className="h-full rounded-full bg-status-progress"
            style={{ width: `${inBudgetPct}%` }}
            title={`${minutesToHours(inBudgetUsed)} used`}
          />
          {/* Unused budget remaining, up to the ceiling. */}
          {remainingToCeilingPct > 0 && (
            <div
              aria-hidden="true"
              data-testid="budget-bar-remaining"
              className="h-full bg-transparent"
              style={{ width: `${remainingToCeilingPct}%` }}
              title={`${minutesToHours(Math.max(0, soldMinutes - used))} remaining`}
            />
          )}
        </div>

        {/* Ceiling mark: the budget's sold-hours limit, plotted on the
            same scale as everything else — never a second axis. */}
        <div
          aria-hidden="true"
          data-testid="budget-bar-ceiling"
          className="absolute inset-y-0 w-px bg-foreground/50"
          style={{ left: `${ceilingPct}%` }}
          title={`Budget ceiling · ${minutesToHours(soldMinutes)}`}
        />

        {/* Overage: drawn PAST the ceiling, in the blocked token, never
            clamped back inside it (F085's own fix — the clamp used to
            hide exactly this). */}
        {isOverBudget && (
          <div
            aria-hidden="true"
            data-testid="budget-bar-overage"
            className="absolute inset-y-0 rounded-r-full bg-status-blocked"
            style={{ left: `${ceilingPct}%`, width: `${overagePct}%` }}
            title={`${minutesToHours(used - soldMinutes)} over budget`}
          />
        )}
      </div>
    </div>
  );
}
