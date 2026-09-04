import { z } from "zod";

// F020 (missions/20260903-portal): validates `project_metrics` /
// `metric_snapshots` / `project_improvements` mutations (AS-039, AS-040,
// AS-041). Mirrors lib/validation/deliverables.ts's file shape — every
// action in lib/actions/metrics.ts re-validates with these schemas
// server-side.

const metricNameSchema = z
  .string()
  .trim()
  .min(1, "Metric name is required.")
  .max(200, "Metric name must be 200 characters or fewer.");

const metricUnitSchema = z
  .string()
  .trim()
  .max(40, "Unit must be 40 characters or fewer.")
  .nullable();

// Matches `project_metrics_source_check`
// (20261013010000_f020_metrics_snapshots_improvements_baseline_freeze.sql).
export const metricSourceSchema = z.enum(["gsc", "ga4", "lighthouse", "crux", "manual", "other"]);

// Matches `project_metrics_direction_check`. AS-039's own weight: this is
// not decoration — for-lower-is-better metrics (LCP) and
// for-higher-is-better metrics (sessions) share this same column.
export const metricDirectionSchema = z.enum(["higher", "lower"]);

// Numeric fields accept a finite number or null — the app never sends a
// string here (unlike the date fields elsewhere in this repo, `numeric`
// columns round-trip through supabase-js as `number | null` already).
const metricNumberSchema = z.number().finite().nullable();

// Plain YYYY-MM-DD string, matching the `date` column type — same
// convention as lib/validation/phases.ts's phaseDateSchema.
const metricDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date (YYYY-MM-DD).")
  .nullable();

export const createMetricSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  name: metricNameSchema,
  unit: metricUnitSchema.optional(),
  source: metricSourceSchema,
  baselineValue: metricNumberSchema.optional(),
  baselineAt: metricDateSchema.optional(),
  targetValue: metricNumberSchema.optional(),
  direction: metricDirectionSchema,
  displayMax: metricNumberSchema.optional(),
});

export type CreateMetricInput = z.infer<typeof createMetricSchema>;

export const updateMetricSchema = z.object({
  metricId: z.string().uuid("Invalid metric."),
  name: metricNameSchema,
  unit: metricUnitSchema,
  source: metricSourceSchema,
  baselineValue: metricNumberSchema,
  baselineAt: metricDateSchema,
  targetValue: metricNumberSchema,
  direction: metricDirectionSchema,
  displayMax: metricNumberSchema,
  clientVisible: z.boolean(),
});

export type UpdateMetricInput = z.infer<typeof updateMetricSchema>;

export const reorderMetricSchema = z.object({
  metricId: z.string().uuid("Invalid metric."),
  direction: z.enum(["up", "down"]),
});

export type ReorderMetricInput = z.infer<typeof reorderMetricSchema>;

export const deleteMetricSchema = z.object({
  metricId: z.string().uuid("Invalid metric."),
});

export type DeleteMetricInput = z.infer<typeof deleteMetricSchema>;

export const createSnapshotSchema = z.object({
  metricId: z.string().uuid("Invalid metric."),
  value: z.number().finite("Enter a valid number."),
  measuredAt: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date (YYYY-MM-DD)."),
  note: z.string().trim().max(2000, "Note must be 2000 characters or fewer.").nullable().optional(),
});

export type CreateSnapshotInput = z.infer<typeof createSnapshotSchema>;

export const deleteSnapshotSchema = z.object({
  snapshotId: z.string().uuid("Invalid snapshot."),
});

export type DeleteSnapshotInput = z.infer<typeof deleteSnapshotSchema>;

// AS-040: freezing has no other input — it is a one-way flip of
// `projects.baseline_frozen_at`, scoped to the project by id alone.
export const freezeBaselineSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
});

export type FreezeBaselineInput = z.infer<typeof freezeBaselineSchema>;

const improvementAreaSchema = z
  .string()
  .trim()
  .min(1, "Area is required.")
  .max(200, "Area must be 200 characters or fewer.");

const improvementExplanationSchema = z
  .string()
  .trim()
  .min(1, "Explanation is required.")
  .max(2000, "Explanation must be 2000 characters or fewer.");

export const createImprovementSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  area: improvementAreaSchema,
  explanation: improvementExplanationSchema,
});

export type CreateImprovementInput = z.infer<typeof createImprovementSchema>;

export const updateImprovementSchema = z.object({
  improvementId: z.string().uuid("Invalid improvement."),
  area: improvementAreaSchema,
  explanation: improvementExplanationSchema,
  clientVisible: z.boolean(),
});

export type UpdateImprovementInput = z.infer<typeof updateImprovementSchema>;

export const reorderImprovementSchema = z.object({
  improvementId: z.string().uuid("Invalid improvement."),
  direction: z.enum(["up", "down"]),
});

export type ReorderImprovementInput = z.infer<typeof reorderImprovementSchema>;

export const deleteImprovementSchema = z.object({
  improvementId: z.string().uuid("Invalid improvement."),
});

export type DeleteImprovementInput = z.infer<typeof deleteImprovementSchema>;

export const uploadImprovementImageSchema = z.object({
  improvementId: z.string().uuid("Invalid improvement."),
  side: z.enum(["before", "after"]),
});

export type UploadImprovementImageInput = z.infer<typeof uploadImprovementImageSchema>;
