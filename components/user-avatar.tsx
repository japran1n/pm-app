// F122 (AS-204, AS-214): the single shared "render a person" component —
// image when `avatar_url` exists, otherwise initials on a colour picked
// deterministically from the user id (lib/user-color.ts). Replaces every
// ad-hoc name/email/initials rendering across the app (task cards, task
// detail's assignee picker, comments, the members list, the assignee
// filter/creation pickers, and the dashboard/list table) — see this
// feature's handoff for the full list of call sites.
//
// Not a Client Component itself: components/ui/avatar.tsx's primitives
// (@base-ui/react/avatar) are already "use client", but composing them
// here with no hooks/state of its own means this component can be
// rendered directly from a Server Component (e.g. the members settings
// page) without forcing a client boundary on its caller, per the
// clarified spec's "Server Component for data loading, Client Component
// only for interaction" pattern — this is pure presentation either way.
//
// Accessible name (explicit requirement in this feature's assignment,
// beyond what AS-204/AS-214 literally say): `role="img"` +
// `aria-label={label}` is set on the Avatar root itself, with both the
// `<img>` and the initials `<span>` marked `aria-hidden`. That keeps the
// accessible name constant and correct regardless of which of the two
// children Base UI's Avatar is currently showing (it swaps between them
// based on image load state) — an empty `alt` on the image plus a
// standalone `aria-label` on the fallback span would otherwise announce
// nothing while the image is still loading.

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { getUserColor } from "@/lib/user-color";
import { isStatusNoteActive } from "@/lib/status-note";

export type UserAvatarPerson = {
  /** auth user id — the deterministic colour hash key (AS-204). */
  id: string;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  /** Out-of-office status note (workspace_members.status_note) — shown
   * in a hover tooltip alongside the person's name when non-expired.
   * Callers that already filter to active-only (e.g.
   * `getWorkspaceMembers`) may pass an already-expired-filtered value
   * here; `isStatusNoteActive` is re-checked regardless, so a stale
   * prop can never leak an expired note into the tooltip. */
  statusNote?: string | null;
  statusNoteUntil?: string | null;
};

// F277: `Array.from(string)` (not `.charAt`/`.slice`, which index by UTF-16
// code unit) so a display name whose first "character" is an astral
// codepoint — e.g. an emoji, which is a surrogate pair — yields the whole
// glyph as the initial instead of one half of a broken surrogate pair.
function firstGrapheme(value: string): string {
  return Array.from(value)[0] ?? "";
}

function initialsFor(name?: string | null, email?: string | null): string {
  const label = (name ?? "").trim() || (email ?? "").trim();
  if (!label) return "?";
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (
      firstGrapheme(parts[0]!) + firstGrapheme(parts[1]!)
    ).toUpperCase();
  }
  return Array.from(label).slice(0, 2).join("").toUpperCase();
}

/**
 * Same fallback order already used across the app before this component
 * existed (TaskDetailSheet's `memberLabel`, CommentList's `authorLabel`,
 * the members page's inline `label`): display name, then email, then the
 * raw id as a last resort — a person is never rendered as nothing at all.
 */
export function personLabel(
  person: Pick<UserAvatarPerson, "id" | "name" | "email">,
): string {
  return person.name || person.email || person.id;
}

export function UserAvatar({
  person,
  size = "default",
  className,
}: {
  person: UserAvatarPerson;
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  const label = personLabel(person);
  const color = getUserColor(person.id);

  return (
    <Avatar size={size} className={className} role="img" aria-label={label}>
      {person.avatarUrl ? (
        <AvatarImage src={person.avatarUrl} alt="" aria-hidden="true" />
      ) : null}
      <AvatarFallback
        aria-hidden="true"
        style={{ backgroundColor: color.background, color: color.foreground }}
      >
        {initialsFor(person.name, person.email)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Out-of-office status note: everywhere a person's avatar is hovered
 * (assignee avatar groups, single-avatar call sites), the tooltip text
 * shown when an active note exists — `"<name>: <note>"` — or null when
 * there's nothing to show (no note, or its `statusNoteUntil` date has
 * already passed), so callers can conditionally render/suppress a
 * tooltip trigger entirely rather than showing an empty one. Re-checks
 * expiry itself (never trusts an unfiltered `statusNote` prop) via
 * `isStatusNoteActive`.
 */
export function statusNoteTooltipLabel(
  person: Pick<UserAvatarPerson, "id" | "name" | "email" | "statusNote" | "statusNoteUntil">,
): string | null {
  if (!isStatusNoteActive(person.statusNote, person.statusNoteUntil)) return null;
  return `${personLabel(person)}: ${person.statusNote}`;
}
