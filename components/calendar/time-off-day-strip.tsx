// Team PTO calendar: renders one day column's PTO strip -- a small
// "🏖️ [Name] - odmor" badge per entry covering that day, per this
// feature's own spec wording. A pure presentation piece (Server
// Component -- no hooks/state), matching week-view.tsx/week-time-grid.tsx's
// own Server/Client split: only the delete affordance needs interactivity,
// which is delegated to <TimeOffDeleteButton> (a small Client Component)
// so this file itself stays server-renderable.

import type { TimeOffEntry } from "@/lib/queries/time-off";
import { TimeOffDeleteButton } from "@/components/calendar/time-off-delete-button";

export function TimeOffDayStrip({ entries }: { entries: TimeOffEntry[] }) {
  if (entries.length === 0) {
    return <div />;
  }

  return (
    <div className="flex flex-col gap-0.5 px-1 py-0.5" data-testid="time-off-day-strip">
      {entries.map((entry) => {
        const who = entry.userName ?? entry.userEmail ?? "Someone";
        const label = entry.note ? `${who} — ${entry.note}` : `${who} — time off`;
        return (
          <div
            key={entry.id}
            className="flex items-center gap-1 truncate rounded bg-status-waiting-bg px-1 py-0.5 text-[10px] text-status-waiting"
            data-testid="time-off-entry"
            title={label}
          >
            <span aria-hidden="true">🏖️</span>
            <span className="truncate">{label}</span>
            <TimeOffDeleteButton entryId={entry.id} />
          </div>
        );
      })}
    </div>
  );
}
