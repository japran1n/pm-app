import { z } from "zod";

// Validates watchTask/unwatchTask input (F164: AS-295, AS-296). Mirrors
// the file-layout convention established by lib/validation/comments.ts.
export const watchTaskSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
});

export type WatchTaskInput = z.infer<typeof watchTaskSchema>;

export const unwatchTaskSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
});

export type UnwatchTaskInput = z.infer<typeof unwatchTaskSchema>;
