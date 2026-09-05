import { z } from "zod";
import type { JSONContent } from "@tiptap/react";

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
  // F248 (AS-479): `tasks_status_check` was dropped by F221's
  // 20260824020000_project_statuses_management.sql migration once columns
  // became per-project (`project_statuses`) rather than a fixed four-value
  // enum — this now accepts any non-empty column name, same relaxed shape
  // moveTaskStatusSchema/moveAndReorderTaskSchema already use, so a
  // quick-add (or any other creation path) can target a project's real
  // custom column. createTaskForUser re-verifies the name against that
  // project's actual `project_statuses` rows server-side (mirrors
  // moveTaskStatus's own `project_statuses` lookup) before it's ever
  // written — this schema only guards shape, not existence.
  status: z
    .string()
    .trim()
    .min(1, "Status is required.")
    .max(100, "Status must be 100 characters or fewer.")
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
  // F116 (AS-058): a task always has a type. The create-task UI does not
  // yet offer a picker on this form (see this feature's own handoff,
  // "Out-of-scope work needed" — building/testing that across every
  // entry point — board quick-add, list, command palette, onboarding
  // tour, the browser extension route — was judged bigger than this
  // feature's own bounded scope), so this stays optional here: when
  // omitted, `lib/tasks/create.ts` resolves the caller's workspace
  // `delivery` type itself (the exact default `tasks_default_task_type`
  // would apply at the database level regardless — this only avoids an
  // extra round trip through that trigger). When a caller DOES supply
  // one (e.g. a future picker, or `duplicateTask` preserving the
  // source's type), it must be a real, non-empty id — never "no type".
  taskTypeId: z.string().uuid("Invalid task type.").optional(),
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
// F205 (AS-378): mirrors lib/validation/comments.ts's commentBodyJsonSchema
// exactly — same shallow "is this plausibly a Tiptap doc" shape check.
// This is deliberately NOT the real security boundary (that's
// components/editor/rich-text-editor.tsx's sanitiseDocument at render time,
// plus lib/comments/mentions.ts's sanitiseMentionsForVisibility at write
// time for mentions specifically) — this schema only rejects a request
// that isn't even shaped like a document, per AS-146.
const taskDescriptionJsonSchema = z
  .object({
    type: z.literal("doc"),
    content: z.array(z.unknown()).optional(),
  })
  .passthrough();

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
  // F236 (AS-453): a task's start date. Same "plain YYYY-MM-DD string,
  // format-only here" convention as dueDate immediately above — the real
  // "start date must not be after due date" invariant is enforced by
  // `tasks_start_date_not_after_due_date`
  // (supabase/migrations/20260828010000_tasks_start_date.sql) as the last
  // line of defense, and mirrored in the cross-field `.superRefine` below
  // (AS-146: the client check never stands alone) so a bad combination is
  // rejected before ever reaching the database. Nullable — null clears a
  // previously set start date, same convention as every other nullable
  // field in this schema.
  startDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid start date (YYYY-MM-DD).")
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
  // F205 (AS-378): the rich-text description document, written directly
  // (mirrors F173's toggleDescriptionChecklistItem's write shape — see
  // supabase/migrations/20260822130000_task_description_json_direct_write.sql's
  // trigger condition: an UPDATE that changes description_json but NOT
  // description is treated as authoritative and never overwritten by the
  // legacy plain-text-derivation path). Nullable — null clears the
  // description entirely (an empty Tiptap doc), same "explicit null is a
  // valid input" convention as every other nullable field in this schema.
  descriptionJson: taskDescriptionJsonSchema.nullable(),
  // F005 (missions/20260903-portal, AS-014): the portal Pages view's own
  // ordering/identity for a `page`-type task — edited from the task
  // detail sheet, same "plain scalar, no server-side transform" shape as
  // dueDate/startDate above. No DB CHECK constrains the slug's shape
  // (F001's migration comment is explicit that page_slug/page_order carry
  // no FK/CHECK tying them to `task_type = 'page'` — see that migration),
  // so this is defense-in-depth only, not mirroring an enforcement
  // boundary that doesn't exist. Lowercase URL-path segment: letters,
  // digits, hyphens, forward slashes (a page can sit at a nested path,
  // e.g. "services/design"). Nullable — clears a previously set slug.
  pageSlug: z
    .string()
    .trim()
    .toLowerCase()
    .max(200, "Page slug must be 200 characters or fewer.")
    .regex(
      /^\/?[a-z0-9]+(?:[-/][a-z0-9]+)*\/?$/,
      "Use lowercase letters, numbers, hyphens and slashes only.",
    )
    .nullable(),
  // F005 (AS-014): the team's own manual page ordering — the Pages view
  // sorts by this (nulls last), never by creation date. Nullable — clears
  // a previously set position back to "unordered" (sorts after every
  // explicitly ordered page, by title).
  pageOrder: z
    .number()
    .int("Page order must be a whole number.")
    .nullable(),
  // F006c (missions/20260903-portal, AS-013): this task's phase
  // assignment — same shape as `setTaskPhaseSchema.phaseId`
  // (lib/validation/phases.ts), threaded through editTask too per this
  // feature's own scope. `null` clears the assignment; a valid phase uuid
  // sets it. The cross-project check `setTaskPhase` performs (a phase id
  // for a DIFFERENT project than this task's own must be rejected) is
  // NOT expressible in a Zod schema — editTask re-checks it itself,
  // mirroring lib/actions/phases.ts's own `resolveWorkspace` shape, see
  // this schema's use below.
  phaseId: z.string().uuid("Invalid phase.").nullable(),
});

