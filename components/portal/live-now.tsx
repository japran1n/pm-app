// F006 (missions/20260903-portal; P3, docs/client-portal-sixstar-plan.md):
// the right rail's "who's working on this right now" card.
//
// Renders nothing when nobody is currently working -- P3's own
// acceptance criteria is explicit that "kad niko ne radi, widget se ne
// renderuje" ("when nobody is working, the widget doesn't render"), not
// a "nobody is working right now" message, which reads as bad news
// rather than an absence of one.
//
// Never a duration: P3's own privacy boundary. This component has no
// `startedAt`/elapsed-time field to render even if it wanted to --
// `getPortalLiveNow` (lib/queries/portal.ts) never selects
// `active_timers.started_at` in the first place, so there is nothing to
// accidentally leak here.
import { Radio } from "lucide-react";

import { UserAvatar } from "@/components/user-avatar";
import type { PortalLiveNowEntry } from "@/lib/queries/portal";

export function LiveNow({ entries }: { entries: PortalLiveNowEntry[] }) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="live-now"
      className="flex flex-col gap-3 rounded-lg border border-border p-5"
    >
      <div className="flex items-center gap-2">
        <Radio aria-hidden="true" className="size-4 text-status-progress" />
        <h2 className="text-sm font-semibold">Live now</h2>
      </div>
      <ul className="flex flex-col gap-3">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-center gap-2">
            <UserAvatar
              person={{ id: entry.userId, name: entry.personName, avatarUrl: entry.avatarUrl }}
              size="sm"
            />
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-medium">
                {entry.personName ?? "Someone at the agency"}
              </span>
              <span className="truncate text-xs text-muted-foreground">{entry.label}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
