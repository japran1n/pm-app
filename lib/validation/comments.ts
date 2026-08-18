import { z } from "zod";

// Validates addComment input (AS-094, AS-095). Mirrors the file-layout
// convention established by lib/validation/tasks.ts.
//
// AS-095: an empty (or whitespace-only) comment cannot be submitted. Mirrors
// the `comments_text_not_empty` CHECK constraint from
// supabase/migrations/20260818040214_create_comments.sql (`btrim(text) <>
// ''`), which is the real enforcement boundary; this schema exists so a bad
// submission is rejected before ever reaching the database, per AS-146.
export const addCommentSchema = z.object({
  taskId: z.string().uuid("Invalid task."),
  text: z
    .string()
    .trim()
    .min(1, "Comment cannot be empty.")
    .max(10000, "Comment must be 10000 characters or fewer."),
});

export type AddCommentInput = z.infer<typeof addCommentSchema>;

// Validates deleteComment input (F061: AS-098, AS-099, AS-100). Mirrors
// deleteTaskSchema's shape from lib/validation/tasks.ts.
export const deleteCommentSchema = z.object({
  commentId: z.string().uuid("Invalid comment."),
});

export type DeleteCommentInput = z.infer<typeof deleteCommentSchema>;
