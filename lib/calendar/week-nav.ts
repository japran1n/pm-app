// F075 (AS-011): the actual call site page.tsx uses to build its
// previous/next/today navigation hrefs. Extracted out of page.tsx so it can
// be tested directly -- a mutation to this function (e.g. dropping
// `peopleParam`) now fails the F029 test suite instead of silently passing
// against a copy of the logic living in the test file.

import { buildWeekNavHref } from "@/lib/calendar/people-selection";

export function buildPlannerNavHrefs(params: {
  workspaceSlug: string;
  currentWeekKey: string;
  prevWeekKey: string;
  nextWeekKey: string;
  peopleParam: string | null | undefined;
}): { prevHref: string; nextHref: string; todayHref: string } {
  const { workspaceSlug, prevWeekKey, nextWeekKey, peopleParam } = params;

  return {
    prevHref: buildWeekNavHref({ workspaceSlug, weekKey: prevWeekKey, peopleParam }),
    nextHref: buildWeekNavHref({ workspaceSlug, weekKey: nextWeekKey, peopleParam }),
    todayHref: buildWeekNavHref({ workspaceSlug, peopleParam }),
  };
}
