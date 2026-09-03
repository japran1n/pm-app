import { z } from "zod";

// F015 (missions/20260903-portal): validates team-side mutations on
// F012's `project_scope_items`, `project_decisions`, `project_assumptions`
// (AS-043, AS-044, AS-046) plus the client-facing "Not correct" flag
// (AS-046). Mirrors lib/validation/deliverables.ts's file shape — every
// action in lib/actions/project-records.ts re-validates with these
// schemas server-side.

const titleSchema = z
  .string()
  .trim()
  .min(1, "Title is required.")
  .max(200, "Title must be 200 characters or fewer.");

const descriptionSchema = z
  .string()
  .trim()
  .max(2000, "Description must be 2000 characters or fewer.")
  .nullable();

// ---------------------------------------------------------------------
// project_scope_items
// ---------------------------------------------------------------------

// Matches `project_scope_items_source_check`
// (20260926010000_deliverables_scope_decisions_assumptions.sql).
export const scopeItemSourceSchema = z.enum(["proposal", "change_request"]);

export const createScopeItemSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  title: titleSchema,
  description: descriptionSchema.optional(),
  included: z.boolean(),
  source: scopeItemSourceSchema,
});
export type CreateScopeItemInput = z.infer<typeof createScopeItemSchema>;

export const updateScopeItemSchema = z.object({
  scopeItemId: z.string().uuid("Invalid scope item."),
  title: titleSchema,
  description: descriptionSchema,
  included: z.boolean(),
  source: scopeItemSourceSchema,
});
export type UpdateScopeItemInput = z.infer<typeof updateScopeItemSchema>;

export const deleteScopeItemSchema = z.object({
  scopeItemId: z.string().uuid("Invalid scope item."),
});
export type DeleteScopeItemInput = z.infer<typeof deleteScopeItemSchema>;

// ---------------------------------------------------------------------
// project_decisions
// ---------------------------------------------------------------------

// Matches `project_decisions_decision_type_check`.
export const decisionTypeSchema = z.enum([
  "content",
  "brand",
  "technical",
  "commercial",
]);

const decisionDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date (YYYY-MM-DD).");

const decidedByNameSchema = z
  .string()
  .trim()
  .max(120, "Name must be 120 characters or fewer.")
  .nullable();

export const createDecisionSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  phaseId: z.string().uuid("Invalid phase.").nullable().optional(),
  title: titleSchema,
  rationale: descriptionSchema.optional(),
  decisionType: decisionTypeSchema,
  decidedOn: decisionDateSchema.optional(),
  decidedByName: decidedByNameSchema.optional(),
  clientVisible: z.boolean().optional(),
});
export type CreateDecisionInput = z.infer<typeof createDecisionSchema>;

export const updateDecisionSchema = z.object({
  decisionId: z.string().uuid("Invalid decision."),
  phaseId: z.string().uuid("Invalid phase.").nullable(),
  title: titleSchema,
  rationale: descriptionSchema,
  decisionType: decisionTypeSchema,
  decidedOn: decisionDateSchema,
  decidedByName: decidedByNameSchema,
  clientVisible: z.boolean(),
});
export type UpdateDecisionInput = z.infer<typeof updateDecisionSchema>;

export const deleteDecisionSchema = z.object({
  decisionId: z.string().uuid("Invalid decision."),
});
export type DeleteDecisionInput = z.infer<typeof deleteDecisionSchema>;

// The "Turn into decision" affordance (comment-list.tsx): carries the
// comment's own text, author and date verbatim, plus the task's phase.
// No decisionType field — see createDecisionFromComment's own doc
// comment in lib/actions/project-records.ts for why 'content' is the
// fixed default (editable afterwards in the Record panel like any other
// decision row) rather than a dialog asking the poster to classify it
// before they can even create the row.
export const createDecisionFromCommentSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  commentId: z.string().uuid("Invalid comment."),
  commentText: z
    .string()
    .trim()
    .min(1, "A decision needs some text.")
    .max(2000, "Comment text must be 2000 characters or fewer."),
  commentAuthorName: z.string().trim().max(120).nullable(),
  commentCreatedAt: z.string().trim().min(1, "Invalid comment date."),
});
export type CreateDecisionFromCommentInput = z.infer<
  typeof createDecisionFromCommentSchema
>;

// ---------------------------------------------------------------------
// project_assumptions
// ---------------------------------------------------------------------

// Matches `project_assumptions_state_check`.
export const assumptionStateSchema = z.enum([
  "assumed",
  "confirmed",
  "invalidated",
]);

const assumptionTextSchema = z
  .string()
  .trim()
  .min(1, "Assumption text is required.")
  .max(2000, "Assumption text must be 2000 characters or fewer.");

export const createAssumptionSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  text: assumptionTextSchema,
  clientVisible: z.boolean().optional(),
});
export type CreateAssumptionInput = z.infer<typeof createAssumptionSchema>;

export const updateAssumptionSchema = z.object({
  assumptionId: z.string().uuid("Invalid assumption."),
  text: assumptionTextSchema,
  state: assumptionStateSchema,
  clientVisible: z.boolean(),
});
export type UpdateAssumptionInput = z.infer<typeof updateAssumptionSchema>;

export const deleteAssumptionSchema = z.object({
  assumptionId: z.string().uuid("Invalid assumption."),
});
export type DeleteAssumptionInput = z.infer<typeof deleteAssumptionSchema>;

// AS-046 ("Not correct"): the client-facing flag_assumption_atomic call.
// A note is required — the RPC itself rejects an empty one (this
// migration's own check), this is just the same rule surfaced early.
export const flagAssumptionSchema = z.object({
  assumptionId: z.string().uuid("Invalid assumption."),
  note: z
    .string()
    .trim()
    .min(1, "Tell the team why this isn't right.")
    .max(2000, "Note must be 2000 characters or fewer."),
});
export type FlagAssumptionInput = z.infer<typeof flagAssumptionSchema>;