const partialEditableFields = editableFields.partial();

// F236 (AS-453): cross-field check mirroring
// `tasks_start_date_not_after_due_date`
// (supabase/migrations/20260828010000_tasks_start_date.sql) — only
// enforced when BOTH `startDate` and `dueDate` are present in the SAME
// `updates` call, since editTask is a partial update and a call that
// only touches one of the two fields has no way to know the other's
// current DB value client-side; the DB CHECK is the real last-line
// enforcement for the "only one field touched" case (per this schema's
// "DB is the last line, not the only line" convention).
const partialEditableFieldsWithDateOrder = partialEditableFields.superRefine(
  (updates, ctx) => {
    if (
      updates.startDate != null &&
      updates.dueDate != null &&
      updates.startDate > updates.dueDate
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Start date must not be after the due date.",
        path: ["startDate"],
      });
    }
  },
);

export const editTaskSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  updates: partialEditableFieldsWithDateOrder,
});

export type EditTaskInput = z.infer<typeof editTaskSchema>;
// F205 (AS-378): `descriptionJson`'s runtime schema uses `z.literal("doc")`
// (needed so a malformed request that isn't even shaped like a Tiptap doc
// is rejected server-side, per AS-146) but that produces an overly-narrow
// inferred TS type (`type: "doc"` rather than `type: string`) that real
// `JSONContent` values (e.g. from `@tiptap/react`'s own `Editor.getJSON()`)
// don't structurally satisfy. The runtime check stays exactly as strict as
// written above; only the exported TS type is widened back to `JSONContent`
// here, mirroring the same "schema validates narrowly, exported type stays
// usable" pattern lib/actions/comments.ts's `bodyJson?: JSONContent | null`
// parameter already uses for the identical comment-mentions case.
export type EditTaskUpdates = Omit<
  z.infer<typeof partialEditableFields>,
  "descriptionJson"
> & {
  descriptionJson?: JSONContent | null;
};

// Validates deleteTask input (F038: AS-055, AS-056, AS-057). Just the task
// id — soft delete has no other caller-supplied fields.
export const deleteTaskSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
});

export type DeleteTaskInput = z.infer<typeof deleteTaskSchema>;

// Validates restoreTask input (F189: AS-344, AS-351). Same shape as
// deleteTaskSchema — restore has no other caller-supplied fields, it
// always restores the task to its OWN recorded project/status, never a
// caller-chosen destination.
export const restoreTaskSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
});

export type RestoreTaskInput = z.infer<typeof restoreTaskSchema>;

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

// Validates moveTaskStatus input (F045: AS-069). F221 (AS-409): a
// project's board columns are now per-project (`project_statuses`), not a
// fixed 4-value set, so `status` accepts any non-empty column NAME up to
// the same length `tasks_status_not_empty` (F219's migration) allows —
// the action itself (moveTaskStatus, lib/actions/tasks.ts) is what
// verifies the name actually matches one of the caller's project's real
// columns before writing, since a plain string schema can't know that.
export const moveTaskStatusSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  status: z
    .string()
    .trim()
    .min(1, "Status is required.")
    .max(100, "Status must be 100 characters or fewer."),
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
// F221 (AS-409): same relaxation as moveTaskStatusSchema above — `status`
// is any non-empty column name, re-verified against the project's real
// `project_statuses` rows inside moveAndReorderTask itself.
export const moveAndReorderTaskSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  status: z
    .string()
    .trim()
    .min(1, "Status is required.")
    .max(100, "Status must be 100 characters or fewer."),
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

// Validates bulkDeleteTasks input (F187: AS-339, AS-340). Same shape as
// bulkUpdateTasksSchema's `taskIds` field (same 200-task cap and
// no-duplicates rule, for the same reasons documented on that schema —
// this is a sibling bulk action over the same list-view selection), minus
// the `updates` object since a delete has no fields to choose.
export const bulkDeleteTasksSchema = z.object({
  taskIds: z
    .array(z.string().uuid("Invalid task."))
    .min(1, "Select at least one task.")
    .max(200, "You can delete at most 200 tasks at once.")
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Duplicate tasks in selection.",
    }),
});

export type BulkDeleteTasksInput = z.infer<typeof bulkDeleteTasksSchema>;
