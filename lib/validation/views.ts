import { z } from "zod";

// Mirrors supabase/migrations/20260826010000_create_saved_views.sql (F227:
// AS-426, AS-427, AS-434). Per this feature's Clarified implementation
// answer #7 ("the DB is the last line, not the only line"), every
// constraint enforced by that migration's CHECKs is re-validated here
// server-side before a write ever reaches the database, so a malformed
// payload gets a field-level message instead of a bare Postgres error.

export const savedViewNameSchema = z
  .string()
  .trim()
  .min(1, "View name is required.")
  .max(80, "View name must be 80 characters or fewer.");

// Matches the `scope in ('personal', 'shared')` CHECK.
export const savedViewScopeSchema = z.enum(["personal", "shared"]);
export type SavedViewScope = z.infer<typeof savedViewScopeSchema>;

// Matches the `view_type in ('board', 'list', 'calendar', 'timeline')`
// CHECK.
export const savedViewTypeSchema = z.enum(["board", "list", "calendar", "timeline"]);
export type SavedViewType = z.infer<typeof savedViewTypeSchema>;

// Filters: an open-ended, evolving set of field/operator/value predicates.
// Kept loose (record of unknown) at this layer deliberately -- new filter
// fields are added by later features (F228/F229) without a DB migration
// each time, but the top-level shape (array of objects) is still checked
// so a malformed payload never silently persists.
// Follow-up (advanced filtering, partial): `operator` stays a loose string
// (not a strict enum) for the same forward-compatibility reason as the
// rest of this schema, but "eq" and "in" are the two operators this
// codebase's readers (lib/views/resolve-view.ts, lib/views/apply-view.ts)
// actually understand today -- "in" carries an array `value` for a
// multi-select filter (e.g. `status IN ['todo', 'in_progress']`).
// Full AND/OR condition-group nesting was NOT implemented in this pass;
// see this feature's follow-up notes for what's still needed.
const savedViewFilterSchema = z
  .object({
    field: z.string().trim().min(1, "Filter field is required."),
    operator: z.string().trim().min(1, "Filter operator is required."),
    value: z.unknown(),
  })
  .passthrough();

const savedViewSortSchema = z.object({
  field: z.string().trim().min(1, "Sort field is required."),
  direction: z.enum(["asc", "desc"]),
});

// AS-426: filters, sort, and grouping are all part of what a view saves.
export const savedViewConfigSchema = z.object({
  filters: z.array(savedViewFilterSchema).default([]),
  sort: z.array(savedViewSortSchema).default([]),
  groupBy: z.string().trim().nullable().default(null),
});

export type SavedViewConfig = z.infer<typeof savedViewConfigSchema>;

export const createSavedViewSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  // null = a workspace-level view (only meaningful when scope is 'shared';
  // a personal view is almost always project-scoped in practice, but the
  // DB does not force that -- the RLS predicate handles both).
  projectId: z.string().uuid("Invalid project.").nullable(),
  name: savedViewNameSchema,
  scope: savedViewScopeSchema.default("personal"),
  viewType: savedViewTypeSchema.default("list"),
  config: savedViewConfigSchema.default({ filters: [], sort: [], groupBy: null }),
  isDefault: z.boolean().default(false),
  // F401: optional so every existing caller of createSavedView (the
  // dropdown's "Save view" dialog) is unaffected — omitting it keeps the
  // DB column's own default (0). ViewTabs passes an explicit "end of the
  // row" position when saving a new tab.
  position: z.number().finite().optional(),
});

export type CreateSavedViewInput = z.infer<typeof createSavedViewSchema>;

export const updateSavedViewSchema = z.object({
  viewId: z.string().uuid("Invalid view."),
  name: savedViewNameSchema.optional(),
  scope: savedViewScopeSchema.optional(),
  viewType: savedViewTypeSchema.optional(),
  config: savedViewConfigSchema.optional(),
  isDefault: z.boolean().optional(),
  // F401 ("views as tabs"): the tab row's ordering. Reuses the exact same
  // fractional-index convention as every other reorderable list in this
  // codebase (lib/board/position.ts's calculatePosition) — no new
  // ordering scheme invented for this one case.
  position: z.number().finite().optional(),
});

export type UpdateSavedViewInput = z.infer<typeof updateSavedViewSchema>;
