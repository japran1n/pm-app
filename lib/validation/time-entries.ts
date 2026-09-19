import { z } from "zod";

// F018 (missions/20260903-portal): matches `time_entries_work_category_check`
// (supabase/migrations/20261010010000_f017_project_budgets_work_category_hours_rpcs.sql).
// Nullable everywhere it's used below -- an entry with no category picked
// stays "uncategorised" rather than being forced to guess (F017's own
// migration comment, restated here since this is the schema's other
// source of truth for the same closed set).
export const workCategorySchema = z.enum([
  "design",
  "development",
  "content_seo",
  "pm",
  "qa",
]);

export type WorkCategory = z.infer<typeof workCategorySchema>;

// F011 (missions/20260919-150607): the single source of truth for "all
// work category values, in canonical order" — derived from the schema's
// own `.options` rather than a hand-written array, so it can never drift
// out of sync with workCategorySchema (and, by the comment above, with
// the `time_entries_work_category_check` / `task_discipline_estimates`
// CHECK constraints both migrations define using this same order).
export const WORK_CATEGORIES: readonly WorkCategory[] = workCategorySchema.options;

// Validates logTimeEntry input (F110: AS-161, AS-162, AS-163). Mirrors the
// file-layout convention established by lib/validation/tasks.ts and
// lib/validation/comments.ts.
//
// AS-162: minutes must be a positive integer — zero/negative/fractional
// values are rejected here before ever reaching the database, mirroring the
// `time_entries_minutes_positive` CHECK constraint
// (supabase/migrations/20260818151501_create_time_entries.sql), which is
// the real enforcement boundary. z.int() plus .positive() rejects 0,
// negatives, and non-integers (e.g. 1.5) in one step.
//
// entryDate is validated as a real calendar date string (YYYY-MM-DD, the
// shape a plain HTML date input / the `date` column both use) rather than
// merely "any non-empty string" — an invalid date like "2026-02-30" is
// rejected by the .refine() below since `date` column writes should be
// backed by an actually-valid date.
export const logTimeEntrySchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  minutes: z
    .number()
    .int("Minutes must be a whole number.")
    .positive("Minutes must be greater than zero."),
  billable: z.boolean(),
  entryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.")
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
      );
    }, "Enter a valid date."),
  note: z
    .string()
    .trim()
    .max(10000, "Note must be 10000 characters or fewer.")
    .optional(),
  // F018: optional/nullable, same "omitted vs explicit null" shape as
  // `note` below -- an omitted category defaults to the column's own
  // `null` default (uncategorised), an explicit null clears it, a valid
  // enum value sets it.
  workCategory: workCategorySchema.nullable().optional(),
});

export type LogTimeEntryInput = z.infer<typeof logTimeEntrySchema>;

// Validates editTimeEntry input (F112: AS-169). Mirrors the
// editableFields/.partial() pattern established by lib/validation/tasks.ts's
// editTaskSchema — only fields actually present in `updates` are applied,
// an omitted field leaves the existing column value untouched. Field-level
// constraints are identical to logTimeEntrySchema's, since these are the
// same columns, just optional here.
const editableTimeEntryFields = z.object({
  minutes: z
    .number()
    .int("Minutes must be a whole number.")
    .positive("Minutes must be greater than zero."),
  billable: z.boolean(),
  entryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.")
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
      );
    }, "Enter a valid date."),
  // Unlike logTimeEntrySchema's note (optional, defaults to undefined = "no
  // value supplied yet"), here `.nullable()` lets a caller explicitly clear
  // an existing note by passing null, distinct from omitting the field
  // entirely (which leaves the existing note untouched) — same
  // optional-vs-null distinction as editTaskSchema's description field.
  note: z
    .string()
    .trim()
    .max(10000, "Note must be 10000 characters or fewer.")
    .nullable(),
  // F018: same nullable shape as `note` above -- present + null clears
  // an existing category back to uncategorised, present + a valid value
  // sets it, omitted leaves the existing value untouched.
  workCategory: workCategorySchema.nullable(),
});

const partialEditableTimeEntryFields = editableTimeEntryFields.partial();

export const editTimeEntrySchema = z.object({
  entryId: z.string().uuid("Invalid time entry."),
  updates: partialEditableTimeEntryFields,
});

// F018: the team-hours-view-only category setter (setTimeEntryCategory).
// Deliberately its own schema/action, not a call into editTimeEntrySchema
// -- see lib/actions/time-entries.ts's doc comment on why this one field
// is writable by any project team writer, not just the entry's own
// author (AS-169 stays author-only for every other field).
export const setTimeEntryCategorySchema = z.object({
  entryId: z.string().uuid("Invalid time entry."),
  workCategory: workCategorySchema.nullable(),
});

export type SetTimeEntryCategoryInput = z.infer<typeof setTimeEntryCategorySchema>;

export type EditTimeEntryInput = z.infer<typeof editTimeEntrySchema>;
export type EditTimeEntryUpdates = z.infer<
  typeof partialEditableTimeEntryFields
>;

// Validates deleteTimeEntry input (F112: AS-170). Just the entry id.
export const deleteTimeEntrySchema = z.object({
  entryId: z.string().uuid("Invalid time entry."),
});

export type DeleteTimeEntryInput = z.infer<typeof deleteTimeEntrySchema>;
