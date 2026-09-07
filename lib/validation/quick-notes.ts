import { z } from "zod";

// Quick notes: a lighter, smaller entity than a personal to-do or task —
// a short "don't forget" reminder, optionally pinned to a task or project.

const textSchema = z
  .string()
  .trim()
  .min(1, "Text is required.")
  .max(280, "Note must be 280 characters or fewer.");

export const createQuickNoteSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  text: textSchema,
  taskId: z.string().uuid("Invalid task.").nullable().optional(),
  projectId: z.string().uuid("Invalid project.").nullable().optional(),
});
export type CreateQuickNoteInput = z.infer<typeof createQuickNoteSchema>;

export const toggleQuickNoteSchema = z.object({
  noteId: z.string().uuid("Invalid note."),
  isDone: z.boolean(),
});
export type ToggleQuickNoteInput = z.infer<typeof toggleQuickNoteSchema>;

export const deleteQuickNoteSchema = z.object({
  noteId: z.string().uuid("Invalid note."),
});
export type DeleteQuickNoteInput = z.infer<typeof deleteQuickNoteSchema>;
