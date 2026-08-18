import { z } from "zod";

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
});

export type LogTimeEntryInput = z.infer<typeof logTimeEntrySchema>;
