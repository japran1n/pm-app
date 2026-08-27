"use client";

// F054 (AS-086, AS-087, AS-088, AS-089, AS-090): filter controls for the
// project List view — status, priority, and assignee, plus a "Clear
// filters" button.
//
// Smallest possible client boundary (clarified spec): the list page
// itself stays a Server Component that reads `searchParams` and passes
// filtered rows to <TaskListTable>; this component only owns the
// interactive Selects and writes the chosen values into the URL's query
// string via `useRouter`/`useSearchParams` (standard Next.js pattern).
// That round-trip through the URL — rather than local component state —
// is what makes the Server Component re-fetch with the new filters, and
// is also what makes the filtered view shareable/bookmarkable per the
// feature's own requirement.
//
// Each Select is single-select (not multi): AS-086/087/088 only require
// "can be filtered by status/priority/assignee", not "by a set of
// statuses", and a single value per filter keeps the URL shape trivial
// (`?status=todo&priority=high&assigneeId=...`) and the AND-combination
// behaviour (AS-089) unambiguous — no in-filter OR semantics to design.
// Documented here and in the handoff per the spec's "your call — document"
// instruction.
//
// "No filter" is represented by the query param being absent entirely
// (not present with an empty value), so `router.push` with a key deleted
// from the params is what narrows back toward "no constraint" one filter
// at a time, and the Clear button removes all three at once (AS-090).

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
// F122 (AS-214): "assignee pickers" includes this filter's assignee
// Select.
import { UserAvatar } from "@/components/user-avatar";

// F223 (AS-411): this used to be a fixed four-value list — a project
// whose board columns had been renamed/added-to (F219/F221) had no way
// to filter the List view by its own real column names. Callers that
// know their real columns (the project List page, via
// lib/queries/statuses.ts's getProjectColumns) now pass `statusOptions`
// in; this fixed list only remains as the fallback for callers that
// don't have a single project's columns to hand (the workspace-wide
// dashboard task table, which spans multiple projects with potentially
// different column sets — see this feature's handoff "Out-of-scope work
// needed" for why that surface isn't fixed by this feature).
const DEFAULT_STATUS_OPTIONS: { value: string; label: string; color?: string }[] = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "in_review", label: "In Review" },
  { value: "done", label: "Done" },
];

const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "backlog", label: "Backlog" },
];

export type AssigneeOption = {
  /** auth user id — matches `tasks.assignee_id`. */
  id: string;
  label: string;
  avatarUrl?: string | null;
};

const ALL_VALUE = "__all__";

// Bug fix: base-ui's <Select.Value> only resolves a human-readable label
// from a matching <SelectItem> that is actually mounted in the DOM — but
// <SelectContent>'s items live inside a lazily-mounted Portal/Positioner
// that isn't rendered until the popup is opened. On first paint (and any
// time the popup hasn't been opened yet), nothing is mounted for it to
// read a label from, so it falls back to printing the raw `value` string
// verbatim — visibly showing "__all__" instead of "All statuses" etc. The
// fix is to give <Select.Value> an explicit children render-function
// (documented in its own type as the supported way to format the selected
// value) that maps a value to its label itself, instead of relying on
// label lookup from mounted item DOM.
const PRIORITY_LABELS: Record<string, string> = {
  [ALL_VALUE]: "All priorities",
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  backlog: "Backlog",
};

