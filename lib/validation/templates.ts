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
// F184: Zod schemas for `kind='project'` templates (task-level schemas
// above are `kind='task'`; per F182's own handoff note, a project-kind
// payload gets its own sibling schema rather than overloading
// taskTemplatePayloadSchema, since the two kinds are structurally
// different).

export const saveProjectAsTemplateSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  name: z
    .string()
    .trim()
    .min(1, "Template name is required.")
    .max(200, "Template name must be 200 characters or fewer."),
});
export type SaveProjectAsTemplateInput = z.infer<
  typeof saveProjectAsTemplateSchema
>;

export const createProjectFromTemplateSchema = z.object({
  templateId: z.string().uuid("Invalid template."),
  workspaceId: z.string().uuid("Invalid workspace."),
  name: z
    .string()
    .trim()
    .min(1, "Project name is required.")
    .max(200, "Project name must be 200 characters or fewer."),
  description: z.string().trim().max(2000).nullable().optional(),
});
export type CreateProjectFromTemplateInput = z.infer<
  typeof createProjectFromTemplateSchema
>;

// A single seeded task inside a project template's payload. Same field
// shape as F182's task-template payload (Definition of done, "same field
// shape as F182's task templates") minus `assigneeIds`: project templates
// are reused across arbitrary future projects/workspaces where the
// original assignees may not even be members, so — per the clarified
// "simpler option, no new dependency, no second source of truth" rule —
// this feature does not invent its own assignee-resolution story on top
// of what F182 already built for tasks; a project template only ever
// seeds task content, never assignments.
export const projectTemplateTaskSchema = z.object({
  title: z.string().trim().min(1, "Task title is required."),
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
  tags: z.array(z.string()).default([]),
});
export type ProjectTemplateTask = z.infer<typeof projectTemplateTaskSchema>;

// The shape of a `kind: 'project'` template's `payload` jsonb column: an
// ORDERED list of tasks to seed into the new project (array order is
// preserved end-to-end, from save through to the created project's task
// order).
//
// F218 (custom project statuses/columns) gap — deliberately NOT modeled
// here yet: the feature spec's draft scope mentions "the project's
// columns (once F218 lands)", but F218 has not been built (M16, not yet
// started) and every project today only ever uses the fixed
// todo/in_progress/in_review/done statuses (no `project_statuses` table
// exists). Inventing fake column data now would be a second source of
// truth that F218 would immediately have to reconcile or discard. Per
// this mission's "additive first, don't invent dependencies that don't
// exist yet" convention, this schema has NO `columns` field at all —
// every seeded task is created with the fixed default status `todo`
// (createProjectFromTemplate never accepts a per-task status override).
// When F218 lands, it should add an OPTIONAL `columns` field to this
// schema (optional so existing saved templates without it keep parsing)
// and extend both `saveProjectAsTemplate` (to snapshot the source
// project's real columns) and the `create_project_from_template` SQL
// function (supabase/migrations/
// 20260822190000_rpc_create_project_from_template.sql) to create those
// columns before seeding tasks into them by name/id instead of always
// `'todo'`.
export const projectTemplatePayloadSchema = z.object({
  tasks: z.array(projectTemplateTaskSchema),
});
export type ProjectTemplatePayload = z.infer<
  typeof projectTemplatePayloadSchema
>;

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
