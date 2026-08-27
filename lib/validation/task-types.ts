import { z } from "zod";

import { isApprovedColumnColor } from "@/lib/board/column-colors";

// F434-F440: task type mutations. Colour reuses the same approved-palette
// schema board columns and status templates already validate against —
// same "one set of approved colours" rationale as
// lib/validation/status-templates.ts.

const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(40, "Name must be 40 characters or fewer.");

const colorSchema = z
  .string()
  .refine(isApprovedColumnColor, "Choose a colour from the approved palette.");

export const createTaskTypeSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  name: nameSchema,
  color: colorSchema,
});
export type CreateTaskTypeInput = z.infer<typeof createTaskTypeSchema>;

export const updateTaskTypeSchema = z.object({
  taskTypeId: z.string().uuid("Invalid task type."),
  name: nameSchema.optional(),
  color: colorSchema.optional(),
});
export type UpdateTaskTypeInput = z.infer<typeof updateTaskTypeSchema>;

export const deleteTaskTypeSchema = z.object({
  taskTypeId: z.string().uuid("Invalid task type."),
});
export type DeleteTaskTypeInput = z.infer<typeof deleteTaskTypeSchema>;

export const reorderTaskTypeSchema = z.object({
  taskTypeId: z.string().uuid("Invalid task type."),
  newPosition: z.number().finite(),
});
export type ReorderTaskTypeInput = z.infer<typeof reorderTaskTypeSchema>;

export const setTaskTypeSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  taskTypeId: z.string().uuid("Invalid task type.").nullable(),
});
export type SetTaskTypeInput = z.infer<typeof setTaskTypeSchema>;
