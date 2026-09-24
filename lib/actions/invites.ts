import "server-only";

import { logger } from "@/lib/observability/logger";

// Invite acceptance (F016, reworked for SEC audit 2026-09-24).
//
// History: F016 activated every pending invite for a user's email silently
// inside the auth callback, at their next sign-in. That meant anyone able to
// create a workspace could drag any account into it without consent (and,
// chained with the old preview-as-client, take it over). Invites are now
// only ever activated by an explicit accept action from the invitee:
//
//   - `listPendingInvites(identity)` — what the /invites screen shows.
//   - `acceptInviteForUser(inviteId, identity)` — claims ONE invite row.
//   - `declineInviteForUser(inviteId, identity)` — deletes ONE invite row.
//
// `identity` is always built by `verifiedInviteIdentity(user)` from the
// server-verified session user (`getUser()`), and is null unless the
// account's email is confirmed. Every lookup/claim re-asserts
// `invited_email = identity.email`, so an invite can only ever be accepted
// by the account that owns the invited address. This module is
// deliberately NOT a "use server" file: none of these helpers may be
// callable from the browser with caller-chosen arguments. The Server
// Actions live in lib/actions/invite-response.ts and derive the identity
// themselves.
//
// RLS note: workspace_members has no UPDATE policy (see
// supabase/migrations/20260817222822_rls_workspaces.sql) — the invitee isn't
// a member of anything yet, so their session client could not read or
// claim these rows. This goes through the secret-key admin client, same
// rationale as F013's workspace bootstrap (server-only, never exposed to
// the browser — AS-140), with the email binding above as the authorization.
//
// Atomicity: the UPDATE (not an INSERT) is what claims the row, keyed on
// the row id plus `user_id IS NULL`, so two concurrent accepts can only
// claim the row once — the second UPDATE matches zero rows. The
// (workspace_id, user_id) unique constraint from F011 additionally prevents
// ever ending up with two rows for the same user in the same workspace.
//
// invited_email is intentionally left in place after activation as an
// audit trail of which invite address originally claimed the row.

import type { User } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/activity/audit";

export interface InviteIdentity {
  userId: string;
  email: string;
}

export interface PendingInvite {
  id: string;
  workspaceId: string;
  workspaceName: string;
  role: string;
}

export type AcceptInviteResult =
  | { ok: true; workspaceId: string; workspaceSlug: string | null; role: string }
  | { ok: false; error: string };

export type DeclineInviteResult = { ok: true } | { ok: false; error: string };

const INVITE_NOT_FOUND =
  "This invite is no longer available. It may have been revoked or already used.";

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Only a session user whose email Supabase Auth has confirmed may see or
// act on invites addressed to that email.
export function verifiedInviteIdentity(
  user: Pick<User, "id" | "email" | "email_confirmed_at"> | null | undefined,
): InviteIdentity | null {
  if (!user?.email || !user.email_confirmed_at) return null;
  return { userId: user.id, email: normalizeInviteEmail(user.email) };
}

// Every 'invited' + unclaimed workspace_members row addressed to the
// identity's email, with the workspace name for display. Never throws;
// returns [] on lookup failure (the user can still continue to the app).
export async function listPendingInvites(
  identity: InviteIdentity | null,
): Promise<PendingInvite[]> {
  if (!identity) return [];

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: invite rows have user_id NULL and the invitee is not yet a member, so no RLS policy lets their session read them; scoped to the session user's verified email
  const admin = createAdminClient();

  const { data: rows, error } = await admin
    .from("workspace_members")
    .select("id, workspace_id, role")
    .eq("invited_email", identity.email)
    .eq("status", "invited")
    .is("user_id", null);

  if (error) {
    logger.error("listPendingInvites: lookup failed", { error });
    return [];
  }
  if (!rows || rows.length === 0) return [];

  const workspaceIds = [...new Set(rows.map((row) => row.workspace_id))];
  const { data: workspaces, error: workspacesError } = await admin
    .from("workspaces")
    .select("id, name")
    .in("id", workspaceIds);

  if (workspacesError) {
    logger.error("listPendingInvites: workspace lookup failed", { error: workspacesError });
  }

  const nameById = new Map((workspaces ?? []).map((w) => [w.id, w.name]));

  return rows
    // A workspace that no longer resolves (deleted) is not offered.
    .filter((row) => nameById.has(row.workspace_id))
    .map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      workspaceName: nameById.get(row.workspace_id) ?? "",
      role: row.role,
    }));
}

