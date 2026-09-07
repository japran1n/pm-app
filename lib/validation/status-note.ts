import { z } from "zod";

// Validates updateStatusNote input (workspace_members.status_note /
// status_note_until -- see
// supabase/migrations/20261114020000_workspace_members_status_note.sql).
// `note` may be cleared by sending null/empty; `until` is optional (no
// expiry means the note never auto-hides).

export const updateStatusNoteSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  note: z
    .string()
    .trim()
    .max(140, "Status note must be 140 characters or fewer.")
    .nullable()
    .optional(),
  until: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date (YYYY-MM-DD).")
    .nullable()
    .optional(),
});

export type UpdateStatusNoteInput = z.infer<typeof updateStatusNoteSchema>;
