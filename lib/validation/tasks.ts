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
