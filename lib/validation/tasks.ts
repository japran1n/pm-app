import { z } from "zod";

// Validates create-task input (AS-043, AS-044, AS-045, AS-046). Mirrors the
// tech-decisions.md file-layout convention established by
// lib/validation/projects.ts.
//
// AS-044: title is required and cannot be empty (trimmed) — mirrors the
// `tasks_title_not_empty` CHECK constraint from
// supabase/migrations/20260818013434_create_tasks.sql, which is the real
// enforcement boundary; this schema exists so a bad submission is rejected
// before ever reaching the database, per AS-146.
// AS-045: status defaults to 'todo' when omitted. The DB column already
// defaults to 'todo' (same migration), but the default is repeated here so
// client-side validation surfaces the same value the server will actually
// persist, rather than leaving `status` as `undefined` through the Zod
// layer only to be filled in later by the DB.
// AS-046: description/priority/assigneeId/dueDate are all optional.
export const createTaskSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  title: z
    .string()
    .trim()
    .min(1, "Task title is required.")
    .max(500, "Task title must be 500 characters or fewer."),
  description: z
    .string()
    .trim()
    .max(10000, "Description must be 10000 characters or fewer.")
    .optional()
    .nullable(),
  // Matches `tasks_status_check` in the tasks migration.
  status: z
    .enum(["todo", "in_progress", "in_review", "done"])
    .default("todo"),
  // Matches `tasks_priority_check` in the tasks migration. Optional/nullable
  // — a task may have no priority set at all (AS-046).
  priority: z
    .enum(["urgent", "high", "medium", "low", "backlog"])
    .optional()
    .nullable(),
  assigneeId: z.string().uuid("Invalid assignee.").optional().nullable(),
  // Plain YYYY-MM-DD string, matching the `date` column type — no
  // timezone/time-of-day component, same convention as
  // lib/validation/projects.ts's startDate/endDate fields. AS-063: any
  // valid date, including past dates, is accepted — no additional range
  // check beyond format is applied here.
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid due date (YYYY-MM-DD).")
    .optional()
    .nullable(),
  // F149 (AS-267, AS-268 setup): optional parent task id, mirroring
  // `tasks.parent_task_id` added by F148
  // (supabase/migrations/20260819071050_subtasks_parent_task_id.sql).
  // Format-only validation here — the real invariants (self-reference,
  // one-level nesting, same-project) are re-checked in
  // lib/actions/tasks.ts's createTask against the live parent row before
  // insert, with the database's own CHECK constraint/trigger
  // (enforce_task_parent_rules()) as the final gate. Omitted or null both
  // mean "top-level task", same as every other optional/nullable field in
  // this schema.
  parentTaskId: z.string().uuid("Invalid parent task.").optional().nullable(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

// Validates assignTask input (AS-051, AS-052, AS-053). assigneeId is
// nullable — null means "unassign" (AS-053) and is a deliberate, valid
// input, not an omitted/optional field.
export const assignTaskSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  assigneeId: z.string().uuid("Invalid assignee.").nullable(),
});

export type AssignTaskInput = z.infer<typeof assignTaskSchema>;

// F160: multi-assignee actions over `task_assignees` (AS-289, AS-290).
// `assignTask`/`assignTaskSchema` above are kept unchanged for backward
// compatibility (single-assignee callers, e.g. the create-task form) — the
// three schemas below back the new add/remove/set operations that let a
// task carry more than one assignee.

// addTaskAssignee: adds exactly one assignee to a task's existing set.
export const addTaskAssigneeSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  userId: z.string().uuid("Invalid assignee."),
});

export type AddTaskAssigneeInput = z.infer<typeof addTaskAssigneeSchema>;

// removeTaskAssignee: removes exactly one assignee from a task's existing
// set, without affecting any other assignee (AS-289).
export const removeTaskAssigneeSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  userId: z.string().uuid("Invalid assignee."),
});

export type RemoveTaskAssigneeInput = z.infer<typeof removeTaskAssigneeSchema>;

// setTaskAssignees: replaces a task's entire assignee set in one call. An
// empty array is a valid, explicit "clear all assignees" input — mirrors
// assignTaskSchema's `assigneeId: null` meaning "unassign" (AS-053).
export const setTaskAssigneesSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  userIds: z
    .array(z.string().uuid("Invalid assignee."))
    .max(50, "A task can have at most 50 assignees."),
});

export type SetTaskAssigneesInput = z.infer<typeof setTaskAssigneesSchema>;

