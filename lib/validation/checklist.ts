import { z } from "zod";

// Validates addChecklistItem input (F152: write-path setup for AS-269,
// re-validated at the action layer per AS-274). Mirrors addCommentSchema's
// shape (lib/validation/comments.ts) — content is trimmed and required,
// same non-empty-after-trim rule as the `checklist_items_content_not_empty`
// CHECK constraint
// (supabase/migrations/20260819075456_create_checklist_items.sql), which
// is the real enforcement boundary; this schema exists so a bad submission
// is rejected before ever reaching the database (AS-146 convention).
//
// Max length: 500, matching a checklist item's title-like semantics
// (lib/validation/tasks.ts's `title` limit) rather than comments' free-text
// 10000 — a checklist item is a short todo line, not a paragraph.
export const addChecklistItemSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  content: z
    .string()
    .trim()
    .min(1, "Checklist item cannot be empty.")
    .max(500, "Checklist item must be 500 characters or fewer."),
});

export type AddChecklistItemInput = z.infer<typeof addChecklistItemSchema>;

// Validates toggleChecklistItem input (AS-270: checking/unchecking must
// persist immediately and survive a reload). `isChecked` is the explicit
// TARGET state the caller wants to set — not "flip the current value" —
// so the action is idempotent: calling it twice with the same value is a
// safe no-op (per the Clarified implementation's empty/zero-state answer),
// and the client's optimistic update always agrees with what the server
// is asked to persist, rather than racing on "what is the current value
// right now."
export const toggleChecklistItemSchema = z.object({
  itemId: z.string().uuid("Invalid checklist item."),
  isChecked: z.boolean(),
});

export type ToggleChecklistItemInput = z.infer<
  typeof toggleChecklistItemSchema
>;

// Validates renameChecklistItem input (AS-271: an item can be renamed).
// Same content rules as addChecklistItemSchema.
export const renameChecklistItemSchema = z.object({
  itemId: z.string().uuid("Invalid checklist item."),
  content: z
    .string()
    .trim()
    .min(1, "Checklist item cannot be empty.")
    .max(500, "Checklist item must be 500 characters or fewer."),
});

export type RenameChecklistItemInput = z.infer<
  typeof renameChecklistItemSchema
>;

// Validates reorderChecklistItem input (AS-271: an item can be reordered).
// `position` is the already-computed fractional-index value
// (lib/board/position.ts's `calculatePosition`, called by the CALLER
// before invoking this action) — same division of responsibility as
// lib/validation/tasks.ts's `reorderTaskSchema`. This schema only guards
// against a non-finite number reaching the database (NaN/Infinity would
// corrupt ordering); it does not reimplement any of the fractional-index
// maths itself.
export const reorderChecklistItemSchema = z.object({
  itemId: z.string().uuid("Invalid checklist item."),
  position: z.number().finite("Invalid position."),
});

export type ReorderChecklistItemInput = z.infer<
  typeof reorderChecklistItemSchema
>;

// Validates deleteChecklistItem input (AS-271: an item can be deleted).
// checklist_items has no `deleted_at` column (F151's migration
// deliberately omitted one), so this is a hard delete — just the item id.
export const deleteChecklistItemSchema = z.object({
  itemId: z.string().uuid("Invalid checklist item."),
});

export type DeleteChecklistItemInput = z.infer<
  typeof deleteChecklistItemSchema
>;
