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

export type CreatePageInput = z.input<typeof createPageSchema>;

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

// AS-010..AS-014: sibling of changePageKind's validation above, for the
// `tasks.section_kind` column. Values are derived from a single source
// (this enum) rather than re-written per caller -- see tech-decisions.md
// ("Enumi se ne pišu dvaput"). Must match the DB CHECK constraint exactly:
// supabase/migrations/20261124010000_architecture_cms_template_and_section_kind.sql
// (`tasks_section_kind_check`: 'static', 'cms').
export const SECTION_KINDS = ["static", "cms"] as const;
export const sectionKindEnum = z.enum(SECTION_KINDS);
export type SectionKind = z.infer<typeof sectionKindEnum>;

// F047 (AS-159, AS-160, AS-161): reorders the components list on the
// Architecture board. Components live in `page_components` (not `tasks` --
// see lib/queries/architecture.ts), so this is a full-list replacement of
// `position` scoped to a single project, not a partial batch of
// `{id, position}` pairs like reorderPages/reorderSections use for
// task-backed rows.
export const reorderComponentsSchema = z.object({
  projectId: z.string().uuid(),
  componentIds: z
    .array(z.string().uuid())
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Component IDs must be unique",
    }),
});

export type ReorderComponentsInput = z.infer<typeof reorderComponentsSchema>;

export const changeSectionKindSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  kind: sectionKindEnum,
});

export type ChangeSectionKindInput = z.infer<typeof changeSectionKindSchema>;

// AS-139/AS-140: page slug change schema. Shape mirrors createPageSchema's
// slug field. AS-141 (uniqueness among sibling pages) is a server-side
// check that happens in the action (lib/actions/architecture/pages.ts,
// F042) -- this schema only guards shape, same convention as
// changeSectionKindSchema above.
export const changePageSlugSchema = z.object({
  taskId: z.string().uuid(),
  slug: z
    .string()
    .trim()
    .min(1, "Page slug is required.")
    .max(200, "Page slug must be 200 characters or fewer.")
    .regex(
      slugPattern,
      'Page slug may only contain lowercase letters, numbers, and hyphens, optionally separated by "/".',
    ),
});

export type ChangePageSlugInput = z.infer<typeof changePageSlugSchema>;

// --- Architecture enrichment (mission 20260918) ---

export { workCategorySchema };

// Raw estimate string as typed by the user, e.g. "2h 30m", "90m", "1.5h".
// Parsed to minutes server-side via parseDurationToMinutes
// (lib/time/parse-duration.ts), the app's single duration parser.
export const estimateInputSchema = z.string().min(1).max(50);

export const estimateMinutesSchema = z.number().int().min(1, "Estimate must be at least 1 minute");

// Discipline estimate note: capped at 200 characters (AS-073). The error
// message reports exactly how many characters over the limit the input is,
// so it can be shown inline in the estimate popover without further
// formatting by the caller.
export const NOTE_MAX_LENGTH = 200;

export const disciplineEstimateNoteSchema = z
  .string()
  .optional()
  .refine((value) => !value || value.length <= NOTE_MAX_LENGTH, {
    error: (issue) => {
      const value = issue.input as string | undefined;
      const over = (value?.length ?? 0) - NOTE_MAX_LENGTH;
      return `Note is ${over} character${over === 1 ? "" : "s"} over the ${NOTE_MAX_LENGTH}-character limit.`;
    },
  });

export const setDisciplineEstimateSchema = z.object({
  taskId: z.string().uuid(),
  discipline: workCategorySchema,
  input: estimateInputSchema,
  note: disciplineEstimateNoteSchema,
});

export const disciplineEstimateEntrySchema = z.object({
  discipline: workCategorySchema,
  input: estimateInputSchema,
  note: disciplineEstimateNoteSchema,
});

// Bulk entries allow an empty `input` -- an empty string means "clear this
// discipline's estimate" rather than "set it to an invalid value". This is
// what lets the popover always send all five disciplines in a single call
// (some set, some cleared) instead of looping per-discipline actions.
export const bulkDisciplineEstimateEntrySchema = z.object({
  discipline: workCategorySchema,
  input: z.string().max(50),
  note: disciplineEstimateNoteSchema,
});

export const setDisciplineEstimatesBulkSchema = z.object({
  taskId: z.string().uuid(),
  entries: z.array(bulkDisciplineEstimateEntrySchema).min(1).max(5),
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

