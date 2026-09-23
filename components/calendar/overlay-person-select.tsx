"use client";

// Planner overlay mode: a lightweight, URL-bound picker (mirrors
// `PeopleSwitcherUrlBound`'s own "state lives in the URL, never
// component/browser storage" convention) that lets the viewer choose ONE
// other workspace member whose blocks should be overlaid, split
// side-by-side within the SAME day columns as the signed-in member's own
// week-grid view -- see WeekTimeGrid's `overlayBlocksByDate` prop for the
// rendering half of this feature.
//
// Deliberately separate from the main `PeopleSwitcher`: that switcher
// drives WHO the Planner is showing at all (and switches the whole page
// into the stacked, one-row-per-person layout once 2+ people are picked --
// see `resolvePlannerLayout`). This picker only ever adds a second person's
// blocks ON TOP of the single-person week-grid view without leaving it, so
// it's its own `?overlay=` URL param rather than piggybacking on `?people=`.
//
// Only rendered by the caller when the page is in the single-person
// "week-grid" layout (2+ people already routes to the stacked layout,
// which has its own full-row-per-person visual and no need for this).

import { useRouter, useSearchParams } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PeopleSwitcherMember } from "@/components/calendar/people-switcher";

const NO_OVERLAY_VALUE = "__none__";

export function OverlayPersonSelect({
  members,
  selectedOverlayUserId,
  workspaceSlug,
}: {
  /** Candidates to overlay -- callers pass every active member EXCEPT
   * whoever the main switcher already has selected, so a person can't be
   * overlaid on top of their own view. */
  members: PeopleSwitcherMember[];
  /** The current `?overlay=` value, or `null` when no one is overlaid. */
  selectedOverlayUserId: string | null;
  workspaceSlug: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  if (members.length === 0) return null;

  function handleChange(value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === NO_OVERLAY_VALUE) {
      params.delete("overlay");
    } else {
      params.set("overlay", value);
    }
    const query = params.toString();
    router.push(`/w/${workspaceSlug}/calendar${query ? `?${query}` : ""}`);
  }

  return (
    <Select
      value={selectedOverlayUserId ?? NO_OVERLAY_VALUE}
      onValueChange={handleChange}
    >
      <SelectTrigger
        size="sm"
        className="w-40"
        aria-label="Overlay a teammate's schedule"
        data-testid="calendar-overlay-person-select"
      >
        <SelectValue placeholder="Overlay..." />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_OVERLAY_VALUE} data-testid="calendar-overlay-person-none">
          No overlay
        </SelectItem>
        {members.map((member) => (
          <SelectItem key={member.userId} value={member.userId}>
            {member.name ?? member.email ?? "Unknown member"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
