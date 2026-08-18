"use client";

// F055 (AS-091): clickable "Due date" column header that toggles between
// ascending and descending due-date sort, on top of the project List
// view's existing filters (F054) — same URL-param-driven pattern as
// <ListFilters>: this component only ever changes which `sort` value is
// present in the URL's query string via `useRouter`/`useSearchParams`,
// keeping the sorted view shareable/bookmarkable and letting the Server
// Component page re-fetch (already-filtered rows, now also sorted) on
// every click. It never sorts client-side.
//
// Toggle behaviour: no `sort` param or any other value -> click sets
// `due_date_asc`; `due_date_asc` -> click sets `due_date_desc`;
// `due_date_desc` -> click clears the param entirely (back to the
// default order), so a third click un-sorts rather than looping forever
// between only two states.

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import type { ProjectListTaskSort } from "@/lib/queries/tasks";

function nextSort(
  current: ProjectListTaskSort | undefined,
): ProjectListTaskSort | undefined {
  if (current === "due_date_asc") return "due_date_desc";
  if (current === "due_date_desc") return undefined;
  return "due_date_asc";
}

export function DueDateSortHeader({
  sort,
}: {
  sort: ProjectListTaskSort | undefined;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const toggleSort = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    const upcoming = nextSort(sort);
    if (upcoming) {
      params.set("sort", upcoming);
    } else {
      params.delete("sort");
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }, [pathname, router, searchParams, sort]);

  const Icon =
    sort === "due_date_asc"
      ? ArrowUp
      : sort === "due_date_desc"
        ? ArrowDown
        : ArrowUpDown;

  return (
    <button
      type="button"
      onClick={toggleSort}
      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
      aria-label={
        sort === "due_date_asc"
          ? "Sorted by due date ascending — click to sort descending"
          : sort === "due_date_desc"
            ? "Sorted by due date descending — click to clear sort"
            : "Sort by due date"
      }
    >
      Due date
      <Icon className="size-3.5" aria-hidden="true" />
    </button>
  );
}
