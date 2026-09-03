import { z } from "zod";

// F002 (missions/20260903-portal): validates project-phase mutations
// (AS-008) and the task<->phase assignment writes (AS-013). Mirrors
// lib/validation/statuses.ts's file shape (F219) — every action in
// lib/actions/phases.ts re-validates with these schemas server-side, per
// this repo's "the client-side check never stands alone" convention
// (AS-146's rationale, applied here even though this feature has no
// AS-146 assertion of its own).

// Matches `project_phases_name_not_empty` (supabase/migrations/
// 20260909010000_portal_foundations.sql) — trimmed, non-empty, capped the
// same way every other short text field in this codebase is (see
// lib/validation/statuses.ts's columnNameSchema).
const phaseNameSchema = z
  .string()
  .trim()
  .min(1, "Phase name is required.")
  .max(120, "Phase name must be 120 characters or fewer.");

// Client-facing explanation shown in the portal (F001's
// `project_phases.client_description`, plain text column, nullable).
// Optional/nullable: a phase can have no client description yet.
const phaseClientDescriptionSchema = z
  .string()
  .trim()
  .max(2000, "Description must be 2000 characters or fewer.")
  .nullable();

// Matches `project_phases_state_check`.
const phaseStateSchema = z.enum([
  "not_started",
  "active",
  "blocked",
  "done",
]);

// Plain YYYY-MM-DD string, matching the `date` column type — same
// convention as lib/validation/tasks.ts's dueDate/startDate fields.
const phaseDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date (YYYY-MM-DD).")
  .nullable();

export const createPhaseSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  name: phaseNameSchema,
  clientDescription: phaseClientDescriptionSchema.optional(),
  plannedStart: phaseDateSchema.optional(),
  plannedEnd: phaseDateSchema.optional(),
});

export type CreatePhaseInput = z.infer<typeof createPhaseSchema>;

export const updatePhaseSchema = z.object({
  phaseId: z.string().uuid("Invalid phase."),
  name: phaseNameSchema,
  clientDescription: phaseClientDescriptionSchema,
  state: phaseStateSchema,
  plannedStart: phaseDateSchema,
  plannedEnd: phaseDateSchema,
  clientVisible: z.boolean(),
});

export type UpdatePhaseInput = z.infer<typeof updatePhaseSchema>;

// F002 Notes: "Reordering: reuse the same interaction the columns
// settings page uses for statuses. Do not introduce a second drag
// library." Unlike `project_statuses.position` (double precision, so
// status-manager.tsx's reorderColumn computes a fractional midpoint via
// calculatePosition), `project_phases.position` is a plain `integer`
// (F001's migration) — a fractional value would not round-trip cleanly
// through that column. `reorderPhases` therefore takes a direction, not a
// caller-computed position: the action itself loads the moved phase's
// immediate neighbor and swaps their two integer position values, the
// same move-up/move-down INTERACTION status-manager.tsx exposes, adapted
// to an integer-position table.
export const reorderPhaseSchema = z.object({
  phaseId: z.string().uuid("Invalid phase."),
  direction: z.enum(["up", "down"]),
});

export type ReorderPhaseInput = z.infer<typeof reorderPhaseSchema>;

export const deletePhaseSchema = z.object({
  phaseId: z.string().uuid("Invalid phase."),
});

export type DeletePhaseInput = z.infer<typeof deletePhaseSchema>;

export const seedDefaultPhasesSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
});

export type SeedDefaultPhasesInput = z.infer<typeof seedDefaultPhasesSchema>;

// AS-013: assigns (or clears, via `phaseId: null`) a single task's phase
// from the task detail sheet / new-task dialog.
export const setTaskPhaseSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  phaseId: z.string().uuid("Invalid phase.").nullable(),
});

export type SetTaskPhaseInput = z.infer<typeof setTaskPhaseSchema>;

// Bulk "Move to phase" action (components/task/bulk-action-bar.tsx),
// mirroring bulkUpdateTasksSchema's own cap (lib/validation/tasks.ts) so
// this action can never be asked to move more rows than a single UPDATE
// statement should reasonably cover in one call.
export const bulkSetTaskPhaseSchema = z.object({
  taskIds: z
    .array(z.string().uuid("Invalid task."))
    .min(1, "Select at least one task.")
    .max(200, "Select 200 tasks or fewer at a time."),
  phaseId: z.string().uuid("Invalid phase.").nullable(),
});

export type BulkSetTaskPhaseInput = z.infer<typeof bulkSetTaskPhaseSchema>;
