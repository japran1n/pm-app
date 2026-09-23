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
import { cn } from "@/lib/utils";
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

export function TeamHoursView({
  entries,
  people,
  budget,
  canManage,
}: {
  entries: TeamHoursEntry[];
  people: Record<string, string>;
  budget: ProjectBudget | null;
  canManage: boolean;
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
                <BucketRow
                  key={userId}
                  label={people[userId] ?? userId}
                  total={bucket.total}
                  billable={bucket.billable}
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
