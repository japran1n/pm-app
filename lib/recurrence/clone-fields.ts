// F176 (AS-316): the explicit, named allow-list of which task fields get
// copied into a new recurring occurrence — and, by omission, which do not.
// This is deliberately the ONLY place this list is written; F180
// (duplicate task) reuses `cloneableTaskFields`/`cloneTaskFields` verbatim
// per that feature's own spec, so both features can never drift apart on
// "what counts as a copy vs a fresh start".
//
// Per this feature's Clarified implementation (API/contract answer): a
// small named function with an explicit return type, no implicit globals,
// no I/O — the caller (a Server Action) is responsible for actually
// inserting the resulting row and for anything not on this list.
//
// COPIED (per AS-316's exact wording): title, description (+
// description_json — F170/F171's rich-text column, kept in lockstep with
// `description` the same way every other description-touching feature in
// this mission does), assignees, priority, checklist items, and estimate.
//
// EXPLICITLY NOT COPIED (also per AS-316, and this mission's "status
// always resets" rule):
// - comments — a new occurrence has no history of its own yet.
// - attachments — files belong to the specific occurrence they were
//   uploaded against, not the recurrence series.
// - logged time entries — time was spent against the source task, not the
//   new one.
// - the task's key/number — a new occurrence gets its own, assigned by the
//   normal task-creation path (F007's number sequence), never copied.
// - status — a new occurrence always starts at the initial "todo" status
//   regardless of what status the source task was in when it recurred
//   (even if the source was "done", which is exactly what triggered the
//   next occurrence to be generated).
//
// Checklist items are copied as fresh, unchecked items (content + position
// only) — `is_checked`/`checked_at`/`checked_by` are intentionally reset,
// consistent with "a new occurrence starts fresh" applying to sub-items
// too, not just the task's own status field.

export type ChecklistItemSource = {
  content: string;
  position: number;
};

/**
 * The shape a "cloneable" task exposes as input to `cloneTaskFields`. Kept
 * intentionally narrow (only the fields this module might read) rather
 * than accepting a full `tasks` row, so a caller can't accidentally rely
 * on this module reading (and thus implicitly "copying") a field that
 * isn't on the allow-list.
 */
export interface CloneableTaskSource {
  title: string;
  description: string | null;
  description_json: unknown | null;
  assigneeIds: string[];
  priority: string | null;
  checklistItems: ChecklistItemSource[];
  estimate_minutes: number | null;
}

/**
 * The result of applying the allow-list: exactly the fields a new
 * occurrence's insert should be seeded with. `status` is always the
 * initial status, never read from the source.
 */
export interface ClonedTaskFields {
  title: string;
  description: string | null;
  description_json: unknown | null;
  assigneeIds: string[];
  priority: string | null;
  checklistItems: ChecklistItemSource[];
  estimate_minutes: number | null;
  status: "todo";
}

/**
 * The initial status every new occurrence starts at, regardless of the
 * source task's status at the moment it recurred. Exported as a named
 * constant (not just inlined) so F180 and any future caller reference the
 * same single source of truth instead of re-deriving the literal.
 */
export const RECURRENCE_INITIAL_STATUS = "todo" as const;

/**
 * The explicit, named allow-list this feature (and F180) exist to define.
 * Field names are the `CloneableTaskSource`/`ClonedTaskFields` keys that
 * ARE copied — kept as a real exported array (not just documentation) so a
 * test can assert against it directly, and so a future reviewer can see at
 * a glance that nothing beyond this list is ever copied.
 */
export const CLONEABLE_TASK_FIELDS = [
  "title",
  "description",
  "description_json",
  "assigneeIds",
  "priority",
  "checklistItems",
  "estimate_minutes",
] as const satisfies readonly (keyof CloneableTaskSource)[];

/**
 * Fields that are deliberately excluded, named here (not just in a
 * comment) so a test can assert their absence/reset explicitly rather than
 * relying on prose. Not an exhaustive list of every column a task has —
 * only the ones AS-316 and this feature's spec call out by name.
 */
export const NON_CLONEABLE_TASK_FIELDS = [
  "comments",
  "attachments",
  "loggedTimeEntries",
  "key",
  "number",
  "status",
] as const;

/**
 * Applies the allow-list: returns exactly the fields a new occurrence
 * should be seeded with from `source`, plus the always-reset `status`.
 * Pure — no I/O, no database access; the caller does the actual insert
 * (and is responsible for everything NOT on this list: generating a new
 * key/number, leaving comments/attachments/time-entries empty for the new
 * row).
 *
 * Checklist items are copied as new, unchecked items — `is_checked` is not
 * part of `ChecklistItemSource`'s shape at all, so there's nothing to
 * reset; only `content`/`position` ever cross into the clone.
 */
export function cloneTaskFields(source: CloneableTaskSource): ClonedTaskFields {
  return {
    title: source.title,
    description: source.description,
    description_json: source.description_json,
    assigneeIds: [...source.assigneeIds],
    priority: source.priority,
    checklistItems: source.checklistItems.map((item) => ({
      content: item.content,
      position: item.position,
    })),
    estimate_minutes: source.estimate_minutes,
    status: RECURRENCE_INITIAL_STATUS,
  };
}
