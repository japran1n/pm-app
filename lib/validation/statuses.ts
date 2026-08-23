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

export const addColumnSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  name: columnNameSchema,
  color: columnColorSchema,
  category: columnCategorySchema,
});

export type AddColumnInput = z.infer<typeof addColumnSchema>;

export const updateColumnSchema = z.object({
  columnId: z.string().uuid("Invalid column."),
  name: columnNameSchema,
  color: columnColorSchema,
  category: columnCategorySchema,
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