// Validates editTask input (F037: AS-054, AS-061). Partial update — every
// field besides taskId is optional, and only fields actually present in
// the update are validated/applied (a field genuinely absent from the
// input is left untouched on the row; this is why `.partial()` is used
// rather than `.optional().nullable()` per-field the way createTaskSchema
// does — createTask always writes every column, editTask must not clobber
// unspecified columns).
//
// AS-060: this type deliberately has no `projectId` field at all. Moving a
// task between projects is out of scope for v1 — not merely unhandled, but
// structurally impossible to attempt through this schema/action, since
// there is no field here that could carry a project id through to the
// update. Do not add one.
const editableFields = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Task title is required.")
    .max(500, "Task title must be 500 characters or fewer."),
  description: z
    .string()
    .trim()
    .max(10000, "Description must be 10000 characters or fewer.")
    .nullable(),
  // Matches `tasks_priority_check` in the tasks migration. Nullable — a
  // task may have no priority set at all (mirrors createTaskSchema).
  priority: z
    .enum(["urgent", "high", "medium", "low", "backlog"])
    .nullable(),
  // Plain YYYY-MM-DD string, matching the `date` column type — same
  // convention as createTaskSchema's dueDate field.
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid due date (YYYY-MM-DD).")
    .nullable(),
  // F166 (AS-298, AS-299): normalized minute count, already parsed from
  // human input (e.g. "2h", "90m") via lib/time/parse-estimate.ts before
  // reaching this schema — mirrors `tasks_estimate_minutes_positive` in
  // supabase/migrations/20260822030000_tasks_estimate_minutes.sql
  // (defense in depth: Zod rejects zero/negative here too, not only the
  // DB CHECK). Nullable — null clears a previously set estimate.
  estimateMinutes: z
    .number()
    .int("Estimate must be a whole number of minutes.")
    .positive("Estimate must be greater than zero.")
    .nullable(),
  // F179 (AS-317, AS-318, AS-319): the recurrence rule set/edited/cleared
  // by the task detail sheet's recurrence picker (components/task/
  // recurrence-editor.tsx). Mirrors `tasks_recurrence_shape`
  // (supabase/migrations/20260822140000_tasks_recurrence.sql, F175) as
  // client-side defense-in-depth (AS-146: the client check never stands
  // alone) — the DB CHECK constraint is still the real enforcement
  // boundary. Nullable — `null` is a deliberate, valid input meaning
  // "remove the rule" (AS-318/AS-319), not merely "field omitted"; an
  // omitted `recurrence` key (not present in `updates` at all) leaves the
  // existing rule untouched, same "only present fields are applied"
  // convention every other field in this schema follows.
  recurrence: z
    .object({
      freq: z.enum(["daily", "weekly", "monthly", "every_n_days"], {
        message: "Choose a valid recurrence frequency.",
      }),
      interval: z
        .number()
        .int("Interval must be a whole number.")
        .positive("Interval must be greater than zero."),
      until: z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid end date (YYYY-MM-DD).")
        .optional()
        .nullable(),
    })
    .nullable(),
});

const partialEditableFields = editableFields.partial();

export const editTaskSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  updates: partialEditableFields,
});

export type EditTaskInput = z.infer<typeof editTaskSchema>;
export type EditTaskUpdates = z.infer<typeof partialEditableFields>;

// Validates deleteTask input (F038: AS-055, AS-056, AS-057). Just the task
// id — soft delete has no other caller-supplied fields.
export const deleteTaskSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
});

export type DeleteTaskInput = z.infer<typeof deleteTaskSchema>;

// Validates updateTaskTags input (F041: AS-065, AS-066). Mirrors the
// `tags text[] not null default '{}'` column from
// supabase/migrations/20260818013434_create_tasks.sql. Each tag must be a
// non-empty trimmed string. AS-066: an empty array is explicitly allowed
// (removing all tags results in `[]`, never `null`) — there is no `.min(1)`
// on the array itself, only on each individual tag string.
export const updateTaskTagsSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  tags: z
    .array(
      z
        .string()
        .trim()
        .min(1, "Tags cannot be empty.")
        .max(50, "Tags must be 50 characters or fewer."),
    )
    .max(50, "A task can have at most 50 tags."),
});

export type UpdateTaskTagsInput = z.infer<typeof updateTaskTagsSchema>;

// Validates moveTaskStatus input (F045: AS-069). `status` is restricted to
// the same fixed 4-value set as createTaskSchema/`tasks_status_check` — the
// column dropped onto in the board is always one of these four, and any
// other string is rejected rather than silently coerced.
export const moveTaskStatusSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  status: z.enum(["todo", "in_progress", "in_review", "done"]),
});

export type MoveTaskStatusInput = z.infer<typeof moveTaskStatusSchema>;

// Validates reorderTask input (F046: AS-070, AS-078, AS-079). `position` is
// the already-computed fractional-index value (lib/board/position.ts's
// calculatePosition) — this schema only guards against a non-finite number
// reaching the DB (NaN/Infinity would corrupt AS-078's ascending order and
// violate AS-082's "never NaN" guarantee at the boundary where client input
// enters the server).
export const reorderTaskSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  position: z.number().finite("Invalid position."),
});

