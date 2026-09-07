// Out-of-office status note read helper (workspace_members.status_note /
// status_note_until -- see
// supabase/migrations/20261114020000_workspace_members_status_note.sql).
// Kept separate from lib/queries/members.ts's own row shape so any caller
// that already has a workspaceId + user ids in hand (not just
// getWorkspaceMembers) can resolve notes without a second full member
// fetch.

import { createClient } from "@/lib/supabase/server";
import { isStatusNoteActive } from "@/lib/status-note";

export type StatusNoteEntry = {
  note: string | null;
  until: string | null;
};

/**
 * Every ACTIVE (non-expired, non-empty) status note for the given
 * workspace, keyed by user id. Expired/empty notes are simply absent
 * from the returned map -- callers never need to re-check expiry
 * themselves, though `isStatusNoteActive` remains exported for callers
 * that already have the raw note/until pair in hand (e.g. from
 * `getWorkspaceMembers`, which returns both fields unfiltered).
 */
export async function getActiveStatusNotes(
  workspaceId: string,
  userIds: string[],
): Promise<Map<string, StatusNoteEntry>> {
  const result = new Map<string, StatusNoteEntry>();
  if (userIds.length === 0) return result;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("user_id, status_note, status_note_until")
    .eq("workspace_id", workspaceId)
    .in("user_id", userIds);

  if (error) {
    throw error;
  }

  for (const row of data ?? []) {
    if (isStatusNoteActive(row.status_note, row.status_note_until)) {
      result.set(row.user_id as string, {
        note: row.status_note,
        until: row.status_note_until,
      });
    }
  }

  return result;
}
