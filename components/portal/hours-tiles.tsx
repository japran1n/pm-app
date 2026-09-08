// F019 (missions/20260903-portal, AS-034): the Hours view's four tiles --
// Used, Remaining, This week, Against plan -- same shared `Tile`
// primitive shape overview-tiles.tsx (F006) already established
// ("identical objects... read as one family at a glance"), a new copy
// here rather than importing that file's own local (unexported) `Tile`
// since this view's tiles need a signed value with a status token, which
// overview-tiles.tsx's tiles never do.
//
// F085 (missions/20260903-portal audit, defect 3): Remaining used to
// clamp a negative balance to 0 (`Math.max(remainingMinutes, 0)`) and
// keep the footnote "Of the current budget" -- a client 12 hours over
// budget saw the exact same tile as a client precisely at 0, with no
// number, no instruction, and no way to respond. Remaining now shows the
// real overage ("+2.0h Over the budget") when negative, and the tile
// gains a status icon (never colour alone, per this codebase's own
// convention -- see e.g. status-pill.tsx) plus one line naming what
// happens next.
import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";

function Tile({
  label,
  value,
  valueClassName,
  footnote,
  note,
  testId,
  overBudget,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  footnote: string;
  note?: string;
  testId: string;
  overBudget?: boolean;
}) {
  return (
    <div
      data-testid={testId}
      data-over-budget={overBudget ? "true" : "false"}
      className="flex flex-col gap-2 rounded-lg border border-border p-5"
    >
      <span className="flex items-center gap-1.5 text-tag text-muted-foreground">
        {overBudget && (
          <AlertTriangle
            aria-hidden="true"
            className="size-3.5 shrink-0 text-status-blocked"
          />
        )}
        {label}
      </span>
      <span className={cn("title-2 font-semibold tracking-tight tabular-nums", valueClassName)}>
        {value}
      </span>
      <span className="text-micro text-muted-foreground">
        {footnote}
        {overBudget && <span className="sr-only"> (over budget)</span>}
      </span>
      {note && <span className="text-micro text-status-blocked">{note}</span>}
    </div>
  );
}

function minutesToHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

export function HoursTiles({
  usedMinutes,
  soldMinutes,
  thisWeekMinutes,
  againstPlanMinutes,
}: {
  usedMinutes: number;
  /** `null` when no budget has been set yet -- Remaining and Against
   * plan both render an honest "—" rather than a number computed
   * against a budget that does not exist. */
  soldMinutes: number | null;
  thisWeekMinutes: number;
  /** Used minus planned at the current point in the observed period.
   * `null` when there is no budget (no planned curve to compare
   * against). Negative means under plan, positive means over. */
  againstPlanMinutes: number | null;
}) {
  const remainingMinutes = soldMinutes === null ? null : soldMinutes - usedMinutes;
  const isOverBudget = remainingMinutes !== null && remainingMinutes < 0;
  // F085 (defect 3): "Against plan" measures PACE (used vs. planned at
  // this point in the period), not the overrun against the whole budget
  // -- the two can disagree (a client can be over budget but under the
  // planned pace, or vice versa), so this tile's own over/under state
  // stays keyed to `remainingMinutes`, never to `againstPlanMinutes`.
  const isOverPlan = againstPlanMinutes !== null && againstPlanMinutes > 0;

  return (
    <div data-testid="hours-tiles" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Tile testId="tile-hours-used" label="Used" value={minutesToHours(usedMinutes)} footnote="Billable hours logged" />
      <Tile
        testId="tile-hours-remaining"
        label="Remaining"
        overBudget={isOverBudget}
        value={
          remainingMinutes === null
            ? "—"
            : isOverBudget
              ? `+${minutesToHours(Math.abs(remainingMinutes))}`
              : minutesToHours(remainingMinutes)
        }
        valueClassName={isOverBudget ? "text-status-blocked" : undefined}
        footnote={
          soldMinutes === null
            ? "No budget set yet"
            : isOverBudget
              ? "Over the budget"
              : "Of the current budget"
        }
        note={
          isOverBudget
            ? "The team will be in touch about a revised budget before logging further billable time."
            : undefined
        }
      />
      <Tile
        testId="tile-hours-this-week"
        label="This week"
        value={minutesToHours(thisWeekMinutes)}
        footnote="Billable hours this week"
      />
      <Tile
        testId="tile-hours-against-plan"
        label="Against plan"
        overBudget={isOverPlan}
        value={
          againstPlanMinutes === null
            ? "—"
            : `${againstPlanMinutes > 0 ? "+" : ""}${minutesToHours(againstPlanMinutes)}`
        }
        valueClassName={
          againstPlanMinutes === null
            ? undefined
            : isOverPlan
              ? "text-status-blocked"
              : "text-status-done"
        }
        footnote={
          againstPlanMinutes === null
            ? "No budget set yet"
            : isOverPlan
              ? "Over the planned pace"
              : "On or under the planned pace"
        }
      />
    </div>
  );
}
