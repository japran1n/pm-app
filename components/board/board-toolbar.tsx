"use client";

// F224 (AS-418, AS-419): the board's grouping control -- a single Select
// that writes the chosen value into the URL's `groupBy` query param, the
// same "URL search params for anything shareable" pattern this feature's
// Clarified implementation calls for and list-filters.tsx (F054) already
// established for this board's List-view sibling. `groupBy` absent from
// the URL (the default, first-visit state) means "no grouping" (AS-419) --
// Board reads the same absent-vs-"none" convention, so a shared/bookmarked
// board URL with no `groupBy` renders identically to today, byte for byte.

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SWIMLANE_GROUP_BY_VALUES,
  type SwimlaneGroupBy,
} from "@/lib/board/grouping";
import { upsertBoardSwimlanePrefs } from "@/lib/actions/board-prefs";

const GROUP_BY_LABELS: Record<SwimlaneGroupBy, string> = {
  none: "No grouping",
  assignee: "Assignee",
  priority: "Priority",
  tag: "Tag",
};

export function BoardToolbar({
  groupBy,
  projectId,
}: {
  groupBy: SwimlaneGroupBy;
  /** F226 (AS-424): required to persist the chosen grouping per user per
   * project -- optional only so an existing/future caller rendering
   * `<BoardToolbar>` without it (e.g. a not-yet-updated test) still works,
   * just without persistence, matching this codebase's other optional-prop
   * fallback convention. */
  projectId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(value: string | null) {
    if (!value) return;
    const params = new URLSearchParams(searchParams.toString());
    if (value === "none") {
      params.delete("groupBy");
    } else {
      params.set("groupBy", value);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);

    // F226 (AS-424): persist the new grouping choice per user per project
    // -- fire-and-forget, same "optimistic, no blocking spinner" posture
    // as every other board mutation; the URL is already the source of
    // truth for THIS session/tab, this call is purely so the NEXT
    // session/reload starts from the same choice instead of "none".
    if (projectId) {
      void upsertBoardSwimlanePrefs({
        projectId,
        groupBy: value as SwimlaneGroupBy,
      });
    }
  }

  return (
    <Select value={groupBy} onValueChange={handleChange}>
      <SelectTrigger className="w-40" aria-label="Group board by">
        <SelectValue placeholder="No grouping" />
      </SelectTrigger>
      <SelectContent>
        {SWIMLANE_GROUP_BY_VALUES.map((value) => (
          <SelectItem key={value} value={value}>
            {GROUP_BY_LABELS[value]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
