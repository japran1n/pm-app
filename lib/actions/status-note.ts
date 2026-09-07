"use server";

// Out-of-office status note: a member sets their own note + optional
// expiry date on their workspace_members row (see
// supabase/migrations/20261114020000_workspace_members_status_note.sql).
// Self-service only -- there is no "an admin sets someone else's note"
// path in this feature's spec, matching the RLS policy this file's check
// re-verifies (`workspace_members_update_own_status_note`).

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { updateStatusNoteSchema } from "@/lib/validation/status-note";
import { logger } from "@/lib/observability/logger";

export type UpdateStatusNoteResult =
  | { ok: true; data: { note: string | null; until: string | null } }
  | { ok: false; error: string };

// Sets/clears the caller's own status note for `workspaceId`. Sending
// `note: null` (or an empty string) clears the note entirely -- `until`
// is cleared along with it so a stale expiry date never lingers on an
// otherwise-empty note.
export async function updateStatusNote(input: unknown): Promise<UpdateStatusNoteResult> {
  const parsed = updateStatusNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid status note." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to update your status note." };
  }

  const admin = createAdminClient();
  const membership = await requireActiveMembership(admin, parsed.data.workspaceId, user.id);
  if (!membership.ok) {
    return { ok: false, error: "You don't have permission to update this workspace's membership." };
  }

  const trimmedNote = parsed.data.note?.trim() || null;
  const until = trimmedNote ? parsed.data.until?.trim() || null : null;

  // Session-scoped client performs the real write --
  // `workspace_members_update_own_status_note` already enforces
  // `user_id = auth.uid()`; the membership check above just turns a bare
  // RLS rejection into a specific message.
  const { data: updated, error: updateError } = await supabase
    .from("workspace_members")
    .update({ status_note: trimmedNote, status_note_until: until })
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("user_id", user.id)
    .select("status_note, status_note_until")
    .single();

  if (updateError || !updated) {
    logger.error("updateStatusNote: update failed", { error: updateError });
    return { ok: false, error: "Something went wrong. Please try again in a moment." };
  }

  // The note is rendered app-wide (avatar hover tooltips wherever this
  // person is shown), not on one workspace-scoped path alone -- mirrors
  // updateProfile's own "revalidate the whole layout" call.
  try {
    revalidatePath("/", "layout");
  } catch (revalidateError) {
    logger.error("updateStatusNote: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  return {
    ok: true,
    data: { note: updated.status_note, until: updated.status_note_until },
  };
}
