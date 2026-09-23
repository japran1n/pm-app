"use client";

// F018 (missions/20260903-portal): the team hours view's interactive
// surface (AS-038). Renders three groupings from the same
// `TeamHoursEntry[]` prop -- by person, by category, and the raw entry
// list -- so nothing here can disagree with itself about the total.
// "Client-visible subset marked": every row/bucket that includes only
// billable minutes is labelled "Client sees this", matching
// project_hours_client's own billable-only filter exactly (see the page
// component's doc comment for why billable IS client-visible here).
//
// Category editing: only the entry's `workCategory` is editable from
// here, via setTimeEntryCategory (F018) -- a narrower, non-author-gated
// action than editTimeEntry, so a PM can categorise someone else's old
// null-category entries without needing full edit rights over their
// minutes/note/date (AS-169 stays untouched). `canManage` gates whether
// the select is interactive; the action itself independently re-checks
// (same "hiding the control is the UX half" convention this mission uses
// everywhere else).
//
// Visual redesign (internal Hours tab, "make it clearer/cleaner"): same
// data and props as before, restructured for hierarchy --
//   1. a single prominent budget-usage stat + progress bar up top
//      (Card, using components/ui/card + components/ui/progress, this
//      codebase's own primitives for exactly this "one number, then a
//      bar" pattern);
//   2. "By person" / "By category" as Card-bordered lists with a visible
//      divider between rows instead of a bare bulleted <ul>, so ten
//      people don't read as one dense paragraph;
//   3. "All entries" as a real Table (components/ui/table) instead of a
//      <ul> of bordered <li>s, so date/duration/category line up in
//      columns.
// This component is workspace-only (app/(workspace)/.../hours/page.tsx is
// its only caller) -- the portal's own Hours view
// (app/(portal)/.../hours/page.tsx) renders a structurally different set
// of components (HoursTiles/HoursBurndownChart/HoursByCategory, all under
// components/portal/), so this redesign has no effect on the portal.

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setTimeEntryCategory } from "@/lib/actions/time-entries";
import type { WorkCategory } from "@/lib/validation/time-entries";
import type { TeamHoursEntry } from "@/lib/queries/hours";
import type { ProjectBudget } from "@/lib/queries/project-budgets";
import { formatDuration } from "@/lib/time/format-duration";
import { formatTaskDate } from "@/lib/time/format-task-date";
import {
  computeAreaChartLayout,
  computePercentDelta,
  type DailyPoint,
} from "@/lib/hours/area-chart-layout";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress, ProgressTrack, ProgressIndicator } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CATEGORY_LABELS: Record<WorkCategory, string> = {
  design: "Design",
  development: "Development",
  content_seo: "Content / SEO",
  pm: "PM",
  qa: "QA",
};

const CATEGORY_VALUES = Object.keys(CATEGORY_LABELS) as WorkCategory[];

function categoryLabel(value: string | null): string {
  if (!value) return "Uncategorised";
  return CATEGORY_LABELS[value as WorkCategory] ?? value;
}

