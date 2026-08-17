"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createWorkspaceSchema,
  inviteMemberSchema,
  revokeInviteSchema,
  changeMemberRoleSchema,
  slugify,
  findAvailableSlug,
} from "@/lib/validation/workspaces";
import {
  requireWorkspaceAdmin,
  requireWorkspaceOwner,
} from "@/lib/auth/require-membership";

export type CreateWorkspaceResult =
  | { ok: true; slug: string }
  | { ok: false; error: string };

export type InviteMemberResult =
  | { ok: true; invitedEmail: string }
  | { ok: false; error: string };

export type RevokeInviteResult =
  | { ok: true }
  | { ok: false; error: string };

export type ChangeMemberRoleResult =
  | { ok: true }
  | { ok: false; error: string };

// Creates a workspace and makes the calling user its owner (AS-005, AS-006).
//
// Ordering / rollback strategy: `workspace_members` has no client-facing
// INSERT policy (see supabase/migrations/20260817222822_rls_workspaces.sql —
// intentionally left to whichever feature bootstraps the first owner row),
// so both inserts here go through the secret-key admin client, which
// bypasses RLS by design (AS-140: never exposed to the browser — this file
// only runs on the server as a Server Action).
//
// Because there's no real multi-table transaction available through the
// Supabase client libraries (no client-side `BEGIN`/`COMMIT`, and adding a
// Postgres RPC function for a two-insert bootstrap was judged more
// machinery than this flow needs), the approach chosen is: insert the
// workspace, then insert the membership row; if the membership insert fails,
// explicitly delete the just-created workspace row (manual compensating
// action) so no orphaned, memberless workspace is left behind. This is
// documented here rather than silently caught, per the handoff.
export async function createWorkspace(
  _prevState: CreateWorkspaceResult | null,
  formData: FormData,
): Promise<CreateWorkspaceResult> {
  const parsed = createWorkspaceSchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid workspace name.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to create a workspace." };
  }

  const admin = createAdminClient();

  const baseSlug = slugify(parsed.data.name);
  const slug = await findAvailableSlug(admin, baseSlug);

  const { data: workspace, error: workspaceError } = await admin
    .from("workspaces")
    .insert({ name: parsed.data.name, slug })
    .select("id, slug")
    .single();

  if (workspaceError || !workspace) {
    console.error("createWorkspace: workspace insert failed:", workspaceError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { error: memberError } = await admin.from("workspace_members").insert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: "owner",
    status: "active",
  });

  if (memberError) {
    console.error(
      "createWorkspace: owner membership insert failed, rolling back workspace:",
      memberError,
    );
    // Compensating delete: avoid leaving an orphaned, memberless workspace.
    const { error: rollbackError } = await admin
      .from("workspaces")
      .delete()
      .eq("id", workspace.id);
    if (rollbackError) {
      console.error(
        "createWorkspace: rollback delete also failed — orphaned workspace",
        workspace.id,
        rollbackError,
      );
    }
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  redirect(`/w/${workspace.slug}`);
}