export function ListFilters({
  assigneeOptions,
  statusOptions = DEFAULT_STATUS_OPTIONS,
  taskTypeOptions = [],
}: {
  assigneeOptions: AssigneeOption[];
  /** F223 (AS-411): the project's real `project_statuses` columns, in
   * `position` order (lib/queries/statuses.ts's getProjectColumns),
   * passed in by the project List page. Falls back to the legacy fixed
   * four for callers without a single project's columns to hand. */
  statusOptions?: { value: string; label: string; color?: string }[];
  /** F434-F440: the workspace's task types (lib/queries/task-types.ts's
   * getTaskTypes), in `position` order. Defaults to empty so a caller
   * that hasn't been updated (existing tests) renders with no type
   * filter rather than crashing — and a workspace with zero task types
   * defined yet correctly shows no filter for a taxonomy that doesn't
   * exist. */
  taskTypeOptions?: { value: string; label: string; color?: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const statusLabels = useMemo(() => {
    const labels: Record<string, string> = { [ALL_VALUE]: "All statuses" };
    for (const option of statusOptions) {
      labels[option.value] = option.label;
    }
    return labels;
  }, [statusOptions]);

  const status = searchParams.get("status") ?? ALL_VALUE;
  const priority = searchParams.get("priority") ?? ALL_VALUE;
  const assigneeId = searchParams.get("assigneeId") ?? ALL_VALUE;
  const taskTypeId = searchParams.get("taskTypeId") ?? ALL_VALUE;

  const taskTypeLabels = useMemo(() => {
    const labels: Record<string, string> = { [ALL_VALUE]: "All types" };
    for (const option of taskTypeOptions) {
      labels[option.value] = option.label;
    }
    return labels;
  }, [taskTypeOptions]);
  // UX-20: the dashboard's KPI tiles write `?flag=` (overdue/due_soon/
  // blocked/completed) — a filter this component didn't create and has no
  // Select for, but it's still an active constraint on the list below, so
  // it counts toward "Clear filters" showing up and gets its own dismiss
  // chip. Always empty for the project List view, which never sets it.
  const flag = searchParams.get("flag");
  const flagLabels: Record<string, string> = {
    overdue: "Overdue",
    due_soon: "Due soon",
    blocked: "Blocked",
    completed: "Completed recently",
  };

  const hasActiveFilters = useMemo(
    () =>
      status !== ALL_VALUE ||
      priority !== ALL_VALUE ||
      assigneeId !== ALL_VALUE ||
      taskTypeId !== ALL_VALUE ||
      Boolean(flag),
    [status, priority, assigneeId, taskTypeId, flag],
  );

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== ALL_VALUE) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [pathname, router, searchParams],
  );

  const clearFilters = useCallback(() => {
    router.push(pathname);
  }, [pathname, router]);

  const assigneeLabels = useMemo(() => {
    const labels: Record<string, string> = { [ALL_VALUE]: "All assignees" };
    for (const option of assigneeOptions) {
      labels[option.id] = option.label;
    }
    return labels;
  }, [assigneeOptions]);

  const assigneeAvatarUrls = useMemo(() => {
    const urls: Record<string, string | null> = {};
    for (const option of assigneeOptions) {
      urls[option.id] = option.avatarUrl ?? null;
    }
    return urls;
  }, [assigneeOptions]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={status}
        onValueChange={(value) => setParam("status", value)}
      >
        <SelectTrigger size="sm" className="w-36" aria-label="Filter by status">
          <SelectValue placeholder="Status">
            {(value: string) => statusLabels[value] ?? value}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>All statuses</SelectItem>
          {statusOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex items-center gap-1.5">
                {option.color && (
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: option.color }}
                  />
                )}
                {option.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={priority}
        onValueChange={(value) => setParam("priority", value)}
      >
        <SelectTrigger size="sm" className="w-36" aria-label="Filter by priority">
          <SelectValue placeholder="Priority">
            {(value: string) => PRIORITY_LABELS[value] ?? value}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>All priorities</SelectItem>
          {PRIORITY_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={assigneeId}
        onValueChange={(value) => setParam("assigneeId", value)}
      >
        <SelectTrigger size="sm" className="w-40" aria-label="Filter by assignee">
          <SelectValue placeholder="Assignee">
            {(value: string) => (
              <span className="flex items-center gap-2">
                {value !== ALL_VALUE && (
                  <UserAvatar
                    person={{
                      id: value,
                      name: assigneeLabels[value] ?? value,
                      avatarUrl: assigneeAvatarUrls[value] ?? null,
                    }}
                    size="sm"
                  />
                )}
                {assigneeLabels[value] ?? value}
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>All assignees</SelectItem>
          {assigneeOptions.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              <span className="flex items-center gap-2">
                <UserAvatar
                  person={{
                    id: option.id,
                    name: option.label,
                    avatarUrl: option.avatarUrl,
                  }}
                  size="sm"
                />
                {option.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {taskTypeOptions.length > 0 && (
        <Select
          value={taskTypeId}
          onValueChange={(value) => setParam("taskTypeId", value)}
        >
          <SelectTrigger size="sm" className="w-36" aria-label="Filter by task type">
            <SelectValue placeholder="Type">
              {(value: string) => taskTypeLabels[value] ?? value}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>All types</SelectItem>
            {taskTypeOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span className="flex items-center gap-1.5">
                  {option.color && (
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: option.color }}
                    />
                  )}
                  {option.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {flag && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setParam("flag", null)}
          aria-label={`Remove ${flagLabels[flag] ?? flag} filter`}
        >
          {flagLabels[flag] ?? flag}
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      )}

      {hasActiveFilters && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={clearFilters}
          aria-label="Clear filters"
        >
          <X className="size-3.5" aria-hidden="true" />
          Clear filters
        </Button>
      )}
    </div>
  );
}
