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

// F001: `setDefaultTemplate(templateId | null)` — `templateId: null`
// clears the workspace's current default (same "remove default" action
// the templates UI offers), so this is deliberately NOT
// `deleteTemplateSchema`-shaped (a bare required uuid); `templateId` is
// nullable, and `workspaceId` is required since clearing has no template
// row to resolve a workspace from.
export const setDefaultTemplateSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  templateId: z.string().uuid("Invalid template.").nullable(),
});
export type SetDefaultTemplateInput = z.infer<typeof setDefaultTemplateSchema>;

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
// F001 (missions/20260921-clickup-website-template): a task's own base
// shape, factored out so both the flat schema below and the recursive
// `children`-aware schema can share the exact same field list without
// duplicating it — `z.lazy` (used below for recursion) needs a function
// that returns a schema, and building that function's body from this
// shared base keeps the two in lockstep.
const projectTemplateTaskBaseShape = {
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
  // F001: optional phase name, matched against this template's own
  // `phases[].name` by `create_project_from_template`. Not a
  // `phase_id` -- templates are content snapshots reused across
  // arbitrary future projects, where a phase created from THIS
  // template's own `phases[]` array won't have an id until the RPC
  // creates it, so the join key has to be the name, resolved inside the
  // same RPC call (see that migration's own comment). A name that
  // doesn't match any phase in this template (or is simply absent)
  // resolves to no phase -- never an error, per this feature's
  // "templates are best-effort content" posture every other optional
  // field here already has.
  phase: z.string().trim().min(1).optional(),
};

// F001: recursive `children` field, one seeded task's own subtasks
// (`tasks.parent_task_id`), same shape all the way down. Bounded to
// depth 5 (this feature's clarified depth limit) via `.superRefine` on
// the top-level array below, rather than in the recursive type itself
// (z.lazy has no clean way to thread a decrementing depth counter
// through its own schema), so the bound is enforced once, centrally,
// against the whole tree instead of duplicated per level.
//
// An explicit interface + `z.ZodType<...>` annotation on the `z.lazy`
// schema is required here (rather than letting `z.infer` derive the type
// from the schema itself, as every other schema in this file does) —
// TypeScript cannot infer a recursive type from a function that returns
// its own inferred type without an explicit annotation breaking the
// circularity.
interface ProjectTemplateTaskShape {
  title: string;
  description: string | null;
  description_json: unknown;
  priority: "urgent" | "high" | "medium" | "low" | "backlog" | null;
  checklistItems: { content: string; position: number }[];
  estimate_minutes: number | null;
  tags: string[];
  phase?: string;
  children: ProjectTemplateTaskShape[];
}

const projectTemplateTaskSchemaLazy: z.ZodType<ProjectTemplateTaskShape> = z.lazy(() =>
  z.object({
    ...projectTemplateTaskBaseShape,
    children: z.array(projectTemplateTaskSchemaLazy).default([]),
  }),
);

const MAX_TASK_TREE_DEPTH = 5;

// Returns the depth of the deepest subtree rooted at any task in `tasks`,
// counting each task itself as depth 1 (a leaf with no children is depth
// 1, not 0) — called with `[task]` from the superRefine below so the
// task being validated is itself included in its own depth count.
function taskTreeDepth(tasks: readonly { children?: readonly unknown[] }[]): number {
  let maxDepth = 0;
  for (const task of tasks) {
    const children = task.children as
      | { children?: readonly unknown[] }[]
      | undefined;
    const childDepth = children && children.length > 0 ? taskTreeDepth(children) : 0;
    maxDepth = Math.max(maxDepth, 1 + childDepth);
  }
  return maxDepth;
}

export const projectTemplateTaskSchema = projectTemplateTaskSchemaLazy.superRefine(
  (task: ProjectTemplateTaskShape, ctx) => {
    const depth = taskTreeDepth([task]);
    if (depth > MAX_TASK_TREE_DEPTH) {
      ctx.addIssue({
        code: "custom",
        message: `Subtask nesting is limited to ${MAX_TASK_TREE_DEPTH} levels.`,
        path: ["children"],
      });
    }
  },
);
export type ProjectTemplateTask = ProjectTemplateTaskShape;

