import { z } from "zod";

// Validates create/update input for Planner-style calendar blocks (see
// supabase/migrations/20261107010000_calendar_blocks.sql for the data
// model). Mirrors lib/validation/views.ts's file-layout convention.

const isoDateTime = z
  .string()
  .trim()
  .min(1, "A start/end time is required.")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date/time.");

const blockType = z.enum(["general", "client_presentation"]);

export const createCalendarBlockSchema = z
  .object({
    workspaceId: z.string().uuid("Invalid workspace."),
    projectId: z.string().uuid("Invalid project.").nullable().optional(),
    taskId: z.string().uuid("Invalid task.").nullable().optional(),
    title: z
      .string()
      .trim()
      .min(1, "A title is required.")
      .max(200, "Title must be 200 characters or fewer."),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    color: z.string().trim().max(50).nullable().optional(),
    blockType: blockType.optional(),
  })
  .refine((input) => Date.parse(input.endsAt) > Date.parse(input.startsAt), {
    message: "End time must be after the start time.",
    path: ["endsAt"],
  });

export type CreateCalendarBlockInput = z.infer<typeof createCalendarBlockSchema>;

export const updateCalendarBlockSchema = z
  .object({
    blockId: z.string().uuid("Invalid block."),
    title: z
      .string()
      .trim()
      .min(1, "A title is required.")
      .max(200, "Title must be 200 characters or fewer.")
      .optional(),
    startsAt: isoDateTime.optional(),
    endsAt: isoDateTime.optional(),
    taskId: z.string().uuid("Invalid task.").nullable().optional(),
    color: z.string().trim().max(50).nullable().optional(),
    blockType: blockType.optional(),
  })
  .refine(
    (input) =>
      input.title !== undefined ||
      input.startsAt !== undefined ||
      input.endsAt !== undefined ||
      input.taskId !== undefined ||
      input.color !== undefined ||
      input.blockType !== undefined,
    { message: "Choose at least one field to update." },
  );

export type UpdateCalendarBlockInput = z.infer<typeof updateCalendarBlockSchema>;

export const deleteCalendarBlockSchema = z.object({
  blockId: z.string().uuid("Invalid block."),
});