// Claims exactly one invite row for the identity, after re-checking the row
// is still pending AND addressed to the identity's verified email.
export async function acceptInviteForUser(
  inviteId: string,
  identity: InviteIdentity | null,
): Promise<AcceptInviteResult> {
  if (!identity) {
    return { ok: false, error: "Confirm your email address before accepting invites." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: the invitee is not yet a member, so no RLS policy lets their session claim the pending row; bound to the session user's verified email below
  const admin = createAdminClient();
  const userId = identity.userId;

  const { data: row, error: selectError } = await admin
    .from("workspace_members")
    .select("id, workspace_id, role, invited_project_id, invited_email")
    .eq("id", inviteId)
    .eq("invited_email", identity.email)
    .eq("status", "invited")
    .is("user_id", null)
    .maybeSingle();

  if (selectError) {
    logger.error("acceptInviteForUser: invite lookup failed", { inviteId, error: selectError });
    return { ok: false, error: "Something went wrong. Please try again in a moment." };
  }
  if (!row) return { ok: false, error: INVITE_NOT_FOUND };

  // Session-bound client for `writeAudit` — the `write_audit_log_entry`
  // RPC pins `actor_id` to `auth.uid()`, so it must run through the
  // invitee's own session. Non-fatal if unavailable (e.g. test harness).
  let supabase: Awaited<ReturnType<typeof createClient>> | null = null;
  try {
    supabase = await createClient();
  } catch (createClientError) {
    logger.error("acceptInviteForUser: createClient failed (non-fatal, audit logging skipped)", { error: createClientError });
  }

  // Scope the UPDATE to the specific row id AND re-assert user_id is
  // still null: if a concurrent request already claimed this row, this
  // UPDATE matches zero rows instead of double-claiming it.
  const { data: updated, error: updateError } = await admin
    .from("workspace_members")
    .update({ user_id: userId, status: "active" })
    .eq("id", row.id)
    .eq("invited_email", identity.email)
    .eq("status", "invited")
    .is("user_id", null)
    .select("workspace_id")
    .maybeSingle();

  if (updateError) {
    logger.error("acceptInviteForUser: failed to activate invite row", { inviteId: row.id, error: updateError });
    return { ok: false, error: "Something went wrong. Please try again in a moment." };
  }

  // A concurrent accept already claimed it.
  if (!updated) return { ok: false, error: INVITE_NOT_FOUND };

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
  // authenticated caller/session in this accept code path for
  // that action's own re-check to run against. Guarded to
  // role === 'guest' only: a non-guest invite's invited_project_id
  // would always be null (inviteMember only writes it when the
  // inviter set one), but this keeps the intent explicit even if a
  // future caller ever wrote the column for a non-guest role by
  // mistake — project_members access for non-guests already works via
  // ordinary workspace-wide visibility and shouldn't gain a redundant
  // row here.
  // C8: a client gets the same treatment as a guest here — their
  // access is entirely project-scoped, so an invite that named a
  // project must turn into a project_members row on acceptance or the
  // portal opens empty and the invite looks broken.
  if (
    (row.role === "guest" || row.role === "client") &&
    row.invited_project_id
  ) {
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
      logger.error("acceptInviteForUser: failed to grant guest project access", { inviteId: row.id, error: projectMemberError });
    }

    // F116 (docs/client-portal-phase-2-plan.md item A): if this
    // project's portal is ALREADY enabled, its chat channel already
    // exists (created by setPortalEnabled, see lib/actions/portal-
    // settings.ts) — a client accepting their invite after that point
    // must be backfilled onto it, or their first visit to the portal's
    // conversation view finds a channel with everyone but them in it.
    // Guest invites don't get this: only a `client` role's project
    // channel membership is this feature's concern. Deliberately does
    // NOT create the channel here if the portal isn't enabled yet —
    // channel creation stays a single decision point (portal-enable
    // time), not two, so there is never a channel that exists only
    // because someone happened to accept an invite first.
    if (row.role === "client") {
      const { data: projectRow } = await admin
        .from("projects")
        .select("portal_enabled")
        .eq("id", row.invited_project_id)
        .maybeSingle();

      if (projectRow?.portal_enabled) {
        const { error: ensureError } = await admin.rpc("ensure_project_channel_atomic", {
          p_project_id: row.invited_project_id,
          p_created_by: userId,
        });
        if (ensureError) {
          logger.error("acceptInviteForUser: failed to backfill client onto project channel", {
            inviteId: row.id,
            error: ensureError,
          });
        }
      }
    }
  }

  const { data: workspace } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", updated.workspace_id)
    .maybeSingle();

  return {
    ok: true,
    workspaceId: updated.workspace_id,
    workspaceSlug: workspace?.slug ?? null,
    role: row.role,
  };
}

// Declines (deletes) exactly one pending invite addressed to the identity's
// verified email. Same row-level binding as accept.
export async function declineInviteForUser(
  inviteId: string,
  identity: InviteIdentity | null,
): Promise<DeclineInviteResult> {
  if (!identity) {
    return { ok: false, error: "Confirm your email address before responding to invites." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: the invitee is not a member, so no RLS policy lets their session delete the pending row; bound to the session user's verified email
  const admin = createAdminClient();

  const { data: deleted, error } = await admin
    .from("workspace_members")
    .delete()
    .eq("id", inviteId)
    .eq("invited_email", identity.email)
    .eq("status", "invited")
    .is("user_id", null)
    .select("id, workspace_id");

  if (error) {
    logger.error("declineInviteForUser: delete failed", { inviteId, error });
    return { ok: false, error: "Something went wrong. Please try again in a moment." };
  }
  if (!deleted || deleted.length === 0) {
    return { ok: false, error: INVITE_NOT_FOUND };
  }

  // No audit_log row: `write_audit_log_entry` requires the actor to be an
  // active member of the workspace, which a decliner never is.
  logger.info("declineInviteForUser: invite declined", {
    inviteId,
    workspaceId: deleted[0]?.workspace_id,
  });
  return { ok: true };
}