// The shape of a `kind: 'project'` template's `payload` jsonb column: an
// ORDERED list of tasks to seed into the new project (array order is
// preserved end-to-end, from save through to the created project's task
// order).
//
// F218 (custom project statuses/columns) landed
// (supabase/migrations/20260824010000_project_statuses.sql:
// `project_statuses` table + `tasks.status_id`), but this schema still
// has NO `columns`/per-task-status field, and that remains a deliberate
// gap, not an oversight: `create_project_from_template` seeds every task
// with the fixed literal status `'todo'` (a plain `tasks.status` text
// value) and never touches `tasks.status_id`/`project_statuses` at all,
// same as every other project-creation path that predates F218 —
// updating every project-creation entry point to seed custom
// status/column rows is F218's own follow-up scope, not this feature's.
// Per this mission's "additive first, don't invent dependencies that
// don't exist yet" convention, this schema still has NO `columns` field:
// when a future feature threads `project_statuses` through project
// creation generally, it should add an OPTIONAL `columns` field here
// (optional so existing saved templates without it keep parsing) and
// extend both `saveProjectAsTemplate` (to snapshot the source project's
// real columns) and `create_project_from_template` (supabase/migrations/
// 20260822190000_rpc_create_project_from_template.sql, most recently
// amended by this feature's own
// 20261128020000_f001_template_subtasks_phase_default.sql) to create
// those columns before seeding tasks into them by name/id instead of
// always `'todo'`.
// F006c (missions/20260903-portal, AS-009): a single seeded phase inside
// a project template's payload. Field names are snake_case, matching
// `project_phases`' own columns exactly — same "the payload shape maps
// straight onto the jsonb the RPC consumes" convention
// `projectTemplateTaskSchema` above already establishes for tasks.
// `name`/`client_description`/`client_visible` are captured: a template
// snapshots a phase's identity, its client-facing explanation, AND
// whether it is visible to the client at all — visibility is a privacy
// decision made about the phase, not a snapshot of an in-flight
// project's current progress, so it belongs in the template alongside
// name/client_description, unlike `state`/dates which
// `create_project_from_template`
// (supabase/migrations/20260915010000_create_project_from_template_phases.sql,
// amended by
// supabase/migrations/20260917020000_create_project_from_template_phase_visibility.sql)
// leaves at their column defaults for every newly-seeded phase.
//
// F006h (missions/20260903-portal, M1-scrutiny-2.md NM-2/FU-18): before
// this field existed, `saveProjectAsTemplate` never selected
// `client_visible` at all, so `create_project_from_template` always left
// it at the `project_phases` column default of `true` — a phase
// deliberately hidden from the client in the source project came back
// VISIBLE in every project created from that template. `.default(true)`
// (not `.optional()` alone) means a template saved before this fix,
// whose stored payload has no `client_visible` key on a phase at all,
// still parses — and defaults to the same `true` that
// `create_project_from_template` already defaulted it to, so pre-existing
// templates keep behaving exactly as they did before (never a
// behavioural change for data that predates this fix).
export const projectTemplatePhaseSchema = z.object({
  name: z.string().trim().min(1, "Phase name is required."),
  client_description: z.string().nullable(),
  client_visible: z.boolean().default(true),
});
export type ProjectTemplatePhase = z.infer<typeof projectTemplatePhaseSchema>;

// F013 (missions/20260903-portal, AS-028): a single seeded client
// deliverable inside a project template's payload. No `due_at` (an
// absolute date makes no sense inside a reusable template, per the RPC's
// own comment) — `due_offset_days` is nullable, and when set the seeded
// deliverable's `due_at` becomes `current_date + due_offset_days` at
// creation time, resolved entirely inside `create_project_from_template`
// (supabase/migrations/
// 20260927020000_f013_project_template_deliverables.sql). `state`/
// `delivered_at`/`accepted_at`/`accepted_by`/`review_note` are never
// part of this payload — same "a template captures identity and
// client-facing content, never a snapshot of in-flight progress" rule
// `projectTemplatePhaseSchema` already documents for phases.
export const projectTemplateDeliverableSchema = z.object({
  title: z.string().trim().min(1, "Deliverable title is required."),
  description: z.string().nullable(),
  kind: z.enum(["copy", "image", "access", "decision", "data", "other"]),
  owner_name: z.string().trim().min(1, "Owner name is required."),
  blocking: z.boolean().default(false),
  due_offset_days: z.number().int().nullable().default(null),
});
export type ProjectTemplateDeliverable = z.infer<
  typeof projectTemplateDeliverableSchema