function minutesToHoursLabel(minutes: number): string {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function CategoryCell({
  entryId,
  workCategory,
  canManage,
  onChanged,
}: {
  entryId: string;
  workCategory: string | null;
  canManage: boolean;
  onChanged: (entryId: string, next: string | null) => void;
}) {
  const [isSaving, startSaveTransition] = useTransition();

  if (!canManage) {
    return <span className="text-sm">{categoryLabel(workCategory)}</span>;
  }

  return (
    <Select
      value={workCategory ?? "__uncategorised__"}
      disabled={isSaving}
      onValueChange={(value) => {
        const next = value === "__uncategorised__" ? null : (value as WorkCategory);
        startSaveTransition(async () => {
          const result = await setTimeEntryCategory(entryId, next);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          onChanged(entryId, result.data.workCategory);
        });
      }}
    >
      <SelectTrigger className="h-7 w-40 text-xs" aria-label="Work category">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__uncategorised__">Uncategorised</SelectItem>
        {CATEGORY_VALUES.map((value) => (
          <SelectItem key={value} value={value}>
            {CATEGORY_LABELS[value]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// F016 (TT-034): "By person" rows gain a visual bar sized relative to the
// person with the most logged time in this period, so a PM can eyeball
// who's carrying the hours without reading every number. Pure flex + a
// fixed-width div (no chart library, per this feature's spec) --
// same pattern as components/portal/hours-tiles.tsx's own plain-div
// primitives. Totals themselves are unchanged from the pre-existing
// BucketRow (still `formatDuration`, still billable badge), so TT-034's
// "totals unchanged" holds by construction.
function PersonBarRow({
  userId,
  name,
  total,
  billable,
  maxTotal,
}: {
  userId: string;
  name: string;
  total: number;
  billable: number;
  maxTotal: number;
}) {
  const barPercent = maxTotal > 0 ? Math.round((total / maxTotal) * 100) : 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <UserAvatar person={{ id: userId, name }} size="sm" />
        <span className="truncate text-sm font-medium">{name}</span>
        <div
          className="h-1.5 w-[140px] shrink-0 rounded-full bg-secondary"
          role="progressbar"
          aria-label={`${name} share of logged hours`}
          aria-valuenow={barPercent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-1.5 rounded-full bg-primary"
            style={{ width: `${barPercent}%` }}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-muted-foreground tabular-nums">
          {formatDuration(total)} total
        </span>
        <Badge variant="secondary" className="text-xs">
          <span className="font-mono">{formatDuration(billable)}</span> client sees this
        </Badge>
      </div>
    </div>
  );
}

function BucketRow({
  label,
  total,
  billable,
}: {
  label: string;
  total: number;
  billable: number;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-muted-foreground tabular-nums">
          {formatDuration(total)} total
        </span>
        <Badge variant="secondary" className="text-xs">
          <span className="font-mono">{formatDuration(billable)}</span> client sees this
        </Badge>
      </div>
    </div>
  );
}

// F015 (TT-032, TT-033): the "Total time worked" card -- a hand-rolled SVG
// area chart (no chart library, per TT-063) of daily logged minutes over
// the period, a % delta badge vs the immediately preceding period of the
// same length (omitted, not "0%", when there is no previous-period data --
// see computePercentDelta's own header), and a footer with the period
// start (formatTaskDate) and grand total (mono). Pure layout math lives in
// lib/hours/area-chart-layout.ts, same "layout function separate from
// rendering" convention hours-burndown-chart.tsx (F019) established, so
// the empty-state / no-NaN guarantee (TT-033) is testable independent of
// rendered SVG pixels.
function TotalTimeWorkedCard({
  dailyMinutes,
  totalMinutes,
  periodStart,
  previousPeriodMinutes,
}: {
  dailyMinutes: DailyPoint[];
  totalMinutes: number;
  periodStart: string;
  previousPeriodMinutes: number | null;
}) {
  const layout = computeAreaChartLayout(dailyMinutes);
  const delta = computePercentDelta(totalMinutes, previousPeriodMinutes);
  const hasData = dailyMinutes.some((d) => d.minutes > 0);

  return (
    <Card className="shadow-xs" data-testid="hours-total-time-worked">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Total time worked</CardTitle>
          {delta !== null && (
            <Badge
              variant="secondary"
              className={cn(
                "font-mono text-xs",
                delta >= 0 ? "text-[oklch(0.65_0.15_159)]" : "text-destructive",
              )}
              data-testid="hours-total-time-delta"
            >
              {delta >= 0 ? "+" : ""}
              {delta}%
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="font-mono text-3xl font-semibold tracking-tight tabular-nums">
          {formatDuration(totalMinutes)}
        </div>

        {!hasData ? (
          <p className="text-sm text-muted-foreground" data-testid="hours-total-time-empty">
            No time logged in this period.
          </p>
        ) : (
          <svg
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            width="100%"
            height={layout.height}
            role="presentation"
            className="block"
            data-testid="hours-total-time-chart"
          >
            <defs>
              <linearGradient id="total-time-worked-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
            </defs>

            {layout.areaPath && <path d={layout.areaPath} fill="url(#total-time-worked-fill)" />}
            {layout.linePath && (
              <path
                d={layout.linePath}
                fill="none"
                stroke="var(--primary)"
                strokeWidth={2}
                strokeLinecap="round"
              />
            )}

            {layout.lastPoint && (
              <g data-testid="hours-total-time-marker">
                <line
                  x1={layout.lastPoint.x}
                  x2={layout.lastPoint.x}
                  y1={layout.lastPoint.y}
                  y2={layout.height - 10}
                  stroke="var(--border)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <circle
                  cx={layout.lastPoint.x}
                  cy={layout.lastPoint.y}
                  r={3.5}
                  fill="var(--primary)"
                  stroke="var(--background)"
                  strokeWidth={1.5}
                />
              </g>
            )}
          </svg>
        )}

        <div className="flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <span>{formatTaskDate(periodStart)}</span>
          <span className="font-mono tabular-nums">{formatDuration(totalMinutes)} total</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function TeamHoursView({
  entries,
  people,
  budget,
  canManage,
  periodStart,
  previousPeriodMinutes = null,
}: {
  entries: TeamHoursEntry[];
  people: Record<string, string>;
  budget: ProjectBudget | null;
  canManage: boolean;
  /** "YYYY-MM-DD" start of the reporting period, for the Total time worked
   * card's footer (F015). Optional so existing callers/tests that predate
   * this feature don't need updating; falls back to the earliest entry
   * date, or today when there are no entries at all. */
  periodStart?: string;
  /** Same-length previous period's total minutes, for the % delta badge
   * (F015, TT-032). `null` (the default) omits the badge entirely --
   * never rendered as a fabricated "0%". */
  previousPeriodMinutes?: number | null;
}) {
  const [localEntries, setLocalEntries] = useState(entries);

  function handleCategoryChanged(entryId: string, next: string | null) {
    setLocalEntries((current) =>
      current.map((entry) => (entry.entryId === entryId ? { ...entry, workCategory: next } : entry)),
    );
  }

  const totalMinutes = localEntries.reduce((sum, e) => sum + e.minutes, 0);
  const billableMinutes = localEntries
    .filter((e) => e.billable)
    .reduce((sum, e) => sum + e.minutes, 0);

  const byPerson = new Map<string, { total: number; billable: number }>();
  const byCategory = new Map<string, { total: number; billable: number }>();

  for (const entry of localEntries) {
    const personBucket = byPerson.get(entry.userId) ?? { total: 0, billable: 0 };
    personBucket.total += entry.minutes;
    if (entry.billable) personBucket.billable += entry.minutes;
    byPerson.set(entry.userId, personBucket);

    const categoryKey = entry.workCategory ?? "__uncategorised__";
    const categoryBucket = byCategory.get(categoryKey) ?? { total: 0, billable: 0 };
    categoryBucket.total += entry.minutes;
    if (entry.billable) categoryBucket.billable += entry.minutes;
    byCategory.set(categoryKey, categoryBucket);
  }

  const maxPersonTotal = Math.max(0, ...Array.from(byPerson.values(), (b) => b.total));

  // F015 (TT-032): daily totals for the area chart, derived from the same
  // `localEntries` every other bucket above uses -- `entryDate` is already
  // on `TeamHoursEntry`, so no extra query/prop is needed for this and the
  // chart can never disagree with the card's own totalMinutes.
  const byDay = new Map<string, number>();
  for (const entry of localEntries) {
    byDay.set(entry.entryDate, (byDay.get(entry.entryDate) ?? 0) + entry.minutes);
  }
  const dailyMinutes = Array.from(byDay.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, minutes]) => ({ date, minutes }));
  const resolvedPeriodStart = periodStart ?? dailyMinutes[0]?.date ?? new Date().toISOString().slice(0, 10);

  const rawUsagePercent = budget
    ? Math.round((billableMinutes / budget.soldMinutes) * 100)
    : null;
  const usagePercent = rawUsagePercent !== null ? Math.min(100, rawUsagePercent) : null;
  const isOverBudget = budget !== null && billableMinutes > budget.soldMinutes;

  const nonBillableMinutes = totalMinutes - billableMinutes;
  const billablePercent = totalMinutes > 0 ? Math.round((billableMinutes / totalMinutes) * 100) : 0;
  const nonBillablePercent = totalMinutes > 0 ? Math.round((nonBillableMinutes / totalMinutes) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card className="shadow-xs" data-testid="hours-stat-total">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Total hours</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-2xl font-semibold tabular-nums">
              {formatDuration(totalMinutes)}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs" data-testid="hours-stat-billable">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Billable</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-2xl font-semibold tabular-nums">
              {formatDuration(billableMinutes)}
            </div>
            <div className="font-mono text-xs text-muted-foreground mt-1">
              {billablePercent}% of logged
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs" data-testid="hours-stat-non-billable">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Non-billable</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-2xl font-semibold tabular-nums">
              {formatDuration(nonBillableMinutes)}
            </div>
            <div className="font-mono text-xs text-muted-foreground mt-1">
              {nonBillablePercent}% of logged
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs" data-testid="hours-stat-budget">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Budget used</CardTitle>
          </CardHeader>
          <CardContent>
            {budget ? (
              <>
                <div className="font-mono text-2xl font-semibold tabular-nums">
                  {rawUsagePercent}%
                </div>
                <div className="font-mono text-xs text-muted-foreground mt-1">
                  {minutesToHoursLabel(billableMinutes)} of {minutesToHoursLabel(budget.soldMinutes)} sold hours used
                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No budget set</div>
            )}
          </CardContent>
        </Card>
      </div>

      <TotalTimeWorkedCard
        dailyMinutes={dailyMinutes}
        totalMinutes={totalMinutes}
        periodStart={resolvedPeriodStart}
        previousPeriodMinutes={previousPeriodMinutes}
      />

      {budget && (
        <Card data-testid="hours-budget-summary">
          <CardHeader>
            <CardTitle>Budget usage</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span
                className={cn(
                  "font-mono text-3xl font-semibold tracking-tight tabular-nums",
                  isOverBudget && "text-destructive",
                )}
              >
                {minutesToHoursLabel(billableMinutes)}
              </span>
              <span className="font-mono text-sm text-muted-foreground">
                of {minutesToHoursLabel(budget.soldMinutes)} sold hours used
                {isOverBudget && " · over budget"}
              </span>
            </div>
            <Progress value={usagePercent ?? 0}>
              <ProgressTrack className={cn(isOverBudget && "bg-destructive/15")}>
                <ProgressIndicator className={cn(isOverBudget && "bg-destructive")} />
              </ProgressTrack>
            </Progress>
            <span className="font-mono text-xs text-muted-foreground">{rawUsagePercent}% of budget</span>
          </CardContent>
        </Card>
      )}

      <Card aria-label="Hours by person">
        <CardHeader>
          <CardTitle>By person</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {byPerson.size === 0 ? (
            <p className="px-4 text-sm text-muted-foreground">No time logged in this period.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border/60 border-t border-border/60">
              {Array.from(byPerson.entries()).map(([userId, bucket]) => (
                <PersonBarRow
                  key={userId}
                  userId={userId}
                  name={people[userId] ?? userId}
                  total={bucket.total}
                  billable={bucket.billable}
                  maxTotal={maxPersonTotal}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card aria-label="Hours by category">
        <CardHeader>
          <CardTitle>By category</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {byCategory.size === 0 ? (
            <p className="px-4 text-sm text-muted-foreground">No time logged in this period.</p>
          ) : (
            <div className="flex flex-col divide-y divide-border/60 border-t border-border/60">
              {Array.from(byCategory.entries()).map(([key, bucket]) => (
                <BucketRow
                  key={key}
                  label={categoryLabel(key === "__uncategorised__" ? null : key)}
                  total={bucket.total}
                  billable={bucket.billable}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card aria-label="All time entries">
        <CardHeader>
          <CardTitle>All entries (<span className="font-mono">{formatDuration(totalMinutes)}</span>)</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {localEntries.length === 0 ? (
            <p className="px-4 text-sm text-muted-foreground">No time logged in this period.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Billing</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {localEntries.map((entry) => (
                  <TableRow key={entry.entryId} data-testid="hours-entry-row">
                    <TableCell className="font-medium whitespace-normal">
                      {people[entry.userId] ?? entry.userId}
                    </TableCell>
                    <TableCell className="max-w-60 whitespace-normal text-muted-foreground">
                      {entry.taskTitle}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">{formatDuration(entry.minutes)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {entry.billable ? "Billable · client sees this" : "Non-billable"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{entry.entryDate}</TableCell>
                    <TableCell>
                      <CategoryCell
                        entryId={entry.entryId}
                        workCategory={entry.workCategory}
                        canManage={canManage}
                        onChanged={handleCategoryChanged}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
