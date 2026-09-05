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

// F006c (missions/20260903-portal, AS-014) / F116: the closed set of
// stable roles a task type ROW can carry, independent of its
// human-editable `name` — mirrors `task_types_system_key_check`
// (supabase/migrations/20260912010000_task_type_system_key.sql,
// widened by 20261104010000_f116_task_type_taxonomy.sql) exactly.
// `null` clears the tag. Only `page` is reassignable through this write
// path (F006c's own affordance) — the five F116 business keys
// (delivery/qa/client_request/change_request/improvement) are seeded
// once per workspace and locked at the database level
// (task_types_lock_system_flags_trigger); offering them here would only
// produce a friendly-looking option that always 42501s.
const systemKeySchema = z
  .enum(["page", "qa", "component", "content", "seo"])
  .nullable();

export const updateTaskTypeSchema = z.object({
  taskTypeId: z.string().uuid("Invalid task type."),
  name: nameSchema.optional(),
  color: colorSchema.optional(),
  systemKey: systemKeySchema.optional(),
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

// F116 (AS-058): a task's type is required, so this can no longer clear
// it to null — every task type change is one system-or-custom type
// swapped for another, never "no type".
export const setTaskTypeSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  taskTypeId: z.string().uuid("Invalid task type."),
});
export type SetTaskTypeInput = z.infer<typeof setTaskTypeSchema>;
