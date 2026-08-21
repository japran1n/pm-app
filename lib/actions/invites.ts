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
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/activity/audit";

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
    .select("id, workspace_id, role, invited_project_id")
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

  // Session-bound client for `writeAudit` — the `write_audit_log_entry`
  // RPC pins `actor_id` to `auth.uid()`, so it must be called through the
  // authenticated user's own session, not the service-role admin client
  // used for the rest of this function's writes. In production this
  // function only ever runs from app/(auth)/auth/callback/route.ts, after
  // `exchangeCodeForSession` has already set the session cookies for this
  // exact request — `createClient()` here reads those same cookies. Guarded
  // with try/catch (non-fatal, same convention as the `revalidatePath`
  // failures elsewhere in lib/actions/*.ts) because `next/headers`'
  // `cookies()` throws outside an active request/render context, e.g. when
  // this function is called directly from a test harness — the invite
  // activation itself must never fail because audit logging couldn't set
  // up its client.
  let supabase: Awaited<ReturnType<typeof createClient>> | null = null;
  try {
    supabase = await createClient();
  } catch (createClientError) {
    console.error(
      "activateInvitedMemberships: createClient failed (non-fatal, audit logging skipped):",
      createClientError,
    );
  }

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

      if (supabase) {
        await writeAudit(supabase, {
          workspaceId: updated.workspace_id,
          action: "invite.accepted",
          targetType: "workspace_member",
          targetId: row.id,
          metadata: { role: row.role },
        });
      }

      // F134 (AS-220): a guest invite created with an invited_project_id
      // grants that specific project's access at the same moment the
      // workspace membership itself is activated — a guest with zero
      // project_members rows can sign in but sees no projects at all
      // (AS-220's own wording: "only the projects they're added to"), so
      // this is the step that actually makes the invite useful. Uses the
      // admin client (already bypassing RLS in this function) rather than
      // going through addProjectMember's Server Action, since there is no
      // authenticated caller/session in this sign-in-time code path for
      // that action's own re-check to run against. Guarded to
      // role === 'guest' only: a non-guest invite's invited_project_id
      // would always be null (inviteMember only writes it when the
      // inviter set one), but this keeps the intent explicit even if a
      // future caller ever wrote the column for a non-guest role by
      // mistake — project_members access for non-guests already works via
      // ordinary workspace-wide visibility and shouldn't gain a redundant
      // row here.
      if (row.role === "guest" && row.invited_project_id) {
        const { error: projectMemberError } = await admin
          .from("project_members")
          .insert({
            project_id: row.invited_project_id,
            user_id: userId,
            project_role: "member",
            added_by: null,
          })
          .select("id");

        // A concurrent duplicate callback (see the file-header atomicity
        // note) could race two inserts for the same (project_id, user_id)
        // pair; 23505 (unique_project_user violation) is treated as a
        // harmless no-op rather than logged as a failure.
        if (projectMemberError && projectMemberError.code !== "23505") {
          console.error(
            "activateInvitedMemberships: failed to grant guest project access:",
            row.id,
            projectMemberError,
          );
        }
      }
    }
  }

  return activated;
}
