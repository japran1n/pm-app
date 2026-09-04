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

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setTimeEntryCategory } from "@/lib/actions/time-entries";
import type { WorkCategory } from "@/lib/validation/time-entries";
import type { TeamHoursEntry } from "@/lib/queries/hours";
import type { ProjectBudget } from "@/lib/queries/project-budgets";
import { formatDuration } from "@/lib/time/format-duration";
import { Badge } from "@/components/ui/badge";
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

  return (
    <div className="flex flex-col gap-8">
      {budget && (
        <div className="rounded-md border border-border/60 p-3 text-sm">
          <span className="font-medium">
            {minutesToHoursLabel(billableMinutes)} of {minutesToHoursLabel(budget.soldMinutes)} sold
            hours used
          </span>
          <span className="ml-2 text-muted-foreground">
            ({Math.round((billableMinutes / budget.soldMinutes) * 100)}%)
          </span>
        </div>
      )}

      <section className="flex flex-col gap-2" aria-label="Hours by person">
        <h2 className="text-sm font-semibold">By person</h2>
        {byPerson.size === 0 ? (
          <p className="text-sm text-muted-foreground">No time logged in this period.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {Array.from(byPerson.entries()).map(([userId, bucket]) => (
              <li key={userId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{people[userId] ?? userId}</span>
                <span className="text-muted-foreground">{formatDuration(bucket.total)} total</span>
                <Badge variant="secondary" className="text-xs">
                  {formatDuration(bucket.billable)} client sees this
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label="Hours by category">
        <h2 className="text-sm font-semibold">By category</h2>
        {byCategory.size === 0 ? (
          <p className="text-sm text-muted-foreground">No time logged in this period.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {Array.from(byCategory.entries()).map(([key, bucket]) => (
              <li key={key} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">
                  {categoryLabel(key === "__uncategorised__" ? null : key)}
                </span>
                <span className="text-muted-foreground">{formatDuration(bucket.total)} total</span>
                <Badge variant="secondary" className="text-xs">
                  {formatDuration(bucket.billable)} client sees this
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-label="All time entries">
        <h2 className="text-sm font-semibold">All entries ({formatDuration(totalMinutes)})</h2>
        {localEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No time logged in this period.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {localEntries.map((entry) => (
              <li
                key={entry.entryId}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 p-2 text-sm"
              >
                <span className="font-medium">{people[entry.userId] ?? entry.userId}</span>
                <span className="text-muted-foreground">{entry.taskTitle}</span>
                <span className="text-muted-foreground">{formatDuration(entry.minutes)}</span>
                <Badge variant="secondary" className="text-xs">
                  {entry.billable ? "Billable · client sees this" : "Non-billable"}
                </Badge>
                <span className="text-xs text-muted-foreground">{entry.entryDate}</span>
                <div className="ml-auto">
                  <CategoryCell
                    entryId={entry.entryId}
                    workCategory={entry.workCategory}
                    canManage={canManage}
                    onChanged={handleCategoryChanged}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
