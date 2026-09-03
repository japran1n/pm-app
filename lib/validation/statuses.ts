import { z } from "zod";

import { isApprovedColumnColor, isColumnCategory } from "@/lib/board/column-colors";

// Validates board-column ("project status") mutations (F219: AS-404,
// AS-405). Re-validated server-side by every action in
// lib/actions/statuses.ts, per this feature's Clarified implementation
// answer #7 — the client-side check in components/project/status-manager.tsx
// never stands alone.

const columnNameSchema = z
  .string()
  .trim()
  .min(1, "Column name is required.")
  .max(60, "Column name must be 60 characters or fewer.");

// AS-405: colour is constrained to the approved palette (lib/board/
// column-colors.ts) rather than a free colour input — see that file's
// header comment for why.
const columnColorSchema = z
  .string()
  .refine(isApprovedColumnColor, "Choose a colour from the approved palette.");

// AS-405: category is one of the three fixed values that also matches the
// `project_statuses_category_check` DB constraint
// (supabase/migrations/20260824010000_project_statuses.sql).
const columnCategorySchema = z
  .string()
  .refine(isColumnCategory, "Choose a valid category.");

// F004 (missions/20260903-portal, AS-016): the client-facing explanation
// behind a status pill's tooltip. Empty input clears it back to null
// (rather than persisting an empty string) so `StatusPill` correctly
// treats "never written" and "cleared" the same way — no tooltip.
const clientDescriptionSchema = z
  .string()
  .max(500, "Client description must be 500 characters or fewer.")
  .transform((value) => {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

// F004 (AS-015): one of the four client-facing buckets a status can be
// explicitly pinned to, or "auto" to clear the override and fall back to
// a category-derived bucket
// (components/portal/status-label.ts's `resolveClientBucket`). The four
// literal values match `project_statuses_client_bucket_check`
// (supabase/migrations/20260911010000_status_client_bucket.sql) and
// `ClientBucket` in components/portal/status-label.ts — the same
// "matches the DB constraint" convention `columnCategorySchema` above
// already uses for the three category values.
const CLIENT_BUCKET_VALUES = ["waiting", "progress", "blocked", "done"] as const;
const clientBucketSchema = z
  .string()
  .transform((value) => (value === "auto" ? null : value))
  .refine(
    (value): value is (typeof CLIENT_BUCKET_VALUES)[number] | null =>
      value === null || (CLIENT_BUCKET_VALUES as readonly string[]).includes(value),
    "Choose a valid client status bucket.",
  );

export const addColumnSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  name: columnNameSchema,
  color: columnColorSchema,
  category: columnCategorySchema,
});

export type AddColumnInput = z.infer<typeof addColumnSchema>;

// `clientDescription`/`clientBucket` are optional (not defaulted) rather
// than required alongside name/color/category: an omitted key means
// "this caller isn't touching that field", which
// lib/actions/statuses.ts's `updateColumn` reads as "leave the column's
// current value alone" — distinct from an explicit empty string / "auto",
// which clears it. This keeps every pre-F004 caller of `updateColumn`
// (this repo has several integration tests that call it directly with
// only name/color/category) behaviourally unchanged.
export const updateColumnSchema = z.object({
  columnId: z.string().uuid("Invalid column."),
  name: columnNameSchema,
  color: columnColorSchema,
  category: columnCategorySchema,
  clientDescription: clientDescriptionSchema.optional(),
  clientBucket: clientBucketSchema.optional(),
});

export type UpdateColumnInput = z.infer<typeof updateColumnSchema>;

// `position` is the already-computed fractional-index value (lib/board/
// position.ts's `calculatePosition`, called by the CALLER before invoking
// this action) — same division of responsibility as
// lib/validation/checklist.ts's `reorderChecklistItemSchema`.
export const reorderColumnSchema = z.object({
  columnId: z.string().uuid("Invalid column."),
  position: z.number().finite("Invalid position."),
});

export type ReorderColumnInput = z.infer<typeof reorderColumnSchema>;

export const removeColumnSchema = z.object({
  columnId: z.string().uuid("Invalid column."),
});

export type RemoveColumnInput = z.infer<typeof removeColumnSchema>;

// F220 (AS-406): removing a column requires an explicit destination
// column for its tasks — `destinationColumnId` is required (not
// optional), even for an empty column, so the action always takes the
// same atomic reassign-then-delete path rather than branching on
// "does it have tasks" client-side (that check happens server-side,
// inside the RPC's transaction, per this feature's Clarified
// implementation).
export const removeColumnWithReassignmentSchema = z.object({
  columnId: z.string().uuid("Invalid column."),
  destinationColumnId: z.string().uuid("Choose a destination column."),
});

export type RemoveColumnWithReassignmentInput = z.infer<
  typeof removeColumnWithReassignmentSchema
>;
