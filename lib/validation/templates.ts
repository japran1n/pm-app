// F182: Zod schemas for the four template Server Actions
// (saveTaskAsTemplate, createTaskFromTemplate, renameTemplate,
// deleteTemplate). Per this feature's Clarified implementation (data-shape
// answer): a narrow, explicitly typed input object mirroring the DB
// constraints in F181's `task_templates` migration
// (supabase/migrations/20260822180000_task_templates.sql) — `name` must be
// non-empty after trimming (mirrors that migration's
// `check (char_length(btrim(name)) > 0)` constraint), ids are uuids.

import { z } from "zod";

export const saveTaskAsTemplateSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  name: z
    .string()
    .trim()
    .min(1, "Template name is required.")
    .max(200, "Template name must be 200 characters or fewer."),
});
export type SaveTaskAsTemplateInput = z.infer<typeof saveTaskAsTemplateSchema>;

export const createTaskFromTemplateSchema = z.object({
  templateId: z.string().uuid("Invalid template."),
  projectId: z.string().uuid("Invalid project."),
  // Optional override for the created task's status; defaults to "todo"
  // (same initial-status convention F176's cloneTaskFields establishes for
  // every "fresh occurrence" create path) when omitted.
  status: z
    .enum(["todo", "in_progress", "in_review", "done"])
    .optional(),
});
export type CreateTaskFromTemplateInput = z.infer<
  typeof createTaskFromTemplateSchema
>;

export const renameTemplateSchema = z.object({
  templateId: z.string().uuid("Invalid template."),
  name: z
    .string()
    .trim()
    .min(1, "Template name is required.")
    .max(200, "Template name must be 200 characters or fewer."),
});
export type RenameTemplateInput = z.infer<typeof renameTemplateSchema>;

export const deleteTemplateSchema = z.object({
  templateId: z.string().uuid("Invalid template."),
});
export type DeleteTemplateInput = z.infer<typeof deleteTemplateSchema>;

// The shape of a `kind: 'task'` template's `payload` jsonb column. Mirrors
// F176's cloneTaskFields()/CLONEABLE_TASK_FIELDS allow-list exactly, plus
// `tags` (per F180's duplicateTask convention: tags are a plain column
// copy, not part of the recurrence allow-list, but ARE part of a
// full "save this task's state" snapshot) — this is the ONE place this
// mission's task-template payload shape is defined; both
// saveTaskAsTemplate (producer) and createTaskFromTemplate (consumer) use
// this schema so they can never drift apart on what a template payload
// contains.
export const taskTemplatePayloadSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  description_json: z.unknown().nullable(),
  priority: z
    .enum(["urgent", "high", "medium", "low", "backlog"])
    .nullable(),
  checklistItems: z.array(
    z.object({
      content: z.string(),
      position: z.number(),
    }),
  ),
  estimate_minutes: z.number().nullable(),
  tags: z.array(z.string()),
  // Assignees are saved into the template payload separately from
  // cloneTaskFields's own `assigneeIds` field name for clarity at the
  // payload-storage layer; kept optional/defaulted so a template saved
  // before this field existed (or a hand-crafted payload) still parses.
  assigneeIds: z.array(z.string().uuid()).default([]),
});
export type TaskTemplatePayload = z.infer<typeof taskTemplatePayloadSchema>;
