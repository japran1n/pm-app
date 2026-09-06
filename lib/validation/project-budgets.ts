import { z } from "zod";

// F018 (missions/20260903-portal): validates project_budgets mutations
// (AS-033). Mirrors lib/validation/deliverables.ts's file shape — every
// action in lib/actions/project-budgets.ts re-validates with these
// schemas server-side, per this repo's "the client-side check never
// stands alone" convention.

// Plain YYYY-MM-DD string, matching the `date` column type — same
// convention as lib/validation/phases.ts's phaseDateSchema.
const budgetDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date (YYYY-MM-DD).")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Enter a valid date (YYYY-MM-DD).");

// Matches `project_budgets_no_overlap`'s companion "sold_minutes > 0"
// check. Entered as whole hours in the UI (F018's own spec: "sold
// hours"), converted to minutes before this schema sees it — see
// lib/actions/project-budgets.ts.
const soldMinutesSchema = z
  .number()
  .int("Sold hours must be a whole number of minutes once converted.")
  .positive("Sold hours must be greater than zero.");

// Matches `project_budgets_rollover_check`.
export const budgetRolloverSchema = z.enum(["none", "next_period", "unlimited"]);

const budgetCurrencySchema = z
  .string()
  .trim()
  .max(10, "Currency must be 10 characters or fewer.")
  .nullable();

const budgetRateSchema = z
  .number()
  .positive("Rate must be greater than zero.")
  .nullable();

const budgetNoteSchema = z
  .string()
  .trim()
  .max(2000, "Note must be 2000 characters or fewer.")
  .nullable();

export const createProjectBudgetSchema = z
  .object({
    projectId: z.string().uuid("Invalid project."),
    periodStart: budgetDateSchema,
    periodEnd: budgetDateSchema,
    soldMinutes: soldMinutesSchema,
    currency: budgetCurrencySchema.optional(),
    rateAmount: budgetRateSchema.optional(),
    rollover: budgetRolloverSchema.optional(),
    note: budgetNoteSchema.optional(),
  })
  .refine((value) => value.periodEnd >= value.periodStart, {
    message: "The period must end on or after its start date.",
    path: ["periodEnd"],
  });

export type CreateProjectBudgetInput = z.infer<typeof createProjectBudgetSchema>;

export const updateProjectBudgetSchema = z
  .object({
    budgetId: z.string().uuid("Invalid budget."),
    periodStart: budgetDateSchema,
    periodEnd: budgetDateSchema,
    soldMinutes: soldMinutesSchema,
    currency: budgetCurrencySchema,
    rateAmount: budgetRateSchema,
    rollover: budgetRolloverSchema,
    note: budgetNoteSchema,
  })
  .refine((value) => value.periodEnd >= value.periodStart, {
    message: "The period must end on or after its start date.",
    path: ["periodEnd"],
  });

export type UpdateProjectBudgetInput = z.infer<typeof updateProjectBudgetSchema>;

export const deleteProjectBudgetSchema = z.object({
  budgetId: z.string().uuid("Invalid budget."),
});

export type DeleteProjectBudgetInput = z.infer<typeof deleteProjectBudgetSchema>;

// previewProjectBudgetSpent (F018): read-only preview used by the create/
// edit form to show "already spent in this period" beside the sold-hours
// field, per this feature's own spec — no persistence, just a read.
export const previewProjectBudgetSpentSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  periodStart: budgetDateSchema,
  periodEnd: budgetDateSchema,
});

export type PreviewProjectBudgetSpentInput = z.infer<
  typeof previewProjectBudgetSpentSchema
>;

// Paket B (client-portal redesign): matches `project_billing_model`
// (20261105010000_project_billing_model.sql).
export const projectBillingModelSchema = z.enum(["hourly", "fixed_price"]);

export const updateProjectBillingModelSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  billingModel: projectBillingModelSchema,
});

export type UpdateProjectBillingModelInput = z.infer<
  typeof updateProjectBillingModelSchema
>;
