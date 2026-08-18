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

const STATUS_OPTIONS: { value: string; label: string }[] = [
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
};

const ALL_VALUE = "__all__";

export function ListFilters({
  assigneeOptions,
}: {
  assigneeOptions: AssigneeOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const status = searchParams.get("status") ?? ALL_VALUE;
  const priority = searchParams.get("priority") ?? ALL_VALUE;
  const assigneeId = searchParams.get("assigneeId") ?? ALL_VALUE;

  const hasActiveFilters = useMemo(
    () =>
      status !== ALL_VALUE || priority !== ALL_VALUE || assigneeId !== ALL_VALUE,
    [status, priority, assigneeId],
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

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={status}
        onValueChange={(value) => setParam("status", value)}
      >
        <SelectTrigger size="sm" className="w-36" aria-label="Filter by status">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>All statuses</SelectItem>
          {STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={priority}
        onValueChange={(value) => setParam("priority", value)}
      >
        <SelectTrigger size="sm" className="w-36" aria-label="Filter by priority">
          <SelectValue placeholder="Priority" />
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
          <SelectValue placeholder="Assignee" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>All assignees</SelectItem>
          {assigneeOptions.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
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
