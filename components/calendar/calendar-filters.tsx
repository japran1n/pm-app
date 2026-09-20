"use client";

// F235 (AS-448): the calendar's own filter controls -- status, priority,
// assignee, project -- bound to the SAME URL-search-params pattern
// `<ListFilters>` (components/task/list-filters.tsx, F054) already
// established, rather than a second parallel filter-state mechanism.
// This is a distinct component (not `<ListFilters>` reused verbatim)
// because the calendar's status/project options are workspace-wide
// (`getWorkspaceStatusOptions`/`getWorkspaceProjects`, real column NAMES
// across every visible project -- see lib/queries/calendar.ts's own
// cross-project doc comment) and it adds a project filter `<ListFilters>`
// has no concept of; the underlying "Select writes into the URL via
// router.push, 'no filter' = param absent" mechanics are copied
// intentionally so the two controls behave identically to a user moving
// between the List view and the calendar.
//
// Changing a filter preserves the current `?month=` (this component only
// ever adds/removes its OWN four keys, never touches `month`), and
// changing month (month-grid.tsx's own Links) preserves whichever filters
// are active -- both directions of "filters persist across navigation"
// this feature's Draft scope calls for.

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
import { UserAvatar } from "@/components/user-avatar";

const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "backlog", label: "Backlog" },
];

export type CalendarStatusOptionProp = {
  value: string;
  label: string;
  color?: string | null;
};

export type CalendarProjectOptionProp = {
  value: string;
  label: string;
};

export type CalendarAssigneeOptionProp = {
  id: string;
  label: string;
  avatarUrl?: string | null;
};

const ALL_VALUE = "__all__";

const PRIORITY_LABELS: Record<string, string> = {
  [ALL_VALUE]: "All priorities",
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  backlog: "Backlog",
};

export function CalendarFilters({
  statusOptions,
  projectOptions,
  assigneeOptions,
}: {
  statusOptions: CalendarStatusOptionProp[];
  projectOptions: CalendarProjectOptionProp[];
  assigneeOptions: CalendarAssigneeOptionProp[];
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

  const projectLabels = useMemo(() => {
    const labels: Record<string, string> = { [ALL_VALUE]: "All projects" };
    for (const option of projectOptions) {
      labels[option.value] = option.label;
    }
    return labels;
  }, [projectOptions]);

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

  const status = searchParams.get("status") ?? ALL_VALUE;
  const priority = searchParams.get("priority") ?? ALL_VALUE;
  const assigneeId = searchParams.get("assigneeId") ?? ALL_VALUE;
  const projectId = searchParams.get("projectId") ?? ALL_VALUE;

  const hasActiveFilters = useMemo(
    () =>
      status !== ALL_VALUE ||
      priority !== ALL_VALUE ||
      assigneeId !== ALL_VALUE ||
      projectId !== ALL_VALUE,
    [status, priority, assigneeId, projectId],
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
    // The month itself is the one param this control never owns -- it's
    // preserved across "Clear filters" the same way it's preserved
    // across any single filter change.
    const params = new URLSearchParams(searchParams.toString());
    params.delete("status");
    params.delete("priority");
    params.delete("assigneeId");
    params.delete("projectId");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }, [pathname, router, searchParams]);

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="calendar-filters">
      <Select value={projectId} onValueChange={(value) => setParam("projectId", value)}>
        <SelectTrigger size="sm" className="w-40" aria-label="Filter by project">
          <SelectValue placeholder="Project">
            {(value: string) => projectLabels[value] ?? value}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>All projects</SelectItem>
          {projectOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={status} onValueChange={(value) => setParam("status", value)}>
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

      <Select value={priority} onValueChange={(value) => setParam("priority", value)}>
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

      <Select value={assigneeId} onValueChange={(value) => setParam("assigneeId", value)}>
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
                  person={{ id: option.id, name: option.label, avatarUrl: option.avatarUrl }}
                  size="sm"
                />
                {option.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

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
