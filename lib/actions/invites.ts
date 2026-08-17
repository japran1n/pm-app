// F016: invite-accept-on-signin (AS-008, AS-009).
//
// When a user signs in (magic link), any workspace_members rows that were
// created by an invite (status = 'invited', user_id IS NULL, invited_email
// set) for this user's email must flip to an active membership. Extracted
// from the auth callback route so it's independently testable and so a user
// invited to multiple workspaces gets all of them activated in one pass.
//
// RLS note: workspace_members has no UPDATE policy (see
// supabase/migrations/20260817222822_rls_workspaces.sql) — a freshly
// authenticated user isn't yet a member of anything, so their session
// client could not update these rows even if a policy existed for members.
// This goes through the secret-key admin client, same rationale as F013's
// workspace bootstrap (bypasses RLS by design, server-only, never exposed
// to the browser — AS-140).
//
// Atomicity: the UPDATE (not an INSERT) is what claims the row, keyed on
// the invited row's own id plus `.eq("user_id", null)` as a guard, so a
// concurrent duplicate callback racing against this one can each only win
// updating the same row once — the second UPDATE simply matches zero rows
// once the first has already cleared user_id/invited_email off the
// `user_id is null` predicate. The (workspace_id, user_id) unique
// constraint from F011 additionally prevents ever ending up with two rows
// for the same user in the same workspace.
//
// invited_email is intentionally left in place after activation (not
// cleared) as an audit trail of which invite address originally claimed the
// row; user_id and status are the fields that actually govern access and
// the AS-009 "not yet active" check.

import { createAdminClient } from "@/lib/supabase/admin";

export interface ActivatedMembership {
  workspaceId: string;
}

// Finds every 'invited' + unclaimed workspace_members row for `email` and
// claims it for `userId`. Returns the workspace ids that were activated.
// Safe to call on every sign-in: an email with no pending invites (the
// AS-009 negative case) activates nothing and returns an empty array.
export async function activateInvitedMemberships(
  userId: string,
  email: string,
): Promise<ActivatedMembership[]> {
  const admin = createAdminClient();

  const { data: pending, error: selectError } = await admin
    .from("workspace_members")
    .select("id, workspace_id")
    .eq("invited_email", email)
    .eq("status", "invited")
    .is("user_id", null);

  if (selectError) {
    console.error(
      "activateInvitedMemberships: failed to look up pending invites:",
      selectError,
    );
    return [];
  }

  if (!pending || pending.length === 0) {
    return [];
  }

  const activated: ActivatedMembership[] = [];

  for (const row of pending) {
    // Scope the UPDATE to the specific row id AND re-assert user_id is
    // still null: if a concurrent request already claimed this row, this
    // UPDATE matches zero rows instead of double-claiming it.
    const { data: updated, error: updateError } = await admin
      .from("workspace_members")
      .update({ user_id: userId, status: "active" })
      .eq("id", row.id)
      .is("user_id", null)
      .select("workspace_id")
      .maybeSingle();

    if (updateError) {
      console.error(
        "activateInvitedMemberships: failed to activate invite row:",
        row.id,
        updateError,
      );
      continue;
    }

    if (updated) {
      activated.push({ workspaceId: updated.workspace_id });
    }
  }

  return activated;
}
