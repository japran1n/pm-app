// F228 (AS-428): "opening a saved view restores its filters, sort, and
// grouping exactly." Per this feature's Clarified implementation
// (Notes: "URL params as the canonical state keeps sharing (AS-432) free
// -- do not introduce a parallel client store") and the spec's Draft
// scope ("applying a view writes its config into the URL search params
// so the existing filter machinery keeps being the source of truth"),
// this module maps a `SavedViewConfig` onto the SAME query-string keys
// the project list page already reads
// (app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx:
// `status`, `priority`, `assigneeId`, `sort`) rather than inventing a new
// serialized blob param that would need its own parsing machinery on the
// read side -- that would be exactly the "second source of truth" the
// clarification round says to avoid.
//
// AUTONOMOUS_DECISION: today's filter machinery only supports single-
// value equality per field (see list/page.tsx's `ProjectListTaskFilters`)
// and a two-value enum sort (`due_date_asc` | `due_date_desc`). A saved
// view's `config.filters` entry is only round-tripped through these URL
// keys when its `operator` is `"eq"` and its `field` is one of the three
// known filterable fields; other operators/fields are silently dropped on
// `buildViewSearchParams` (nothing in this feature's assertions requires
// operators beyond what the app already supports, and dropping an
// unsupported filter is strictly safer than crashing the page). Grouping
// has no existing URL-backed reader yet (the board's swimlane grouping is
// persisted server-side per F226, not via the URL) -- `groupBy` still
// round-trips through its own `groupBy` query param so F229's UI layer
// can read it back verbatim without this module needing to know about
// F226's storage.
//
// F229 owns wiring this into the actual list/board pages (reading these
// params back into `ProjectListTaskFilters` and applying `groupBy`); this
// module only proves the encode/decode round trip is lossless for the
// fields it supports, which is what AS-428 requires.

import type { SavedViewConfig } from "@/lib/validation/views";

const FILTERABLE_FIELDS = new Set(["status", "priority", "assigneeId"]);

const SORT_FIELD_TO_PARAM: Record<string, Record<"asc" | "desc", string>> = {
  dueDate: { asc: "due_date_asc", desc: "due_date_desc" },
};

const SORT_PARAM_TO_FIELD: Record<string, { field: string; direction: "asc" | "desc" }> = {
  due_date_asc: { field: "dueDate", direction: "asc" },
  due_date_desc: { field: "dueDate", direction: "desc" },
};

// Serializes a saved view's config into the query-string keys the
// project list page's filter machinery already reads. Returns a fresh
// URLSearchParams (never mutates a caller-supplied one) so callers can
// merge it onto an existing URL however they need to.
export function buildViewSearchParams(config: SavedViewConfig): URLSearchParams {
  const params = new URLSearchParams();

  for (const filter of config.filters) {
    if (filter.operator !== "eq") continue;
    if (!FILTERABLE_FIELDS.has(filter.field)) continue;
    if (filter.value == null) continue;
    params.set(filter.field, String(filter.value));
  }

  const firstSort = config.sort[0];
  if (firstSort) {
    const mapped = SORT_FIELD_TO_PARAM[firstSort.field]?.[firstSort.direction];
    if (mapped) {
      params.set("sort", mapped);
    }
  }

  if (config.groupBy) {
    params.set("groupBy", config.groupBy);
  }

  return params;
}

// Inverse of buildViewSearchParams -- reconstructs a SavedViewConfig
// (with an "eq" operator, matching what buildViewSearchParams produced)
// from a URL's search params. Used by F229's UI layer to restore a view
// opened from a shareable URL (AS-432) the same way it would be restored
// from the saved row itself.
export function parseViewSearchParams(params: URLSearchParams): SavedViewConfig {
  const filters: SavedViewConfig["filters"] = [];
  for (const field of FILTERABLE_FIELDS) {
    const value = params.get(field);
    if (value !== null && value !== "") {
      filters.push({ field, operator: "eq", value });
    }
  }

  const sortParam = params.get("sort");
  const sort: SavedViewConfig["sort"] = [];
  if (sortParam && SORT_PARAM_TO_FIELD[sortParam]) {
    sort.push(SORT_PARAM_TO_FIELD[sortParam]);
  }

  const groupBy = params.get("groupBy");

  return { filters, sort, groupBy: groupBy && groupBy.length > 0 ? groupBy : null };
}
