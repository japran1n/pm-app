import { z } from "zod";

// F013 (missions/20260903-portal): validates client_deliverables
// mutations (AS-028, AS-032). Mirrors lib/validation/phases.ts's file
// shape — every action in lib/actions/deliverables.ts re-validates with
// these schemas server-side, per this repo's "the client-side check
// never stands alone" convention.

// Matches `client_deliverables_title_not_empty`
// (20260926010000_deliverables_scope_decisions_assumptions.sql).
const deliverableTitleSchema = z
  .string()
  .trim()
  .min(1, "Title is required.")
  .max(200, "Title must be 200 characters or fewer.");

// Matches `client_deliverables_owner_name_not_empty`.
const deliverableOwnerNameSchema = z
  .string()
  .trim()
  .min(1, "Owner name is required.")
  .max(120, "Owner name must be 120 characters or fewer.");

const deliverableDescriptionSchema = z
  .string()
  .trim()
  .max(2000, "Description must be 2000 characters or fewer.")
  .nullable();

// Matches `client_deliverables_kind_check`.
export const deliverableKindSchema = z.enum([
  "copy",
  "image",
  "access",
  "decision",
  "data",
  "other",
]);

// Plain YYYY-MM-DD string, matching the `date` column type — same
// convention as lib/validation/phases.ts's phaseDateSchema.
const deliverableDueAtSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date (YYYY-MM-DD).")
  .nullable();

export const createDeliverableSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  title: deliverableTitleSchema,
  description: deliverableDescriptionSchema.optional(),
  kind: deliverableKindSchema,
  ownerName: deliverableOwnerNameSchema,
  dueAt: deliverableDueAtSchema.optional(),
  blocking: z.boolean().optional(),
  taskId: z.string().uuid("Invalid task.").nullable().optional(),
  phaseId: z.string().uuid("Invalid phase.").nullable().optional(),
});

export type CreateDeliverableInput = z.infer<typeof createDeliverableSchema>;

export const updateDeliverableSchema = z.object({
  deliverableId: z.string().uuid("Invalid deliverable."),
  title: deliverableTitleSchema,
  description: deliverableDescriptionSchema,
  kind: deliverableKindSchema,
  ownerName: deliverableOwnerNameSchema,
  dueAt: deliverableDueAtSchema,
  blocking: z.boolean(),
  taskId: z.string().uuid("Invalid task.").nullable(),
  phaseId: z.string().uuid("Invalid phase.").nullable(),
});

export type UpdateDeliverableInput = z.infer<typeof updateDeliverableSchema>;

// Same "plain integer append/swap, no fractional midpoint" shape as
// lib/validation/phases.ts's reorderPhaseSchema — `client_deliverables.
// position` is a plain `integer` column (20260926010000), not `double
// precision`.
export const reorderDeliverableSchema = z.object({
  deliverableId: z.string().uuid("Invalid deliverable."),
  direction: z.enum(["up", "down"]),
});

export type ReorderDeliverableInput = z.infer<typeof reorderDeliverableSchema>;

export const deleteDeliverableSchema = z.object({
  deliverableId: z.string().uuid("Invalid deliverable."),
});

export type DeleteDeliverableInput = z.infer<typeof deleteDeliverableSchema>;

// AS-032: accept_deliverable_atomic's two decisions. `note` is only
// actually required by the RPC when decision = 'returned' (an empty note
// on 'accepted' is fine — see accept_deliverable_atomic's own SQL
// comment) — that conditional requirement lives in the RPC, the single
// source of truth for it, not duplicated here as a Zod
// `.superRefine()` that could drift from the database's own check.
export const decideDeliverableSchema = z.object({
  deliverableId: z.string().uuid("Invalid deliverable."),
  decision: z.enum(["accepted", "returned"]),
  note: z
    .string()
    .trim()
    .max(2000, "Note must be 2000 characters or fewer.")
    .nullable()
    .optional(),
});

export type DecideDeliverableInput = z.infer<typeof decideDeliverableSchema>;