export type ReorderTaskInput = z.infer<typeof reorderTaskSchema>;

// Validates moveAndReorderTask input (F102: AS-077). Same field-level rules
// as moveTaskStatusSchema + reorderTaskSchema combined — this is the single
// atomic action a cross-column drag (status change + reposition) goes
// through, so both fields are validated together, before either reaches the
// database.
export const moveAndReorderTaskSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  status: z.enum(["todo", "in_progress", "in_review", "done"]),
  position: z.number().finite("Invalid position."),
});

export type MoveAndReorderTaskInput = z.infer<typeof moveAndReorderTaskSchema>;

// Validates promoteSubtask input (F149: AS-268). Just the task id — same
// shape as deleteTaskSchema, kept as its own named schema (rather than
// reused) for the same "one schema per action" convention every other
// action in this file follows.
export const promoteSubtaskSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
});

export type PromoteSubtaskInput = z.infer<typeof promoteSubtaskSchema>;

// Validates getOpenBlockers input (F158: AS-280, AS-281). Just the task
// id — same shape as deleteTaskSchema/promoteSubtaskSchema, kept as its
// own named schema for the same "one schema per action" convention every
// other action in this file follows.
export const getOpenBlockersSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
});

export type GetOpenBlockersInput = z.infer<typeof getOpenBlockersSchema>;

// Validates duplicateTask input (F180: AS-324, AS-325, AS-326, AS-327).
// Just the task id — same shape as deleteTaskSchema/promoteSubtaskSchema,
// same "one schema per action" convention as every other action in this
// file. No other caller-supplied fields: title marking, project, status,
// and position are all derived server-side from the source task, never
// accepted from the client (per this feature's Clarified implementation —
// only the files/inputs named in the spec, no extra surface area).
export const duplicateTaskSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
});

export type DuplicateTaskInput = z.infer<typeof duplicateTaskSchema>;

// Validates toggleDescriptionChecklistItem input (F173: AS-311). `itemId`
// is the taskItem node's `id` attribute assigned by
// components/editor/rich-text-editor.tsx's TaskItemWithId — a client
// (browser-generated) UUID-shaped string, not a DB primary key, so it's
// validated as a non-empty string rather than `.uuid()` (the fallback
// generator in rich-text-editor.tsx's `generateTaskItemId` doesn't always
// produce a UUID literal).
export const toggleDescriptionChecklistItemSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  itemId: z
    .string()
    .trim()
    .min(1, "Invalid checklist item.")
    .max(200, "Invalid checklist item."),
  checked: z.boolean(),
});

export type ToggleDescriptionChecklistItemInput = z.infer<
  typeof toggleDescriptionChecklistItemSchema
>;

// Validates bulkUpdateTasks input (F186: AS-337, AS-338, AS-341). Mirrors
// editTaskSchema's ".partial()" shape (only the fields actually present in
// `updates` are applied — status/assigneeId/priority/dueDate all
// omittable), but the writable field set is deliberately narrower than
// editTaskSchema: title/description/estimate/recurrence are single-task
// editor fields, not bulk fields, per this feature's Clarified
// implementation ("only the files named in the feature's Files section").
//
// taskIds: capped at 200 (this feature's own resolved "Notes for
// clarification" choice, recorded in the handoff's Decisions Made — the
// simplest option that adds no new dependency: large enough to cover a
// full page of the list view's select-all in every realistic project size
// this app supports, small enough that a single `UPDATE ... WHERE id =
// ANY($1)` stays a cheap single-statement write, AS-337/AS-338's
// performance-budget answer).
export const bulkUpdateTasksSchema = z
  .object({
    taskIds: z
      .array(z.string().uuid("Invalid task."))
      .min(1, "Select at least one task.")
      .max(200, "You can update at most 200 tasks at once."),
    updates: z
      .object({
        // Matches `tasks_status_check` — same fixed 4-value set as
        // moveTaskStatusSchema.
        status: z.enum(["todo", "in_progress", "in_review", "done"]),
        // null explicitly means "unassign", same convention as
        // assignTaskSchema's assigneeId.
        assigneeId: z.string().uuid("Invalid assignee.").nullable(),
        priority: z
          .enum(["urgent", "high", "medium", "low", "backlog"])
          .nullable(),
        dueDate: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid due date (YYYY-MM-DD).")
          .nullable(),
      })
      .partial()
      .refine((updates) => Object.keys(updates).length > 0, {
        message: "Choose at least one field to update.",
      }),
  })
  .refine((input) => new Set(input.taskIds).size === input.taskIds.length, {
    message: "Duplicate tasks in selection.",
    path: ["taskIds"],
  });

export type BulkUpdateTasksInput = z.infer<typeof bulkUpdateTasksSchema>;
export type BulkUpdateTasksUpdates = BulkUpdateTasksInput["updates"];
