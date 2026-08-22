"use client";

// F188 (AS-343..352): type filter (tasks vs comments) for the trash view,
// written into the URL's query string — same thin Client-Component-owns-
// the-Select pattern `components/audit/audit-filters.tsx` (F141) already
// established, per this feature's Clarified "URL search params for
// anything shareable" answer. The trash page itself stays a Server
// Component reading `searchParams` and re-filtering the already-fetched
// list.

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL_VALUE = "__all__";

const TYPE_LABELS: Record<string, string> = {
  [ALL_VALUE]: "All types",
  task: "Tasks",
  comment: "Comments",
};

export function TrashFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const type = searchParams.get("type") ?? ALL_VALUE;

  const setType = useCallback(
    (value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== ALL_VALUE) {
        params.set("type", value);
      } else {
        params.delete("type");
      }
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [pathname, router, searchParams],
  );

  return (
    <Select value={type} onValueChange={setType}>
      <SelectTrigger size="sm" className="w-40" aria-label="Filter by type">
        <SelectValue placeholder="Type">
          {(value: string) => TYPE_LABELS[value] ?? value}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>All types</SelectItem>
        <SelectItem value="task">Tasks</SelectItem>
        <SelectItem value="comment">Comments</SelectItem>
      </SelectContent>
    </Select>
  );
}
