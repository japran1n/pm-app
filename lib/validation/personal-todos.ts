import { z } from "zod";

// F416-F418: personal to-do mutations. Small on purpose — this is a
// title and a done flag, not a task.

const titleSchema = z
  .string()
  .trim()
  .min(1, "Title is required.")
  .max(200, "Title must be 200 characters or fewer.");

export const createPersonalTodoSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  title: titleSchema,
  taskId: z.string().uuid("Invalid task.").nullable().optional(),
  projectId: z.string().uuid("Invalid project.").nullable().optional(),
});
export type CreatePersonalTodoInput = z.infer<typeof createPersonalTodoSchema>;

export const toggleTodoSchema = z.object({
  todoId: z.string().uuid("Invalid to-do."),
  isDone: z.boolean(),
});
export type ToggleTodoInput = z.infer<typeof toggleTodoSchema>;

export const deleteTodoSchema = z.object({
  todoId: z.string().uuid("Invalid to-do."),
});
export type DeleteTodoInput = z.infer<typeof deleteTodoSchema>;
