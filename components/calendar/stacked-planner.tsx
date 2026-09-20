// F032: the stacked (2+ people) Planner layout -- one row per selected
// person, in `?people=` order (AS-063), each labelled with the member's
// name (AS-062). A selected person with no blocks in the visible week
// still gets their own row (AS-024) -- the empty row IS the signal a PM
// is looking for, per the feature's clarification notes.
//
// F033 fleshes out each row's body into the real per-person time-grid,
// clipped to the Mon-Fri 08:00-16:00 window via
// lib/calendar/stacked-window.ts.

import type { CalendarBlock } from "@/lib/queries/calendar-blocks";
import type { TimeOffEntry } from "@/lib/queries/time-off";
import type { SwitcherMember } from "@/lib/calendar/workspace-members";
import { StackedPersonRow } from "@/components/calendar/stacked-person-row";

export function StackedPlanner({
  selectedUserIds,
  blocksByUser,
  timeOffByUser,
  weekKey,
  members,
}: {
  selectedUserIds: string[];
  blocksByUser: Map<string, CalendarBlock[]>;
  /** F034 (AS-066): each user's approved time-off entries overlapping the
   * visible week -- `?? []` at the row means a person with none simply
   * renders no strip, same "empty map entry is not an error" posture
   * blocksByUser already uses. */
  timeOffByUser?: Map<string, TimeOffEntry[]>;
  weekKey: string;
  members: SwitcherMember[];
}) {
  // ONE lookup built once, not re-derived per row -- same "resolve once,
  // thread down" convention the rest of the calendar page follows.
  const membersById = new Map(members.map((m) => [m.userId, m]));

  return (
    <div data-testid="stacked-planner" className="flex flex-col gap-3">
      {/* AS-063: rows render in `selectedUserIds` order -- never re-sorted
          (e.g. alphabetically) -- so the order matches `?people=`. */}
      {selectedUserIds.map((userId) => {
        const member = membersById.get(userId);
        // AS-062: labelled with the member's name -- falls back to email,
        // then the raw id, so a row is never unlabelled even if the
        // member record is somehow incomplete.
        const userLabel = member?.name ?? member?.email ?? userId;

        return (
          <StackedPersonRow
            key={userId}
            userId={userId}
            userLabel={userLabel}
            // AS-024: a person with no entry in blocksByUser still gets a
            // row -- `?? []` never drops them.
            blocks={blocksByUser.get(userId) ?? []}
            timeOffEntries={timeOffByUser?.get(userId) ?? []}
            weekKey={weekKey}
          />
        );
      })}
    </div>
  );
}
