import { z } from "zod";

// Validates create/delete input for Team PTO entries (see
// supabase/migrations/20261114010000_time_off_entries.sql for the data
// model). Mirrors lib/validation/calendar-blocks.ts's file-layout
// convention -- date-only (not timestamptz) here, since PTO is a whole-day
// concept.

const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date (YYYY-MM-DD).")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), {
    message: "Enter a valid date.",
  });

export const createTimeOffSchema = z
  .object({
    workspaceId: z.string().uuid("Invalid workspace."),
    startDate: dateOnly,
    endDate: dateOnly,
    note: z
      .string()
      .trim()
      .max(200, "Note must be 200 characters or fewer.")
      .nullable()
      .optional(),
  })
  .refine((input) => input.endDate >= input.startDate, {
    message: "End date must be on or after the start date.",
    path: ["endDate"],
  });

export type CreateTimeOffInput = z.infer<typeof createTimeOffSchema>;

export const deleteTimeOffSchema = z.object({
  entryId: z.string().uuid("Invalid time off entry."),
});

export type DeleteTimeOffInput = z.infer<typeof deleteTimeOffSchema>;