// Invites a user by email to a workspace (AS-007). Only an active
// owner/admin member of that workspace may invite; this is re-verified
// server-side (AS-143 convention) even though workspace_members currently
// has no client-facing INSERT policy at all (F012 left it fully closed), so
// this Server Action — running with the admin client — is the only path
// that can create an invite row today.
export async function inviteMember(
  workspaceId: string,
  email: string,
): Promise<InviteMemberResult> {
  const parsed = inviteMemberSchema.safeParse({ workspaceId, email });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid email address.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to invite a member." };
  }

  const admin = createAdminClient();

  // Defense in depth (AS-143): re-check the caller is an active owner/admin
  // of this exact workspace, server-side, rather than trusting that the UI
  // only shows the invite form to owners/admins.
  const membership = await requireWorkspaceAdmin(
    admin,
    parsed.data.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to invite members to this workspace.",
    };
  }

  // Guard against duplicate invites before inserting: any existing row in
  // this workspace with this invited_email (status 'invited' or 'active' —
  // F011's schema backfills user_id and flips status on accept but the
  // invited_email column is left in place, so this single lookup catches
  // both a still-pending invite and an already-accepted one).
  const { data: existingByEmail, error: existingByEmailError } = await admin
    .from("workspace_members")
    .select("id, status")
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("invited_email", parsed.data.email)
    .maybeSingle();

  if (existingByEmailError) {
    console.error(
      "inviteMember: existing-member lookup failed:",
      existingByEmailError,
    );
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  if (existingByEmail) {
    return {
      ok: false,
      error:
        existingByEmail.status === "active"
          ? "This person is already a member of this workspace."
          : "This email has already been invited to this workspace.",
    };
  }

  // Also cover the case where the email belongs to an already-signed-up
  // auth user who is an active member via a row whose invited_email was
  // never set (e.g. seeded directly, like F013's owner-creation flow) — look
  // the user up by email and check their membership row directly.
  const { data: usersPage, error: usersLookupError } =
    await admin.auth.admin.listUsers();

  if (usersLookupError) {
    console.error(
      "inviteMember: auth user lookup failed:",
      usersLookupError,
    );
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const matchingUser = usersPage.users.find(
    (candidate) => candidate.email?.toLowerCase() === parsed.data.email,
  );

  if (matchingUser) {
    const { data: existingMembership, error: existingMembershipError } =
      await admin
        .from("workspace_members")
        .select("id, status")
        .eq("workspace_id", parsed.data.workspaceId)
        .eq("user_id", matchingUser.id)
        .maybeSingle();

    if (existingMembershipError) {
      console.error(
        "inviteMember: existing-membership-by-user lookup failed:",
        existingMembershipError,
      );
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    if (existingMembership) {
      return {
        ok: false,
        error:
          existingMembership.status === "active"
            ? "This person is already a member of this workspace."
            : "This email has already been invited to this workspace.",
      };
    }
  }

  const { error: insertError } = await admin.from("workspace_members").insert({
    workspace_id: parsed.data.workspaceId,
    user_id: null,
    invited_email: parsed.data.email,
    role: "member",
    status: "invited",
  });

  if (insertError) {
    console.error("inviteMember: insert failed:", insertError);
    // A unique-index violation here means a concurrent request won the
    // race between the pre-check above and this insert.
    if (insertError.code === "23505") {
      return {
        ok: false,
        error: "This email has already been invited to this workspace.",
      };
    }
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", parsed.data.workspaceId)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}/settings/members`);
    } catch (revalidateError) {
      // revalidatePath requires an active Next.js request/render context;
      // it throws when called outside one (e.g. this action invoked from a
      // test harness with no such context). The invite itself already
      // succeeded above, so this is a non-fatal cache-freshness miss, not
      // an invite failure — log and continue rather than surfacing an
      // error for a successful invite.
      console.error(
        "inviteMember: revalidatePath failed (non-fatal):",
        revalidateError,
      );
    }
  }

  return { ok: true, invitedEmail: parsed.data.email };
}

// Revokes a pending invite (AS-024). Only an active owner/admin member of
// the workspace may revoke; re-verified server-side (AS-143 convention) via
// the same `requireWorkspaceAdmin` helper `inviteMember` uses above, rather
// than trusting that the UI only renders the revoke button for owners/
// admins.
//
// Deliberately scoped to status = 'invited' rows only: this action must
// never be usable to delete an *active* member's row (that's a distinct,
// not-yet-built feature, F020 — "remove member"). The target row is looked
// up by id + workspace_id first so a non-matching or already-non-invited
// row is rejected/no-ops cleanly rather than the DELETE silently matching
// zero rows for an ambiguous reason.
export async function revokeInvite(
  workspaceId: string,
  workspaceMemberId: string,
): Promise<RevokeInviteResult> {
  const parsed = revokeInviteSchema.safeParse({
    workspaceId,
    workspaceMemberId,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to revoke an invite." };
  }

  const admin = createAdminClient();

  // Defense in depth (AS-143): re-check the caller is an active owner/admin
  // of this exact workspace, server-side, rather than trusting that the UI
  // only shows the revoke button to owners/admins.
  const membership = await requireWorkspaceAdmin(
    admin,
    parsed.data.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to revoke invites in this workspace.",
    };
  }

  const { data: targetRow, error: lookupError } = await admin
    .from("workspace_members")
    .select("id, status")
    .eq("id", parsed.data.workspaceMemberId)
    .eq("workspace_id", parsed.data.workspaceId)
    .maybeSingle();

  if (lookupError) {
    console.error("revokeInvite: target lookup failed:", lookupError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  if (!targetRow) {
    return { ok: false, error: "This invite no longer exists." };
  }

  // Guard: never allow this action to delete a row that isn't a pending
  // invite (e.g. an already-active member) — that is out of scope (F020).
  if (targetRow.status !== "invited") {
    return {
      ok: false,
      error: "Only pending invites can be revoked.",
    };
  }

  const { error: deleteError } = await admin
    .from("workspace_members")
    .delete()
    .eq("id", parsed.data.workspaceMemberId)
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("status", "invited");

  if (deleteError) {
    console.error("revokeInvite: delete failed:", deleteError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", parsed.data.workspaceId)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}/settings/members`);
    } catch (revalidateError) {
      // Same non-fatal cache-freshness rationale as inviteMember above:
      // revalidatePath throws outside an active request/render context
      // (e.g. this action invoked from a test harness). The revoke itself
      // already succeeded, so this is not an action failure.
      console.error(
        "revokeInvite: revalidatePath failed (non-fatal):",
        revalidateError,
      );
    }
  }

  return { ok: true };
}

// Changes an existing active member's role between "member" and "admin"
// (AS-014). Only the workspace owner may perform this — deliberately
// re-checked as owner-specifically here, not the broader owner/admin check
// `requireWorkspaceAdmin` uses for invite/revoke, because AS-014/AS-015/
// AS-019 draw the line at owner only: an admin can invite and remove
// members (AS-019) but does not get to reassign roles. `newRole` is
// restricted by `changeMemberRoleSchema` to "member" | "admin" — this
// action can never grant "owner" through it; see that schema for why.
export async function changeMemberRole(
  workspaceId: string,
  targetMembershipId: string,
  newRole: "member" | "admin",
): Promise<ChangeMemberRoleResult> {
  const parsed = changeMemberRoleSchema.safeParse({
    workspaceId,
    targetMembershipId,
    newRole,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      error: "You must be signed in to change a member's role.",
    };
  }

  const admin = createAdminClient();

  // Defense in depth (AS-143 convention, tightened per AS-014/AS-015/
  // AS-019): re-check the caller is specifically the active *owner* of
  // this exact workspace, server-side — an admin calling this action
  // directly (bypassing the UI, which only renders the control for
  // owners) must be rejected just as a plain member would be.
  const membership = await requireWorkspaceOwner(
    admin,
    parsed.data.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "Only the workspace owner can change member roles.",
    };
  }

  const { data: targetRow, error: lookupError } = await admin
    .from("workspace_members")
    .select("id, status, role")
    .eq("id", parsed.data.targetMembershipId)
    .eq("workspace_id", parsed.data.workspaceId)
    .maybeSingle();

  if (lookupError) {
    console.error("changeMemberRole: target lookup failed:", lookupError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  if (!targetRow) {
    return { ok: false, error: "This member no longer exists." };
  }

  // Only active members have a meaningful role to change; a pending
  // invite's role is changed by revoking and re-inviting (out of scope
  // here), and an owner's own row is never touched by this action (no
  // "become owner" path, and demoting the sole owner is AS-018's guard,
  // not this feature's).
  if (targetRow.status !== "active") {
    return {
      ok: false,
      error: "Only active members can have their role changed.",
    };
  }

  if (targetRow.role === "owner") {
    return {
      ok: false,
      error: "The workspace owner's role cannot be changed here.",
    };
  }

  if (targetRow.role === parsed.data.newRole) {
    return { ok: true };
  }

  const { error: updateError } = await admin
    .from("workspace_members")
    .update({ role: parsed.data.newRole })
    .eq("id", parsed.data.targetMembershipId)
    .eq("workspace_id", parsed.data.workspaceId)
    .eq("status", "active");

  if (updateError) {
    console.error("changeMemberRole: update failed:", updateError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", parsed.data.workspaceId)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}/settings/members`);
    } catch (revalidateError) {
      // Same non-fatal cache-freshness rationale as inviteMember/
      // revokeInvite above: revalidatePath throws outside an active
      // request/render context (e.g. this action invoked from a test
      // harness). The role change itself already succeeded, so this is
      // not an action failure.
      console.error(
        "changeMemberRole: revalidatePath failed (non-fatal):",
        revalidateError,
      );
    }
  }

  return { ok: true };
}
