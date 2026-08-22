import { z } from "zod";

// F174 (AS-312): loose structural validation for a comment's rich-text
// body. Deliberately NOT a full allow-list re-implementation — that
// allow-list is owned once by components/editor/rich-text-editor.tsx's
// sanitiseDocument and re-applied on every render (see
// lib/comments/rich-text.ts's doc comment for the full rationale). This
// schema only guards against obviously-malformed payloads (wrong shape,
// wrong top-level type) reaching the database at all; it is not the
// security boundary.
export const commentBodyJsonSchema = z
  .object({
    type: z.literal("doc"),
    content: z.array(z.unknown()).optional(),
  })
  .passthrough();

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

// Validates restoreComment input (F191: AS-346). Same shape as
// deleteCommentSchema — kept as its own named export (rather than reusing
// deleteCommentSchema directly at the call site) so restoreComment's
// intent reads clearly at its own call site, mirroring the
// deleteTaskSchema/restoreTaskSchema convention this codebase already uses
// for the task-restore counterpart.
export const restoreCommentSchema = z.object({
  commentId: z.string().uuid("Invalid comment."),
});

export type RestoreCommentInput = z.infer<typeof restoreCommentSchema>;
