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
