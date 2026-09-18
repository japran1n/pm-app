import { z } from "zod";
import { workCategorySchema } from "./time-entries";

// Mission 20260910-182104, F010: validation for the architecture board's
// create/update actions (lib/actions/architecture.ts). Standing decision 1
// (clarifications/standing-decisions.md): a page IS a task with
// `page_slug` set and the workspace `page` task type; a section IS that
// task's subtask. These schemas guard shape only -- existence/ownership
// checks (project membership, the page a section belongs to, etc.) happen
// server-side in the action, same convention as
// lib/validation/tasks.ts's createTaskSchema.

// AS-031: new pages default to `page_kind = 'static'` when not supplied.
export const pageKindEnum = z.enum(["static", "cms", "cms_template", "utility"]);

// AS-039 (this mission's naming assertion): name is required, non-empty
// after trimming.
// AS-016: slugs may contain nested path segments (e.g. "services/seo").
// Allowed characters are lowercase letters, digits, hyphens, and forward
// slashes; no leading/trailing/double slashes.
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

export const createPageSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Page name is required.")
    .max(200, "Page name must be 200 characters or fewer."),
  slug: z
    .string()
    .trim()
    .min(1, "Page slug is required.")
    .max(200, "Page slug must be 200 characters or fewer.")
    .regex(
      slugPattern,
      "Slug can only contain lowercase letters, numbers, hyphens, and forward slashes for nested paths.",
    ),
  page_kind: pageKindEnum.default("static"),
});

export type CreatePageInput = z.infer<typeof createPageSchema>;

// AS-040 (this mission's naming assertion): section title is required,
// non-empty after trimming. `page_id` names the parent page task this
// section is created under (F013 is the first caller of this schema).
export const createSectionSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Section title is required.")
    .max(200, "Section title must be 200 characters or fewer."),
  page_id: z.string().uuid("Invalid page."),
});

export type CreateSectionInput = z.infer<typeof createSectionSchema>;

// Partial update of a page's own editable fields -- name/slug/page_kind
// only, matching createPageSchema's shape (F011+ is the first caller).
export const updatePageSchema = createPageSchema.partial();

export type UpdatePageInput = z.infer<typeof updatePageSchema>;

// --- Architecture enrichment (mission 20260918) ---

export { workCategorySchema };

export const estimateMinutesSchema = z.number().int().min(1, "Estimate must be at least 1 minute");

export const setDisciplineEstimateSchema = z.object({
  taskId: z.string().uuid(),
  discipline: workCategorySchema,
  input: z.string().min(1).max(50),
  note: z.string().max(500).optional(),
});

export const disciplineEstimateEntrySchema = z.object({
  discipline: workCategorySchema,
  input: z.string().min(1).max(50),
  note: z.string().max(500).optional(),
});

export const setDisciplineEstimatesBulkSchema = z.object({
  taskId: z.string().uuid(),
  entries: z.array(disciplineEstimateEntrySchema).min(1).max(5),
});

export const clearDisciplineEstimateSchema = z.object({
  taskId: z.string().uuid(),
  discipline: workCategorySchema,
});

export const copyStatusSchema = z.enum(["not_started", "brief_ready", "drafted", "in_review", "approved"]);

export const setNodeMetaSchema = z.object({
  taskId: z.string().uuid(),
  patch: z.object({
    intent: z.string().max(1000).optional(),
    audience: z.string().max(500).optional(),
    primaryCta: z.string().max(200).optional(),
    tone: z.string().max(200).optional(),
    keywords: z.array(z.string().max(50)).max(30).optional(),
    copyStatus: copyStatusSchema.optional(),
  }),
});

export const setNodeMetaClientVisibilitySchema = z.object({
  taskId: z.string().uuid(),
  visible: z.boolean(),
});
