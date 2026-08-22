// F196: pure activity-feed formatting helpers (AS-355's vocabulary, AS-358,
// AS-361). No Supabase, no React, no I/O — every function here is a plain
// function of its arguments, unit-tested directly (mirrors this mission's
// "pure helper + component consumes it" convention used throughout, e.g.
// lib/activity/task-activity.ts's diffTaskFields, lib/queries/audit.ts's
// actionSentence).
//
// --- Sentence vocabulary -----------------------------------------------
//
// One switch over F195's closed field vocabulary ('title' | 'status' |
// 'priority' | 'due_date' | 'estimate' | 'assignee_id'), per this
// feature's Notes for clarification ("Sentence templates per activity
// kind live in one map so wording stays consistent and translatable
// later" — implemented as a switch rather than a literal object map since
// several fields need a null-old-value branch ("set the X" vs "changed
// the X from A to B"), which a flat string-template map can't express
// without duplicating placeholders; this is still the ONE place the
// vocabulary lives, satisfying the actual requirement).
//
// Status/priority labels reuse lib/task-colors.ts's STATUS_LABELS/
// PRIORITY_LABELS verbatim — the same source of truth every other status/
// priority-rendering surface in the app already uses (board columns, list
// table, the detail sheet's own selects) — rather than a second,
// activity-feed-local copy of "in_progress" -> "In Progress".
//
// A null `actorId`/`actorLabel` (F195/AS-360: recurrence-job-driven
// entries carry `actor_id: null`) never crashes and never renders the
// literal word "null" — it renders as "System". The one exception the
// feature spec names explicitly ("System generated this task from a
// recurring series") is detected by its own distinctive shape (a
// system-attributed field_changed/due_date entry with a null old value —
// exactly what F195's recurrence-job write produces, see that feature's
// handoff Decisions Made) rather than a new `kind`, since F194's `kind`
// CHECK constraint is a closed vocabulary this feature's Files scope
// cannot migrate.

import { formatDueDate } from "@/lib/time/user-timezone";
import { STATUS_LABELS, PRIORITY_LABELS } from "@/lib/task-colors";
import type { TaskActivityKind } from "@/lib/queries/task-activity";

