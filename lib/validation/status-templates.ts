import { z } from "zod";

import { isApprovedColumnColor, isColumnCategory } from "@/lib/board/column-colors";

// F428-F430: status template mutations. Colour/category reuse the exact
// same constrained palette/category schemas board columns already use
// (lib/validation/statuses.ts) — a template item is shaped identically to
// a project_statuses row (name, color, category), so it validates
// identically; keeping one set of "what is an approved colour" rules
// rather than a parallel one for templates is the whole point of sharing
// column-colors.ts in the first place.

const templateNameSchema = z
  .string()
  .trim()
  .min(1, "Template name is required.")
  .max(60, "Template name must be 60 characters or fewer.");

const itemNameSchema = z
  .string()
  .trim()
  .min(1, "Column name is required.")
  .max(60, "Column name must be 60 characters or fewer.");

const itemColorSchema = z
  .string()
  .refine(isApprovedColumnColor, "Choose a colour from the approved palette.");

const itemCategorySchema = z
  .string()
  .refine(isColumnCategory, "Choose a valid category.");

export const createStatusTemplateSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  name: templateNameSchema,
});
export type CreateStatusTemplateInput = z.infer<typeof createStatusTemplateSchema>;

export const renameStatusTemplateSchema = z.object({
  templateId: z.string().uuid("Invalid template."),
  name: templateNameSchema,
});
export type RenameStatusTemplateInput = z.infer<typeof renameStatusTemplateSchema>;

export const deleteStatusTemplateSchema = z.object({
  templateId: z.string().uuid("Invalid template."),
});
export type DeleteStatusTemplateInput = z.infer<typeof deleteStatusTemplateSchema>;

export const addTemplateItemSchema = z.object({
  templateId: z.string().uuid("Invalid template."),
  name: itemNameSchema,
  color: itemColorSchema,
  category: itemCategorySchema,
});
export type AddTemplateItemInput = z.infer<typeof addTemplateItemSchema>;

export const updateTemplateItemSchema = z.object({
  itemId: z.string().uuid("Invalid item."),
  name: itemNameSchema.optional(),
  color: itemColorSchema.optional(),
  category: itemCategorySchema.optional(),
});
export type UpdateTemplateItemInput = z.infer<typeof updateTemplateItemSchema>;

export const removeTemplateItemSchema = z.object({
  itemId: z.string().uuid("Invalid item."),
});
export type RemoveTemplateItemInput = z.infer<typeof removeTemplateItemSchema>;

export const reorderTemplateItemSchema = z.object({
  itemId: z.string().uuid("Invalid item."),
  newPosition: z.number().finite(),
});
export type ReorderTemplateItemInput = z.infer<typeof reorderTemplateItemSchema>;

export const applyStatusTemplateSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  templateId: z.string().uuid("Invalid template."),
});
export type ApplyStatusTemplateInput = z.infer<typeof applyStatusTemplateSchema>;
