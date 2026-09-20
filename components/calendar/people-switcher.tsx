"use client";

// F026/F027 (AS-052, AS-053, AS-054, AS-055): the Planner's people switcher.
//
// F026 (combobox shell: list active members with avatar/name, type-to-
// filter) had not been implemented by the time this worker started — no
// `components/calendar/people-switcher.tsx` existed yet, despite F027
// depending on it. AUTONOMOUS_DECISION: build the shell alongside the
// multi-select behaviour this feature (F027) actually owns, since AS-054/
// AS-055 are unreachable without it. cmdk (via components/ui/command.tsx)
// is the repo's existing combobox primitive (already a dependency, per
// F026's own clarification note) so the shell reuses it rather than
// introducing anything new.
//
// Selection is fully controlled by the caller (`selectedUserIds` +
// `onSelectionChange`) rather than owning state internally. F029 (URL
// wiring: ?people=, week-preservation, browser-storage bans)
// and F028 ("just me" / "whole team" shortcuts) both need to drive
// selection from outside this component, so this component never owns the
// source of truth for who is selected — it only renders it and reports
// toggles.
//
// F028 (AS-056, AS-057): the "Just me" and "whole team" shortcuts, surfaced
// as a `Shortcuts` command group above the member list so they're always
// one click away without narrowing/scrolling. "Just me" replaces the
// selection with `[selfId]`. "Whole team" replaces it with every active
// member ordered via F006's `orderPeopleForWholeTeam` (signed-in member
// first, then the rest alphabetically) — `members` here is exactly F014's
// active-member list, so "whole team" always means every active member.
// `selfId` is required so this component can tell which member is "me";
// it's the only new prop this feature adds.
import * as React from "react";
import { UsersIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { orderPeopleForWholeTeam, serializePeopleParam } from "@/lib/calendar/people-selection";

import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type PeopleSwitcherMember = {
  userId: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};

export type PeopleSwitcherProps = {
  members: PeopleSwitcherMember[];
  /** Controlled: which member userIds are currently selected. */
  selectedUserIds: string[];
  /** Controlled: called with the full next selection set on every toggle. */
  onSelectionChange: (nextSelectedUserIds: string[]) => void;
  /**
   * The signed-in member's userId. Required to power the "Just me" /
   * "Whole team" shortcuts (AS-056, AS-057).
   */
  selfId: string;
  /**
   * Maximum number of avatars shown in the closed-trigger avatar group
   * before collapsing the remainder into an overflow count (AS-055).
   */
  maxVisibleAvatars?: number;
  className?: string;
};

function initialsFor(member: PeopleSwitcherMember): string {
  const source = member.name ?? member.email ?? "?";
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

function displayNameFor(member: PeopleSwitcherMember): string {
  return member.name ?? member.email ?? "Unknown member";
}

export function PeopleSwitcher({
  members,
  selectedUserIds,
  onSelectionChange,
  selfId,
  maxVisibleAvatars = 3,
  className,
}: PeopleSwitcherProps) {
  const [open, setOpen] = React.useState(false);

  const selectedSet = React.useMemo(
    () => new Set(selectedUserIds),
    [selectedUserIds],
  );

  const selectedMembers = React.useMemo(
    () => members.filter((member) => selectedSet.has(member.userId)),
    [members, selectedSet],
  );

  // AS-054: several members can be selected at once — toggling one
  // member's row never clears or replaces the rest of the selection.
  function toggleMember(userId: string) {
    if (selectedSet.has(userId)) {
      onSelectionChange(selectedUserIds.filter((id) => id !== userId));
    } else {
      onSelectionChange([...selectedUserIds, userId]);
    }
  }

  const visibleMembers = selectedMembers.slice(0, maxVisibleAvatars);
  const overflowCount = Math.max(
    0,
    selectedMembers.length - visibleMembers.length,
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-slot="people-switcher-trigger"
        className={cn(
          "flex items-center gap-2 rounded-md border border-border-control bg-field px-2 py-1.5 text-sm text-foreground outline-hidden transition-colors hover:border-border-control-hover data-[popup-open]:border-border-control-hover",
          className,
        )}
        aria-label={
          selectedMembers.length === 0
            ? "Select people"
            : `${selectedMembers.length} people selected`
        }
      >
        {selectedMembers.length === 0 ? (
          <>
            <UsersIcon className="size-4 shrink-0 text-muted-foreground" />
            {/* AS-061: the label text is dropped below the `sm` breakpoint so
             * the trigger stays a compact icon-only control alongside the
             * week nav buttons at mobile widths -- `aria-label` above still
             * announces "Select people" to assistive tech either way, so
             * nothing is lost for keyboard/screen-reader users, only for
             * sighted mobile viewport space. */}
            <span className="hidden text-muted-foreground sm:inline">Select people</span>
          </>
        ) : (
          <AvatarGroup data-slot="people-switcher-avatar-group">
            {visibleMembers.map((member) => (
              <Avatar key={member.userId} size="sm">
                {member.avatarUrl ? (
                  <AvatarImage
                    src={member.avatarUrl}
                    alt={displayNameFor(member)}
                  />
                ) : null}
                <AvatarFallback>{initialsFor(member)}</AvatarFallback>
              </Avatar>
            ))}
            {overflowCount > 0 ? (
              <AvatarGroupCount data-slot="people-switcher-overflow-count">
                +{overflowCount}
              </AvatarGroupCount>
            ) : null}
          </AvatarGroup>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-0"
        data-slot="people-switcher-content"
      >
        <Command>
          <CommandInput placeholder="Find a person..." />
          <CommandList>
            <CommandEmpty>No members found.</CommandEmpty>
            {members.length > 0 && (
              <CommandGroup heading="Shortcuts">
                <CommandItem
                  key="just-me"
                  value="Just me"
                  data-slot="people-switcher-just-me"
                  onSelect={() => onSelectionChange([selfId])}
                >
                  <span>Just me</span>
                </CommandItem>
                <CommandItem
                  key="whole-team"
                  value="Whole team"
                  data-slot="people-switcher-whole-team"
                  onSelect={() =>
                    onSelectionChange(
                      orderPeopleForWholeTeam(
                        members.map((member) => ({
                          id: member.userId,
                          name: member.name,
                        })),
                        selfId,
                      ),
                    )
                  }
                >
                  <span>Whole team</span>
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {members.map((member) => {
                const isSelected = selectedSet.has(member.userId);
                return (
                  <CommandItem
                    key={member.userId}
                    value={displayNameFor(member)}
                    data-checked={isSelected}
                    aria-selected={isSelected}
                    onSelect={() => toggleMember(member.userId)}
                  >
                    <Avatar size="sm">
                      {member.avatarUrl ? (
                        <AvatarImage
                          src={member.avatarUrl}
                          alt={displayNameFor(member)}
                        />
                      ) : null}
                      <AvatarFallback>{initialsFor(member)}</AvatarFallback>
                    </Avatar>
                    <span className="truncate">{displayNameFor(member)}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// F029 (AS-011, AS-012, AS-013, AS-059): wires PeopleSwitcher's selection to
// the Planner's own URL state instead of any component/browser storage.
//
// - AS-012: every navigation this wrapper triggers carries the current
//   `?week=` value forward untouched (`weekParam`, passed straight through
//   from the page's own `searchParams.week` — never re-derived), so
//   changing who's selected never resets or drops the visible week.
// - AS-059: an empty next-selection (the caller deselected everyone) is
//   coerced to `[selfId]` before it ever reaches the URL, so the Planner
//   always has someone to show rather than rendering an empty view.
// - AS-013: state lives in the URL alone — no browser storage of any
//   kind is read or written anywhere in this file or PeopleSwitcher itself.
//
// `router.push` (not `.replace`) mirrors the plain `<Link>`-driven
// navigation week-view.tsx's own prev/next/today controls already use, so
// switcher changes are equally back/forward-navigable.
export function PeopleSwitcherUrlBound({
  members,
  selectedUserIds,
  selfId,
  workspaceSlug,
  weekParam,
  maxVisibleAvatars,
  className,
}: {
  members: PeopleSwitcherMember[];
  selectedUserIds: string[];
  selfId: string;
  workspaceSlug: string;
  /** The Planner page's raw `searchParams.week` value, forwarded verbatim
   * so this wrapper never has to re-derive or normalize it. Omitted from
   * the built URL when absent (same "today" shorthand week-view.tsx's own
   * todayHref already uses). */
  weekParam?: string;
  maxVisibleAvatars?: number;
  className?: string;
}) {
  const router = useRouter();

  return (
    <PeopleSwitcher
      members={members}
      selectedUserIds={selectedUserIds}
      selfId={selfId}
      maxVisibleAvatars={maxVisibleAvatars}
      className={className}
      onSelectionChange={(nextSelectedUserIds) => {
        // AS-059: never let an empty selection reach the URL.
        const ids =
          nextSelectedUserIds.length > 0 ? nextSelectedUserIds : [selfId];

        const params = new URLSearchParams();
        // AS-012: carry `?week=` forward exactly as it was.
        if (weekParam) {
          params.set("week", weekParam);
        }
        params.set("people", serializePeopleParam(ids, selfId));

        router.push(`/w/${workspaceSlug}/calendar?${params.toString()}`);
      }}
    />
  );
}