export type FormatTaskActivityEntryInput = {
  kind: TaskActivityKind;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  /** Null for a system-generated entry (F195/AS-360) — rendered as
   * "System", never crashes, never shows the literal word "null". */
  actorLabel: string | null;
  /** IANA timezone to render `due_date` values in (F124/F275's shared
   * convention: a due date is a calendar date, never reformatted through
   * an ambient/implicit zone). Omitted -> the raw "YYYY-MM-DD" string is
   * shown unchanged, same "never throws" fallback formatDueDate itself
   * uses for an unrecognized zone. */
  timeZone?: string;
  /** field === "assignee_id" only: resolves an assignee's user id to a
   * display label. Omitted, or returning null, falls back to "someone" —
   * this helper never fails to render just because a name couldn't be
   * resolved. */
  resolveAssigneeLabel?: (userId: string) => string | null;
};

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** "45m" / "2h" / "2h 30m" for a minute count. Mirrors the shape every
 * other estimate display in the app expects (whole hours + leftover
 * minutes), kept local here since no shared "format estimate minutes"
 * helper exists elsewhere in the codebase yet (grepped lib/tasks and
 * lib/queries before adding this — see this feature's handoff). */
function formatEstimateMinutes(minutes: number): string {
  if (minutes <= 0) return "0m";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

function statusLabel(value: unknown): string {
  const raw = asStringOrNull(value);
  if (!raw) return "an unknown status";
  return STATUS_LABELS[raw as keyof typeof STATUS_LABELS] ?? raw;
}

function priorityLabel(value: unknown): string {
  const raw = asStringOrNull(value);
  if (!raw) return PRIORITY_LABELS.none;
  return PRIORITY_LABELS[raw as keyof typeof PRIORITY_LABELS] ?? raw;
}

function dueDateLabel(value: unknown, timeZone?: string): string | null {
  const raw = asStringOrNull(value);
  if (!raw) return null;
  return timeZone ? formatDueDate(raw, timeZone) : raw;
}

function assigneeLabel(
  value: unknown,
  resolve?: (userId: string) => string | null,
): string {
  const userId = asStringOrNull(value);
  if (!userId) return "someone";
  return resolve?.(userId) ?? "someone";
}

function fieldChangedSentence(input: FormatTaskActivityEntryInput): string {
  const { field, oldValue, newValue, timeZone, resolveAssigneeLabel } = input;
  const actor = input.actorLabel ?? "System";

  switch (field) {
    case "title": {
      const oldTitle = asStringOrNull(oldValue);
      const newTitle = asStringOrNull(newValue) ?? "an untitled task";
      return oldTitle
        ? `${actor} renamed this from "${oldTitle}" to "${newTitle}"`
        : `${actor} set the title to "${newTitle}"`;
    }

    case "status": {
      const oldPresent = asStringOrNull(oldValue) !== null;
      return oldPresent
        ? `${actor} moved this from ${statusLabel(oldValue)} to ${statusLabel(newValue)}`
        : `${actor} set the status to ${statusLabel(newValue)}`;
    }

    case "priority": {
      const oldPresent = asStringOrNull(oldValue) !== null;
      return oldPresent
        ? `${actor} changed the priority from ${priorityLabel(oldValue)} to ${priorityLabel(newValue)}`
        : `${actor} set the priority to ${priorityLabel(newValue)}`;
    }

    case "due_date": {
      const oldDate = dueDateLabel(oldValue, timeZone);
      const newDate = dueDateLabel(newValue, timeZone);

      // F195/AS-360: the recurrence job's own system-attributed entry for
      // a newly generated occurrence — a null old value plus no human
      // actor is exactly (and only) what that write path produces (see
      // lib/activity/task-activity.ts's writeTaskFieldChanges call site
      // in lib/recurrence/generate-next-occurrence.ts). Rendered as the
      // feature spec's own named example sentence rather than a generic
      // "set the due date" line, since "this task exists because of
      // recurrence" is the more useful fact for a viewer than the exact
      // date.
      if (input.actorLabel === null && !oldDate) {
        return "System generated this task from a recurring series";
      }

      if (!oldDate && newDate) return `${actor} set the due date to ${newDate}`;
      if (oldDate && !newDate) return `${actor} removed the due date`;
      if (oldDate && newDate) {
        return `${actor} changed the due date from ${oldDate} to ${newDate}`;
      }
      return `${actor} changed the due date`;
    }

    case "estimate": {
      const oldMinutes = asNumberOrNull(oldValue);
      const newMinutes = asNumberOrNull(newValue);
      if (oldMinutes === null && newMinutes !== null) {
        return `${actor} set the estimate to ${formatEstimateMinutes(newMinutes)}`;
      }
      if (oldMinutes !== null && newMinutes === null) {
        return `${actor} removed the estimate`;
      }
      if (oldMinutes !== null && newMinutes !== null) {
        return `${actor} changed the estimate from ${formatEstimateMinutes(oldMinutes)} to ${formatEstimateMinutes(newMinutes)}`;
      }
      return `${actor} changed the estimate`;
    }

    case "assignee_id": {
      const oldId = asStringOrNull(oldValue);
      const newId = asStringOrNull(newValue);
      if (!oldId && newId) {
        return `${actor} assigned this to ${assigneeLabel(newValue, resolveAssigneeLabel)}`;
      }
      if (oldId && !newId) {
        return `${actor} unassigned this (was ${assigneeLabel(oldValue, resolveAssigneeLabel)})`;
      }
      if (oldId && newId) {
        return `${actor} reassigned this from ${assigneeLabel(oldValue, resolveAssigneeLabel)} to ${assigneeLabel(newValue, resolveAssigneeLabel)}`;
      }
      return `${actor} changed the assignee`;
    }

    default:
      // Defensive fallback for a future field this switch hasn't been
      // extended for yet — still a sentence, never a raw key rendered
      // verbatim (same convention lib/queries/audit.ts's actionSentence
      // uses for an unrecognized action string).
      return field ? `${actor} changed the ${field}` : `${actor} changed this task`;
  }
}

/**
 * The single kind/field -> human-readable sentence mapping this feature's
 * clarification requires. Never throws: an unrecognized `field` renders a
 * generic-but-still-readable fallback rather than crashing the feed.
 */
export function formatTaskActivityEntry(
  input: FormatTaskActivityEntryInput,
): string {
  const actor = input.actorLabel ?? "System";

  switch (input.kind) {
    case "field_changed":
      return fieldChangedSentence(input);
    case "comment_added":
      return `${actor} added a comment`;
    case "comment_deleted":
      return `${actor} deleted a comment`;
    default:
      return `${actor} did something`;
  }
}

// --- Day grouping (AS-361) -----------------------------------------------

import { subDays } from "date-fns";
import { startOfDayInTimeZone, todayInTimeZone } from "@/lib/time/user-timezone";

export type TaskActivityDayGroup<T> = {
  /** "YYYY-MM-DD" as seen from `timeZone` — stable grouping key. */
  key: string;
  /** "Today" / "Yesterday" / a short date ("Aug 20", or "Aug 20, 2025" for
   * a different year). */
  label: string;
  entries: T[];
};

function dayLabel(dateOnly: string, timeZone: string, now: Date): string {
  const today = todayInTimeZone(timeZone, now);
  if (dateOnly === today) return "Today";

  const yesterday = todayInTimeZone(timeZone, subDays(now, 1));
  if (dateOnly === yesterday) return "Yesterday";

  const instant = startOfDayInTimeZone(dateOnly, timeZone);
  if (!instant) return dateOnly;

  const currentYear = today ? Number(today.slice(0, 4)) : now.getFullYear();
  const entryYear = Number(dateOnly.slice(0, 4));
  const options: Intl.DateTimeFormatOptions =
    entryYear === currentYear
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };

  return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(instant);
}

/**
 * Groups already-ordered activity entries by calendar day AS SEEN FROM
 * `timeZone` (F124's shared "what day is it, for this user" convention —
 * never the server's or the browser's ambient zone). Preserves the
 * caller's entry order within and across groups: since the caller passes
 * entries newest-first (AS-358), the returned groups come out newest-day
 * first too, with no separate re-sort here — this function's only job is
 * to bucket, not to reorder.
 *
 * An entry with an unparseable `createdAt` or an unrecognized `timeZone`
 * falls into a group keyed "unknown" rather than throwing or silently
 * dropping the entry — same "never crash a render" convention as
 * lib/time/user-timezone.ts.
 */
export function groupTaskActivityEntriesByDay<T extends { createdAt: string }>(
  entries: T[],
  timeZone: string,
  now: Date = new Date(),
): TaskActivityDayGroup<T>[] {
  const order: string[] = [];
  const buckets = new Map<string, T[]>();

  for (const entry of entries) {
    const instant = new Date(entry.createdAt);
    const key = todayInTimeZone(timeZone, instant) ?? "unknown";
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(entry);
  }

  return order.map((key) => ({
    key,
    label: key === "unknown" ? "Unknown date" : dayLabel(key, timeZone, now),
    entries: buckets.get(key)!,
  }));
}

/** "10:32 AM" for an entry's timestamp, as seen from `timeZone` (AS-361's
 * "readable relative timestamps" — read as "relative to the day group it
 * sits under", i.e. time-of-day only, since the day itself is already the
 * group header). Falls back to the raw ISO string for an unparseable
 * instant or unrecognized zone, same never-throw convention. */
export function formatTaskActivityTime(iso: string, timeZone: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(instant);
  } catch {
    return iso;
  }
}