>;

// F080 (missions/20260910-182104, AS-165/166/167): a single seeded brief
// question inside a project template's payload. Field names mirror
// `brief_questions`' own columns (supabase/migrations/
// 20261122010000_f044_brief_tables.sql) exactly, minus `id`/`project_id`
// (a template's questions are content, never tied to a specific project
// row) -- same "the payload shape maps straight onto the source table's
// columns" convention `projectTemplatePhaseSchema` and
// `projectTemplateDeliverableSchema` already establish. Deliberately
// carries QUESTIONS only, never answers: `brief_answers` is keyed by
// `brief_id`, not `project_id`, so there is no answer row this snapshot
// could even reach -- AS-167 ("no answers copied") holds structurally,
// not just by omission here.
export const projectTemplateBriefQuestionSchema = z.object({
  category: z.string().nullable(),
  prompt: z.string().trim().min(1, "Question prompt is required."),
  help_text: z.string().nullable(),
  answer_type: z.enum([
    "short_text",
    "long_text",
    "single_choice",
    "multi_choice",
  ]),
  options: z.array(z.string()).nullable(),
  required: z.boolean().default(false),
});
export type ProjectTemplateBriefQuestion = z.infer<
  typeof projectTemplateBriefQuestionSchema
>;

export const projectTemplatePayloadSchema = z.object({
  tasks: z.array(projectTemplateTaskSchema),
  // F080 (AS-165): optional/defaulted -- not `.optional()` alone -- so a
  // template saved BEFORE this feature, whose stored `payload` jsonb has
  // no `briefQuestions` key at all, still parses successfully and
  // createProjectFromTemplate still has a plain `[]` to seed with, same
  // backward-compatibility mechanism `phases`/`deliverables` below already
  // use for their own later additions.
  briefQuestions: z.array(projectTemplateBriefQuestionSchema).default([]),
  // F013 (AS-028): optional/defaulted — not `.optional()` alone — so a
  // template saved BEFORE this feature, whose stored `payload` jsonb has
  // no `deliverables` key at all, still parses successfully and
  // createProjectFromTemplate still has a plain `[]` to pass through to
  // the RPC's own `p_deliverables` default. This is the mechanism behind
  // this feature's own Definition of done: "creating a project from an
  // existing template that has no deliverables[] section still works."
  deliverables: z.array(projectTemplateDeliverableSchema).default([]),
  // F006c (AS-009): optional/defaulted — not `.optional()` alone — so a
  // template saved BEFORE this feature, whose stored `payload` jsonb has
  // no `phases` key at all, still parses successfully and
  // createProjectFromTemplate still has a plain `[]` to pass through to
  // the RPC's own `p_phases` default, rather than a special-cased
  // undefined branch this action would otherwise need. This is the
  // mechanism behind this feature's own Definition of done: "Templates
  // without a phases section must keep working."
  phases: z.array(projectTemplatePhaseSchema).default([]),
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

// F005 (missions/20260909-ai-docs, AS-024/AS-002/AS-028): the shape of a
// `kind='doc'` template's `payload` jsonb column (widened onto
// `task_templates` by supabase/migrations/20260909064152_task_templates_doc_kind.sql).
// Same split as every other kind in this file: the DB stores an opaque
// jsonb blob and enforces workspace access via RLS; THIS schema is the
// only place payload shape is validated, at the Server Action / tool
// layer, never by a DB CHECK.
//
// `list_doc_templates` (lib/ai/tools/list-doc-templates.ts) parses every
// row's payload through this schema defensively (`safeParse`, never
// `parse`): templates are user-authored data, so a malformed or
// legacy-shaped payload must be skipped rather than throwing and crashing
// the whole tool call.
export const docTemplatePayloadSchema = z.object({
  sections: z.array(z.string()),
  rules: z.array(z.string()),
  tone: z.string().optional(),
  folderHint: z.string().optional(),
});
export type DocTemplatePayload = z.infer<typeof docTemplatePayloadSchema>;
