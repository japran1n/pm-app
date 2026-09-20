// Team PTO calendar: the read path -- every PTO entry visible to the
// caller in `workspaceId` whose [start_date, end_date] range overlaps the
// requested [rangeStart, rangeEndExclusive) window, RLS-scoped exactly
// like getCalendarBlocks (lib/queries/calendar-blocks.ts): the plain
// session client only, never createAdminClient(), since
// `time_off_entries_select_active_members`'s own is_active_workspace_member
// predicate is the real enforcement boundary (every active workspace
// member sees every PTO entry -- team transparency is the point).
//
// Range overlap (not containment), same reasoning as getCalendarBlocks:
// a PTO period that starts before the window and ends inside it (or spans
// the whole window) must still appear. Dates are DateOnly strings
// ("YYYY-MM-DD"), never full ISO timestamps -- PTO has no time-of-day.

import "server-only";

import { createClient } from "@/lib/supabase/server";
import { resolvePeople } from "@/lib/queries/people";

export type TimeOffEntry = {
  id: string;
  workspaceId: string;
  userId: string;
  startDate: string;
  endDate: string;
  note: string | null;
  userName: string | null;
  userEmail: string | null;
};

type TimeOffEntryRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  note: string | null;
};

/**
 * Every PTO entry visible to the caller in `workspaceId` overlapping
 * [rangeStartDate, rangeEndDateExclusive) -- both bounds are DateOnly
 * strings.
 */
export async function getTimeOffEntries(
  workspaceId: string,
  rangeStartDate: string,
  rangeEndDateExclusive: string,
): Promise<TimeOffEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("time_off_entries")
    .select("id, workspace_id, user_id, start_date, end_date, note")
    .eq("workspace_id", workspaceId)
    .lt("start_date", rangeEndDateExclusive)
    .gte("end_date", rangeStartDate)
    .order("start_date", { ascending: true });

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as TimeOffEntryRow[];
  const people = await resolvePeople(rows.map((row) => row.user_id));

  return rows.map((row) => {
    const person = people.get(row.user_id);
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      userId: row.user_id,
      startDate: row.start_date,
      endDate: row.end_date,
      note: row.note,
      userName: person?.name ?? null,
      userEmail: person?.email ?? null,
    };
  });
}
