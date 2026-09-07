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

export type FilterCondition = {
  field: string;
  operator: "eq" | "in";
  value: string | string[];
};

// Follow-up (nested AND/OR groups): a `FilterGroup` recursively contains
// either leaf `FilterCondition`s or further `FilterGroup`s, combined with
// its own `combinator`. This is the shape `lib/views/resolve-view.ts`'s
// recursive evaluator understands. `z.lazy()` is required because the
// schema references itself (a group's `conditions` array can itself hold
// groups) -- Zod can't infer a self-referential type without an explicit
// type annotation on the lazy schema.
export type FilterGroup = {
  combinator: "and" | "or";
  conditions: (FilterCondition | FilterGroup)[];
};

const filterConditionSchema: z.ZodType<FilterCondition> = z.object({
  field: z.string().trim().min(1, "Filter field is required."),
  operator: z.enum(["eq", "in"]),
  value: z.union([z.string(), z.array(z.string())]),
});

function isFilterGroupShape(value: unknown): value is { combinator: unknown; conditions: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "combinator" in value &&
    "conditions" in value
  );
}

// Recursive: a node in `conditions` is either a leaf condition (has
// `operator`/`value`) or another group (has `combinator`/`conditions`).
// `z.lazy()` defers evaluating `filterGroupSchema` until it's actually
// called, breaking the otherwise-infinite compile-time recursion.
export const filterGroupSchema: z.ZodType<FilterGroup> = z.lazy(() =>
  z.object({
    combinator: z.enum(["and", "or"]),
    conditions: z.array(z.union([filterConditionSchema, filterGroupSchema])),
  }),
);

// Backward compatibility: every `saved_views` row written before nested
// groups existed stores `config.filters` as a flat array of
// `{ field, operator, value }` conditions (implicitly AND-ed, per the old
// `savedViewFilterSchema`/`resolveListViewFilters` comments). Rather than
// migrating those rows, this adapter is called at READ time (wherever a
// config is consumed) to lift that flat array into the trivial
// `{ combinator: "and", conditions: [...] }` group shape the new recursive
// evaluator expects -- a flat array IS just a one-level "and" group, so no
// information is lost and no DB migration is needed.
export function normalizeFilterGroup(
  filters: unknown,
): FilterGroup {
  if (isFilterGroupShape(filters)) {
    const parsed = filterGroupSchema.safeParse(filters);
    if (parsed.success) return parsed.data;
  }

  if (Array.isArray(filters)) {
    const conditions: FilterCondition[] = [];
    for (const raw of filters) {
      if (
        raw &&
        typeof raw === "object" &&
        "field" in raw &&
        "operator" in raw &&
        (raw.operator === "eq" || raw.operator === "in")
      ) {
        const value = (raw as { value: unknown }).value;
        if (raw.operator === "in" && Array.isArray(value)) {
          conditions.push({
            field: String((raw as { field: unknown }).field),
            operator: "in",
            value: value.map((v) => String(v)),
          });
        } else if (raw.operator === "eq" && value != null) {
          conditions.push({
            field: String((raw as { field: unknown }).field),
            operator: "eq",
            value: String(value),
          });
        }
      }
    }
    return { combinator: "and", conditions };
  }

  return { combinator: "and", conditions: [] };
}

const savedViewSortSchema = z.object({
  field: z.string().trim().min(1, "Sort field is required."),
  direction: z.enum(["asc", "desc"]),
});

// AS-426: filters, sort, and grouping are all part of what a view saves.
// `filters` is kept for backward compatibility with every row written
// before nested groups existed (see `normalizeFilterGroup` above); new
// writers that need AND/OR nesting set `filterGroup` instead. Both are
// optional/defaulted so neither writer breaks the other -- a reader always
// goes through `normalizeFilterGroup`/`resolveEffectiveFilterGroup`, which
// prefers `filterGroup` when present and otherwise lifts `filters`.
export const savedViewConfigSchema = z.object({
  filters: z.array(savedViewFilterSchema).default([]),
  filterGroup: filterGroupSchema.optional(),
  sort: z.array(savedViewSortSchema).default([]),
  groupBy: z.string().trim().nullable().default(null),
});

export type SavedViewConfig = z.infer<typeof savedViewConfigSchema>;

// Single entry point every reader should call to get a config's effective
// filter tree, regardless of whether it was written before or after
// nested groups existed.
export function resolveEffectiveFilterGroup(config: SavedViewConfig): FilterGroup {
  if (config.filterGroup) return config.filterGroup;
  return normalizeFilterGroup(config.filters);
}

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
