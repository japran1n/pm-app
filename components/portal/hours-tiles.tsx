// F019 (missions/20260903-portal, AS-034): the Hours view's four tiles --
// Used, Remaining, This week, Against plan -- same shared `Tile`
// primitive shape overview-tiles.tsx (F006) already established
// ("identical objects... read as one family at a glance"), a new copy
// here rather than importing that file's own local (unexported) `Tile`
// since this view's tiles need a signed value with a status token, which
// overview-tiles.tsx's tiles never do.
import { cn } from "@/lib/utils";

function Tile({
  label,
  value,
  valueClassName,
  footnote,
  testId,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  footnote: string;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-2 rounded-lg border border-border p-5"
    >
      <span className="text-tag text-muted-foreground">{label}</span>
      <span className={cn("text-2xl font-semibold tracking-tight tabular-nums", valueClassName)}>
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{footnote}</span>
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

  return (
    <div data-testid="hours-tiles" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Tile testId="tile-hours-used" label="Used" value={minutesToHours(usedMinutes)} footnote="Billable hours logged" />
      <Tile
        testId="tile-hours-remaining"
        label="Remaining"
        value={remainingMinutes === null ? "—" : minutesToHours(Math.max(remainingMinutes, 0))}
        footnote={soldMinutes === null ? "No budget set yet" : "Of the current budget"}
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
        value={
          againstPlanMinutes === null
            ? "—"
            : `${againstPlanMinutes > 0 ? "+" : ""}${minutesToHours(againstPlanMinutes)}`
        }
        valueClassName={
          againstPlanMinutes === null
            ? undefined
            : againstPlanMinutes > 0
              ? "text-status-waiting"
              : "text-status-done"
        }
        footnote={
          againstPlanMinutes === null
            ? "No budget set yet"
            : againstPlanMinutes > 0
              ? "Over the planned pace"
              : "On or under the planned pace"
        }
      />
    </div>
  );
}
