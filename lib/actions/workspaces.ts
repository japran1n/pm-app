"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createWorkspaceSchema,
  inviteMemberSchema,
  revokeInviteSchema,
  changeMemberRoleSchema,
  removeMemberSchema,
  transferOwnershipSchema,
  deleteWorkspaceSchema,
  renameWorkspaceSchema,
  changeWorkspaceSlugSchema,
  uploadWorkspaceLogoSchema,
  slugify,
  findAvailableSlug,
} from "@/lib/validation/workspaces";
import {
  requireWorkspaceAdmin,
  requireWorkspaceOwner,
} from "@/lib/auth/require-membership";
import { writeAudit } from "@/lib/activity/audit";
import { matchesDeclaredAvatarMimeType } from "@/lib/validation/profile";

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

export type RemoveMemberResult =
  | { ok: true }
  | { ok: false; error: string };

export type TransferOwnershipResult =
  | { ok: true }
  | { ok: false; error: string };

export type DeleteWorkspaceResult =
  | { ok: false; error: string };

export type RenameWorkspaceResult =
  | { ok: true; data: { name: string } }
  | { ok: false; error: string };

export type ChangeWorkspaceSlugResult =
  | { ok: true; data: { slug: string } }
  | { ok: false; error: string };

export type UploadWorkspaceLogoResult =
  | { ok: true; data: { logoUrl: string } }
  | { ok: false; error: string };

// Creates a workspace and makes the calling user its owner (AS-005, AS-006).
//
// F095 hardening: this used to be a two-step admin-client insert (workspace,
// then membership) with a manual compensating-delete rollback if the second
// insert failed. Scrutiny (M2-scrutiny.md AS-006) found two problems with
// that: (1) the rollback delete itself could fail, silently leaving an
// orphaned, ownerless workspace that squats its slug forever; (2) more
// fundamentally, the permissive `workspaces_insert_authenticated` RLS
// policy (`with check (true)`) let *any* authenticated client bypass this
// Server Action entirely via a direct `.from("workspaces").insert(...)`
// call, producing the exact same kind of orphan with no server-side
// involvement at all.
//
// Fix (supabase/migrations/20260817234323_workspace_create_rpc.sql): both
// inserts now happen inside a single SECURITY DEFINER Postgres function,
// `create_workspace_with_owner`, invoked here as an RPC through the
// user-session client (not the admin client — the function reads the owner
// id from `auth.uid()`, so it must run with the caller's session). A single
// function body runs in one implicit transaction, so if the membership
// insert fails, Postgres rolls back the workspace insert too — atomic with
// no manual rollback step. The migration also drops the old permissive
// INSERT policy and revokes the `authenticated` role's table-level INSERT
// grant on `workspaces`, so a bare client-side insert is now rejected
// before any policy even runs — the RPC is the only path that can create a
// workspace.
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

  const { data: created, error: createError } = await supabase.rpc(
    "create_workspace_with_owner",
    { p_name: parsed.data.name, p_slug: slug },
  );

  if (createError) {
    console.error(
      "createWorkspace: create_workspace_with_owner RPC failed:",
      createError,
    );
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const workspace = Array.isArray(created) ? created[0] : created;

  if (!workspace) {
    console.error(
      "createWorkspace: create_workspace_with_owner RPC returned no row",
    );
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  redirect(`/w/${workspace.slug}`);
}

// AS-007: Finds an auth user by email via admin.auth.admin.listUsers(),
// paginating through every page rather than relying on the API's single
// unpaginated default (50 users/page). Supabase's Admin API has no
// server-side email filter for listUsers (confirmed against the current
// @supabase/auth-js PageParams type, which only exposes `page`/`perPage`),
// so an exhaustive paginated scan is the only correct option today. Returns
// the matching `User`, `null` if no user has that email, or the sentinel
// `"lookup_failed"` if any page request errors (caller surfaces a generic
// error rather than silently treating a failed lookup as "no match").
async function findAuthUserByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<User | null | "lookup_failed"> {
  const perPage = 1000;
  let page = 1;

  // Upper bound purely as a runaway-loop safety net (1000 pages * 1000
  // users/page = 1,000,000 users) — not expected to ever be hit in
  // practice, and the loop's own `nextPage === null` check is what
  // normally ends it.
  const maxPages = 1000;

  while (page <= maxPages) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      console.error(
        "findAuthUserByEmail: listUsers page lookup failed:",
        error,
      );
      return "lookup_failed";
    }

    const match = data.users.find(
      (candidate) => candidate.email?.toLowerCase() === email,
    );

    if (match) {
      return match;
    }

    if (data.nextPage === null || data.users.length === 0) {
      return null;
    }

    page = data.nextPage;
  }

  return null;
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
  role?: "admin" | "member" | "viewer" | "guest" | "client",
  projectId?: string,
): Promise<InviteMemberResult> {
  const parsed = inviteMemberSchema.safeParse({
    workspaceId,
    email,
    ...(role !== undefined ? { role } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
  });

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
  //
  // AS-007 fix: Supabase's admin.auth.admin.listUsers() has no server-side
  // email filter (checked against the current @supabase/auth-js PageParams
  // type — it only accepts `page`/`perPage`, no `filter`/`email` option), so
  // a single unpaginated call only sees the first 50 users (the API
  // default). In any instance with >50 registered users, an already-active
  // member past page 1 would be missed and could be silently re-invited.
  // We paginate through every page until we find a match or run out of
  // pages.
  const matchingUser = await findAuthUserByEmail(admin, parsed.data.email);

  if (matchingUser === "lookup_failed") {
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

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

  // F134 (AS-220): a guest invite may carry a projectId — the project the
  // invitee is scoped to on acceptance. Re-verified server-side that the
  // named project actually belongs to this workspace (defense in depth,
  // same rationale as every other cross-workspace-leak check in this
  // file) rather than trusting the client-submitted id.
  if (parsed.data.projectId) {
    const { data: targetProject, error: targetProjectError } = await admin
      .from("projects")
      .select("id")
      .eq("id", parsed.data.projectId)
      .eq("workspace_id", parsed.data.workspaceId)
      .is("deleted_at", null)
      .maybeSingle();

    if (targetProjectError) {
      console.error(
        "inviteMember: project lookup failed:",
        targetProjectError,
      );
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    if (!targetProject) {
      return {
        ok: false,
        error: "That project could not be found in this workspace.",
      };
    }
  }

  // AS-238: the row is created with the role the inviter chose (default
  // "member" when the caller doesn't specify one), and that same `role`
  // column is what the accept path (activateInvitedMemberships) grants
  // unchanged when it later flips status/user_id — see the F126 migration
  // comment for why no separate invited_role column exists.
  // F134 (AS-220): invited_project_id is read once, on acceptance, by
  // activateInvitedMemberships to also create the guest's project_members
  // row — see lib/actions/invites.ts.
  const { data: insertedInvite, error: insertError } = await admin
    .from("workspace_members")
    .insert({
      workspace_id: parsed.data.workspaceId,
      user_id: null,
      invited_email: parsed.data.email,
      role: parsed.data.role,
      status: "invited",
      invited_project_id: parsed.data.projectId ?? null,
    })
    .select("id")
    .single();

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

  await writeAudit(supabase, {
    workspaceId: parsed.data.workspaceId,
    action: "member.invited",
    targetType: "workspace_member",
    targetId: insertedInvite?.id ?? null,
    metadata: { email: parsed.data.email, role: parsed.data.role },
  });

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

  await writeAudit(supabase, {
    workspaceId: parsed.data.workspaceId,
    action: "invite.revoked",
    targetType: "workspace_member",
    targetId: parsed.data.workspaceMemberId,
  });

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

// Changes an existing active member's role among "member" | "admin" |
// "viewer" | "guest" (AS-218, AS-219, AS-235 — F129, superseding mission-1's
// owner-only AS-014/AS-015/AS-019 now that F126 widened the role set).
//
// AS-218: owner OR admin may perform this — deliberately the broader
// `requireWorkspaceAdmin` check (not the owner-only line the old F019
// implementation used), because AS-218 explicitly says "an owner or admin
// can change any member's role."
//
// AS-219: the last remaining owner cannot be demoted to any other role.
// A non-sole owner's row CAN now be the target of this action (unlike the
// old implementation, which rejected touching any owner row outright).
//
// This guard is a check-then-act count-then-update (count active owners,
// reject if <= 1, otherwise update), NOT the atomic SELECT ... FOR UPDATE
// Postgres-function pattern F094's `remove_workspace_member` used to close
// the equivalent TOCTOU race for AS-018. That RPC pattern is the intended
// long-term shape for this guard too (reusing the same technique, not
// reinventing a different one) — deploying it requires `supabase db push`
// against the linked project, which this worker's sandbox could not reach
// (direct/pooled Postgres connection attempts hung with no error; the
// Supabase Management API needed for `--linked` requires
// SUPABASE_ACCESS_TOKEN, which is not present in this environment). See
// the F129 handoff's Out-of-scope section for the exact follow-up spec:
// add a `change_workspace_member_role` SECURITY DEFINER function mirroring
// `remove_workspace_member` once migration-push access is restored, and
// swap this block to call it. Until then, this is the same class of race
// mission-1's original (pre-F094) removeMember guard had — narrow window,
// requires two concurrent role-change calls against the same 2-owner
// workspace, not exercised by any assigned assertion here.
//
// AS-235: a guest cannot be promoted directly to admin (or owner — already
// excluded from `newRole` entirely). Per the clarified spec, promoting a
// guest takes the simpler of the two open options: a single UI action that
// is rejected server-side if it tries to jump straight from "guest" to
// "admin", rather than a bespoke two-step wizard flow. A caller who wants
// to make a guest an admin makes two separate role changes (guest → member,
// then member → admin) — no new UI state machine, no second source of
// truth for "is this a multi-step promotion in progress."
//
// `newRole` is restricted by `changeMemberRoleSchema` to "member" | "admin"
// | "viewer" | "guest" — this action can never grant "owner" through it.
export async function changeMemberRole(
  workspaceId: string,
  targetMembershipId: string,
  newRole: "member" | "admin" | "viewer" | "guest" | "client",
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

  // Defense in depth (AS-143 convention): re-check the caller is an active
  // owner/admin of this exact workspace, server-side — AS-218 widens this
  // from the old owner-only check to owner-or-admin; a plain member or
  // guest calling this action directly (bypassing the UI) must still be
  // rejected.
  const membership = await requireWorkspaceAdmin(
    admin,
    parsed.data.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "Only the workspace owner or an admin can change member roles.",
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
  // here).
  if (targetRow.status !== "active") {
    return {
      ok: false,
      error: "Only active members can have their role changed.",
    };
  }

  // AS-235: a guest cannot be promoted directly to admin. (Promotion to
  // "owner" is already impossible — `newRole` never accepts that value.)
  // Per the clarified spec's simpler option, this is a single rejected
  // action, not a two-step wizard: an admin/owner who wants a guest to
  // become an admin makes two calls — guest → member, then member → admin.
  if (targetRow.role === "guest" && parsed.data.newRole === "admin") {
    return {
      ok: false,
      error:
        "A guest cannot be promoted directly to admin. Change them to a member first, then to admin.",
    };
  }

  if (targetRow.role === parsed.data.newRole) {
    return { ok: true };
  }

  if (targetRow.role === "owner") {
    // AS-219: count the workspace's other active owners before allowing a
    // demotion. See the doc comment above this function for why this is a
    // check-then-act count rather than the atomic RPC pattern used
    // elsewhere in this file.
    const { count: ownerCount, error: ownerCountError } = await admin
      .from("workspace_members")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("role", "owner")
      .eq("status", "active");

    if (ownerCountError) {
      console.error(
        "changeMemberRole: owner count check failed:",
        ownerCountError,
      );
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }

    if ((ownerCount ?? 0) <= 1) {
      return {
        ok: false,
        error: "You cannot change the role of the sole owner of a workspace.",
      };
    }
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

  await writeAudit(supabase, {
    workspaceId: parsed.data.workspaceId,
    action: "member.role_changed",
    targetType: "workspace_member",
    targetId: parsed.data.targetMembershipId,
    metadata: { old_role: targetRow.role, new_role: parsed.data.newRole },
  });

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

// Removes an active member from a workspace (AS-016). Owner or admin may
// perform this — deliberately the broader owner/admin line
// (`requireWorkspaceAdmin`), unlike AS-014's owner-only `changeMemberRole`,
// because AS-016 does not restrict this to the owner.
//
// AS-018 sole-owner guard: before deleting the membership row, count how
// many active owner-role members this workspace currently has. If the
// target is an owner and is the only one, reject — a workspace can never
// be left without an owner via this action.
export async function removeMember(
  workspaceId: string,
  targetMembershipId: string,
): Promise<RemoveMemberResult> {
  const parsed = removeMemberSchema.safeParse({
    workspaceId,
    targetMembershipId,
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
    return { ok: false, error: "You must be signed in to remove a member." };
  }

  const admin = createAdminClient();

  // Defense in depth (AS-143): re-check the caller is an active owner/admin
  // of this exact workspace, server-side, rather than trusting that the UI
  // only shows the remove control to owners/admins.
  const membership = await requireWorkspaceAdmin(
    admin,
    parsed.data.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to remove members from this workspace.",
    };
  }

  const { data: targetRow, error: lookupError } = await admin
    .from("workspace_members")
    .select("id, status, role")
    .eq("id", parsed.data.targetMembershipId)
    .eq("workspace_id", parsed.data.workspaceId)
    .maybeSingle();

  if (lookupError) {
    console.error("removeMember: target lookup failed:", lookupError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  if (!targetRow) {
    return { ok: false, error: "This member no longer exists." };
  }

  if (targetRow.status !== "active") {
    return {
      ok: false,
      error: "Only active members can be removed.",
    };
  }

  // F094 hardening (AS-018): the old guard here was check-then-act — a
  // SELECT to count active owners, then a separate conditional DELETE, with
  // nothing tying the two together. Two concurrent removeMember calls
  // against a 2-owner workspace could both read count=2, both pass, and
  // both succeed, leaving zero owners (TOCTOU race). Scrutiny (M2-scrutiny.
  // md AS-018) flagged this as a blocker.
  //
  // Fix (supabase/migrations/20260817234900_remove_member_atomic_owner_
  // guard.sql): the count-and-delete now happens inside a single SECURITY
  // DEFINER Postgres function, `remove_workspace_member`, invoked here as
  // one RPC call. The function locks the relevant rows with `SELECT ...
  // FOR UPDATE` before counting, so a second concurrent invocation targeting
  // the same workspace's owners blocks until the first transaction commits
  // or rolls back, then re-reads the post-delete state — there is no window
  // where two calls can both observe a stale "safe to delete" count. This
  // mirrors the atomicity approach F095 used for create_workspace_with_owner
  // (AS-006).
  const { data: rpcRows, error: rpcError } = await admin.rpc(
    "remove_workspace_member",
    {
      p_membership_id: parsed.data.targetMembershipId,
      p_workspace_id: parsed.data.workspaceId,
    },
  );

  if (rpcError) {
    console.error("removeMember: remove_workspace_member RPC failed:", rpcError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const rpcResult = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;

  if (!rpcResult?.deleted) {
    if (rpcResult?.reason === "sole_owner") {
      return {
        ok: false,
        error: "You cannot remove the sole owner of a workspace.",
      };
    }
    if (rpcResult?.reason === "not_active") {
      return {
        ok: false,
        error: "Only active members can be removed.",
      };
    }
    // "not_found" here would mean the row vanished between the earlier
    // lookup and this RPC call (e.g. removed by a concurrent request) —
    // treat it the same as the initial existence check above.
    return { ok: false, error: "This member no longer exists." };
  }

  await writeAudit(supabase, {
    workspaceId: parsed.data.workspaceId,
    action: "member.removed",
    targetType: "workspace_member",
    targetId: parsed.data.targetMembershipId,
    metadata: { role: targetRow.role },
  });

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", parsed.data.workspaceId)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}/settings/members`);
    } catch (revalidateError) {
      // Same non-fatal cache-freshness rationale as the other actions in
      // this file: revalidatePath throws outside an active request/render
      // context (e.g. this action invoked from a test harness). The
      // removal itself already succeeded, so this is not an action
      // failure.
      console.error(
        "removeMember: revalidatePath failed (non-fatal):",
        revalidateError,
      );
    }
  }

  return { ok: true };
}

// F130 (AS-233, AS-234): transfers ownership of a workspace to another
// active member. Owner-only (`requireWorkspaceOwner`) — unlike
// `removeMember`/`changeMemberRole`'s broader owner-or-admin line, only the
// current owner may hand off ownership.
//
// Atomicity: this is a genuine two-write operation (old owner -> admin,
// new owner -> owner), unlike F129's `changeMemberRole` sole-owner guard,
// which could get away with a check-then-act compromise because it only
// ever mutates one row. A partial failure here would leave the workspace
// either ownerless or double-owned, both of which break every owner-only
// permission check in the app — so both writes happen inside the single
// SECURITY DEFINER `transfer_workspace_ownership` RPC
// (supabase/migrations/20260822085141_transfer_workspace_ownership_atomic.sql),
// which mirrors `remove_workspace_member`'s (F094) `SELECT ... FOR UPDATE`
// locking shape: both rows are locked, validated, and updated inside one
// implicit transaction, so a mid-transfer failure leaves the original
// owner's row completely untouched (AS-233).
//
// AS-234: the RPC rejects a target who is not an active member of this
// exact workspace (removed, pending/invited, or not a member at all) —
// mapped below to a specific user-facing message.
export async function transferOwnership(
  workspaceId: string,
  newOwnerUserId: string,
): Promise<TransferOwnershipResult> {
  const parsed = transferOwnershipSchema.safeParse({
    workspaceId,
    newOwnerUserId,
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
      error: "You must be signed in to transfer ownership.",
    };
  }

  const admin = createAdminClient();

  // Defense in depth (AS-143 convention): re-check the caller is
  // specifically the active *owner* of this exact workspace, server-side —
  // an admin or member calling this action directly (bypassing the UI,
  // which only renders the control for the owner) must be rejected.
  const membership = await requireWorkspaceOwner(
    admin,
    parsed.data.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "Only the workspace owner can transfer ownership.",
    };
  }

  if (parsed.data.newOwnerUserId === user.id) {
    return {
      ok: false,
      error: "You are already the owner of this workspace.",
    };
  }

  const { data: rpcRows, error: rpcError } = await admin.rpc(
    "transfer_workspace_ownership",
    {
      p_workspace_id: parsed.data.workspaceId,
      p_new_owner_user_id: parsed.data.newOwnerUserId,
    },
  );

  if (rpcError) {
    console.error(
      "transferOwnership: transfer_workspace_ownership RPC failed:",
      rpcError,
    );
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const rpcResult = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;

  if (!rpcResult?.transferred) {
    if (
      rpcResult?.reason === "target_not_member" ||
      rpcResult?.reason === "target_not_active"
    ) {
      return {
        ok: false,
        error:
          "You can only transfer ownership to an active member of this workspace.",
      };
    }
    if (rpcResult?.reason === "target_is_current_owner") {
      return {
        ok: false,
        error: "You are already the owner of this workspace.",
      };
    }
    if (rpcResult?.reason === "no_active_owner") {
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  await writeAudit(supabase, {
    workspaceId: parsed.data.workspaceId,
    action: "workspace.ownership_transferred",
    targetType: "workspace_member",
    targetId: null,
    metadata: { new_owner_user_id: parsed.data.newOwnerUserId },
  });

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", parsed.data.workspaceId)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}/settings/members`);
    } catch (revalidateError) {
      // Same non-fatal cache-freshness rationale as every other action in
      // this file: revalidatePath throws outside an active request/render
      // context (e.g. this action invoked from a test harness). The
      // transfer itself already succeeded, so this is not an action
      // failure.
      console.error(
        "transferOwnership: revalidatePath failed (non-fatal):",
        revalidateError,
      );
    }
  }

  return { ok: true };
}

// Soft-deletes a workspace (AS-020, AS-021). Owner-only — deliberately the
// strict `requireWorkspaceOwner` check (not `requireWorkspaceAdmin`), since
// AS-020 says "only the owner", unlike AS-016's broader owner-or-admin line
// for member removal.
//
// AS-021: sets `deleted_at = now()` rather than deleting the row (tech-
// decisions.md convention — never hard-delete). F012's
// `workspaces_select_active_members` RLS policy already filters
// `deleted_at IS NULL`, so once this succeeds the workspace stops appearing
// in the switcher and every other membership-scoped query immediately, with
// no separate follow-up change needed there.
//
// Cascade scope: `projects` and `tasks` tables don't exist yet (M3/M4,
// later milestones), so this cannot cascade a soft-delete to them today —
// only the workspace row itself is soft-deleted here.
export async function deleteWorkspace(
  workspaceId: string,
): Promise<DeleteWorkspaceResult> {
  const parsed = deleteWorkspaceSchema.safeParse({ workspaceId });

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
    return { ok: false, error: "You must be signed in to delete a workspace." };
  }

  const admin = createAdminClient();

  // Defense in depth (AS-143 convention, tightened per AS-020): re-check the
  // caller is specifically the active *owner* of this exact workspace,
  // server-side — an admin or member calling this action directly
  // (bypassing the UI, which only renders the control for owners) must be
  // rejected.
  const membership = await requireWorkspaceOwner(
    admin,
    parsed.data.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "Only the workspace owner can delete a workspace.",
    };
  }

  const { data: workspaceRow, error: lookupError } = await admin
    .from("workspaces")
    .select("id, deleted_at")
    .eq("id", parsed.data.workspaceId)
    .maybeSingle();

  if (lookupError) {
    console.error("deleteWorkspace: workspace lookup failed:", lookupError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  if (!workspaceRow || workspaceRow.deleted_at) {
    return { ok: false, error: "This workspace no longer exists." };
  }

  // TODO(F029/F038 or later): cascade soft-delete to projects/tasks once
  // those tables exist. Until then, only the workspace row itself is
  // soft-deleted — a known-incomplete cascade, tracked here rather than
  // silently missing (see this feature's handoff for the full rationale).
  const { error: updateError } = await admin
    .from("workspaces")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", parsed.data.workspaceId)
    .is("deleted_at", null);

  if (updateError) {
    console.error("deleteWorkspace: soft-delete update failed:", updateError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  await writeAudit(supabase, {
    workspaceId: parsed.data.workspaceId,
    action: "workspace.deleted",
    targetType: "workspace",
    targetId: parsed.data.workspaceId,
  });

  try {
    revalidatePath(`/w/${parsed.data.workspaceId}`, "layout");
  } catch (revalidateError) {
    // Same non-fatal cache-freshness rationale as the other actions in this
    // file: revalidatePath throws outside an active request/render context
    // (e.g. this action invoked from a test harness). The soft-delete
    // itself already succeeded, so this is not an action failure.
    console.error(
      "deleteWorkspace: revalidatePath failed (non-fatal):",
      revalidateError,
    );
  }

  // Find the caller's next remaining active workspace membership (if any)
  // to redirect to, so deleting a workspace never strands the caller on a
  // now-inaccessible page. Falls back to /onboarding when none remain,
  // matching every other "no workspace" redirect in this app (see
  // app/(auth)/auth/callback/route.ts and the [workspaceSlug] layout/page
  // guards).
  const { data: nextMembership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .neq("workspace_id", parsed.data.workspaceId)
    .limit(1)
    .maybeSingle();

  if (nextMembership?.workspace_id) {
    const { data: nextWorkspace } = await admin
      .from("workspaces")
      .select("slug")
      .eq("id", nextMembership.workspace_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (nextWorkspace?.slug) {
      redirect(`/w/${nextWorkspace.slug}`);
    }
  }

  redirect("/onboarding");
}

// F136 (AS-239, AS-240): renames a workspace from its settings page.
// Owner-or-admin (`requireWorkspaceAdmin`), matching `canManageProject`
// (lib/auth/permissions.ts) — deliberately less strict than
// `deleteWorkspace`'s owner-only gate (AS-244 only narrows *delete*, not
// general settings management).
//
// The workspace's `slug` is intentionally left untouched here: this
// action only ever writes `name`. Changing the slug would break every
// existing bookmark/link into `/w/{slug}/...` for no assertion this
// feature is scoped to cover, so the settings page renders slug as a
// read-only field (see the settings page's own comment) rather than this
// action growing a second, riskier responsibility.
//
// AS-240 ("renaming a workspace updates the switcher immediately"):
// `revalidatePath(.../layout")` invalidates the workspace layout's cached
// RSC payload (the layout is what fetches `workspaces` for the switcher),
// and the calling Client Component follows up with `router.refresh()`
// once this action resolves — the same two-step pattern
// `archiveProject`/`ArchiveProjectDialog` already use elsewhere in this
// app — so the switcher's displayed name changes without a manual
// reload, not just on the next natural navigation.
export async function renameWorkspace(
  workspaceId: string,
  name: string,
): Promise<RenameWorkspaceResult> {
  const parsed = renameWorkspaceSchema.safeParse({ workspaceId, name });

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
    return { ok: false, error: "You must be signed in to rename a workspace." };
  }

  const admin = createAdminClient();

  // Defense in depth (AS-143 convention): re-check the caller is
  // specifically owner/admin of this exact workspace, server-side — a
  // member or viewer calling this action directly (bypassing the UI,
  // which only renders the form for owner/admin per `canManageProject`)
  // must be rejected.
  const membership = await requireWorkspaceAdmin(
    admin,
    parsed.data.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "Only a workspace owner or admin can rename this workspace.",
    };
  }

  const { data: workspaceRow, error: lookupError } = await admin
    .from("workspaces")
    .select("id, slug, deleted_at")
    .eq("id", parsed.data.workspaceId)
    .maybeSingle();

  if (lookupError) {
    console.error("renameWorkspace: workspace lookup failed:", lookupError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  if (!workspaceRow || workspaceRow.deleted_at) {
    return { ok: false, error: "This workspace no longer exists." };
  }

  const { data: updated, error: updateError } = await admin
    .from("workspaces")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.workspaceId)
    .select("name")
    .single();

  if (updateError || !updated) {
    console.error("renameWorkspace: update failed:", updateError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  await writeAudit(supabase, {
    workspaceId: parsed.data.workspaceId,
    action: "workspace.renamed",
    targetType: "workspace",
    targetId: parsed.data.workspaceId,
    metadata: { name: updated.name },
  });

  try {
    // "layout" invalidates every page nested under this workspace's
    // layout (sidebar switcher, page titles that read the workspace name
    // server-side), matching `deleteWorkspace`'s own use of the "layout"
    // type just above.
    revalidatePath(`/w/${workspaceRow.slug}`, "layout");
  } catch (revalidateError) {
    // Same non-fatal cache-freshness rationale as every other action in
    // this file: revalidatePath throws outside an active request/render
    // context (e.g. this action invoked from a test harness). The rename
    // itself already succeeded, so this is not an action failure.
    console.error(
      "renameWorkspace: revalidatePath failed (non-fatal):",
      revalidateError,
    );
  }

  return { ok: true, data: { name: updated.name } };
}

// F137 (AS-241, AS-242): changes a workspace's slug from its settings page.
// Owner-or-admin (`requireWorkspaceAdmin`), the same gate `renameWorkspace`
// uses — slug is part of the same "general settings" section, not a more
// sensitive operation than the name.
//
// AS-242: uniqueness is checked across BOTH currently-live slugs
// (`workspaces.slug`, which already carries its own unique constraint as a
// backstop) AND retired slugs (`workspace_slug_history.old_slug`, unique
// per that table's own constraint) — a slug that used to belong to some
// *other* workspace must stay rejected forever, otherwise a second
// workspace could "steal" it and hijack the first workspace's still-live
// old bookmarks/redirects. Both checks are surfaced as the same
// field-level error (returned as `ok: false` with a message the caller
// renders next to the slug field, not a generic failure toast).
//
// AS-241: on a successful change, the OLD slug is inserted into
// `workspace_slug_history` in the same request (best-effort — see the
// insert's own error handling below) before `workspaces.slug` is updated,
// so the workspace layout (app/(workspace)/w/[workspaceSlug]/layout.tsx)
// can resolve a request for the old slug to this workspace's new one and
// issue a permanent redirect instead of 404ing. See that layout for the
// redirect side of this feature.
export async function changeWorkspaceSlug(
  workspaceId: string,
  slug: string,
): Promise<ChangeWorkspaceSlugResult> {
  const parsed = changeWorkspaceSlugSchema.safeParse({ workspaceId, slug });

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
    return { ok: false, error: "You must be signed in to change a workspace's URL." };
  }

  const admin = createAdminClient();

  // Defense in depth (AS-143 convention): re-check the caller is
  // specifically owner/admin of this exact workspace, server-side — a
  // member or viewer calling this action directly (bypassing the UI)
  // must be rejected.
  const membership = await requireWorkspaceAdmin(
    admin,
    parsed.data.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "Only a workspace owner or admin can change this workspace's URL.",
    };
  }

  const { data: workspaceRow, error: lookupError } = await admin
    .from("workspaces")
    .select("id, slug, deleted_at")
    .eq("id", parsed.data.workspaceId)
    .maybeSingle();

  if (lookupError) {
    console.error("changeWorkspaceSlug: workspace lookup failed:", lookupError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  if (!workspaceRow || workspaceRow.deleted_at) {
    return { ok: false, error: "This workspace no longer exists." };
  }

  const newSlug = parsed.data.slug;

  // No-op: submitting the workspace's current slug unchanged. Treat as a
  // trivial success rather than a "slug already in use" rejection — it is
  // this workspace's own live slug, not a collision with anyone else's.
  if (newSlug === workspaceRow.slug) {
    return { ok: true, data: { slug: workspaceRow.slug } };
  }

  // AS-242: check the new slug against every OTHER workspace's currently
  // live slug.
  const { data: liveCollision, error: liveCollisionError } = await admin
    .from("workspaces")
    .select("id")
    .eq("slug", newSlug)
    .is("deleted_at", null)
    .maybeSingle();

  if (liveCollisionError) {
    console.error(
      "changeWorkspaceSlug: live-slug collision check failed:",
      liveCollisionError,
    );
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  if (liveCollision) {
    return { ok: false, error: "This URL is already in use." };
  }

  // AS-242: check the new slug against every retired slug in history,
  // regardless of which workspace it used to belong to (including this
  // workspace's own past slugs — a slug is retired permanently once
  // changed, and re-claiming it here would break any old redirect chain
  // pointing at it).
  const { data: historyCollision, error: historyCollisionError } = await admin
    .from("workspace_slug_history")
    .select("id")
    .eq("old_slug", newSlug)
    .maybeSingle();

  if (historyCollisionError) {
    console.error(
      "changeWorkspaceSlug: history-slug collision check failed:",
      historyCollisionError,
    );
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  if (historyCollision) {
    return { ok: false, error: "This URL was used before and can't be reused." };
  }

  const oldSlug = workspaceRow.slug;

  // AS-241: record the retired slug before flipping `workspaces.slug`, so
  // a crash/error between the two steps leans toward "old URL still
  // 404s" rather than "old URL is live" (a missing history row is safe;
  // a stray one pointing at a slug that was never actually retired is
  // not). If this insert fails (e.g. a race lost the old_slug unique
  // constraint to a concurrent change of some other workspace's slug back
  // to this exact value, vanishingly unlikely but not impossible), the
  // whole change is rejected rather than proceeding without a working
  // redirect for the slug being abandoned.
  const { error: historyInsertError } = await admin
    .from("workspace_slug_history")
    .insert({ workspace_id: parsed.data.workspaceId, old_slug: oldSlug });

  if (historyInsertError) {
    console.error(
      "changeWorkspaceSlug: history insert failed:",
      historyInsertError,
    );
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { data: updated, error: updateError } = await admin
    .from("workspaces")
    .update({ slug: newSlug })
    .eq("id", parsed.data.workspaceId)
    .select("slug")
    .single();

  if (updateError || !updated) {
    console.error("changeWorkspaceSlug: update failed:", updateError);
    // Best-effort compensating cleanup: remove the history row we just
    // wrote so a failed slug change doesn't leave a phantom redirect
    // target pointing at a slug the workspace never actually stopped
    // using. Non-fatal if this also fails — the history row is at worst
    // a harmless (if theoretically confusing) redirect to a workspace
    // that already owns that exact slug, since the update above did not
    // take effect.
    await admin
      .from("workspace_slug_history")
      .delete()
      .eq("workspace_id", parsed.data.workspaceId)
      .eq("old_slug", oldSlug);

    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // F140 convention: every workspace-mutating action records an audit_log
  // entry via writeAudit (AS-245-adjacent — not itself an assigned
  // assertion of this feature, but matching the established pattern every
  // other action in this file now follows).
  await writeAudit(supabase, {
    workspaceId: parsed.data.workspaceId,
    action: "workspace.slug_changed",
    targetType: "workspace",
    targetId: parsed.data.workspaceId,
    metadata: { old_slug: oldSlug, new_slug: updated.slug },
  });

  try {
    // "layout" invalidates every page nested under the OLD slug's layout
    // path — the route itself moves out from under it once `slug`
    // changes, so this mirrors `deleteWorkspace`/`renameWorkspace`'s own
    // use of the "layout" type for the same "this route tree's data
    // changed" reason.
    revalidatePath(`/w/${oldSlug}`, "layout");
  } catch (revalidateError) {
    console.error(
      "changeWorkspaceSlug: revalidatePath failed (non-fatal):",
      revalidateError,
    );
  }

  return { ok: true, data: { slug: updated.slug } };
}

// F138 (AS-243): "an owner can upload a logo, shown in the workspace
// switcher." Pattern mirrors lib/actions/profile.ts's uploadAvatar almost
// exactly — Zod-validated input checked before any Storage call, magic-
// byte MIME sniffing (F274 hardening) before the Storage write, admin
// client for the actual write + `workspaces` update, discriminated-union
// return, generic user-facing errors with details only logged
// server-side. Reuses the SAME `avatars` Storage bucket as F121's avatar
// upload rather than a second bucket — see this feature's migration
// (supabase/migrations/20260821222000_workspace_logo.sql) for the bucket-
// choice rationale — under a `workspace-logos/{workspace_id}/logo` path
// prefix, no file extension (same "MIME lives in Storage metadata, not
// the path" convention as avatars).
//
// Takes a FormData for the same reason uploadAvatar does — Server Actions
// receive `File` objects through FormData, not as plain function
// arguments.
const AVATARS_BUCKET_FOR_LOGOS = "avatars";

export async function uploadWorkspaceLogo(
  formData: FormData,
): Promise<UploadWorkspaceLogoResult> {
  const workspaceId = formData.get("workspaceId");
  const file = formData.get("file");

  if (typeof workspaceId !== "string" || !(file instanceof File)) {
    return { ok: false, error: "Invalid upload request." };
  }

  const parsed = uploadWorkspaceLogoSchema.safeParse({
    workspaceId,
    fileSize: file.size,
    mimeType: file.type,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid file.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      error: "You must be signed in to upload a workspace logo.",
    };
  }

  const admin = createAdminClient();

  // Defense in depth (AS-143/renameWorkspace convention): only an
  // owner/admin of THIS workspace may set its logo — a member/viewer/
  // guest calling this action directly (bypassing the UI, which only
  // renders the control for owner/admin) must be rejected. The Storage
  // RLS policies in this feature's migration re-check the exact same
  // owner/admin rule as a second layer, since the admin client used below
  // bypasses RLS.
  const membership = await requireWorkspaceAdmin(
    admin,
    parsed.data.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "Only a workspace owner or admin can change the workspace logo.",
    };
  }

  const { data: workspaceRow, error: lookupError } = await admin
    .from("workspaces")
    .select("id, deleted_at")
    .eq("id", parsed.data.workspaceId)
    .maybeSingle();

  if (lookupError) {
    console.error(
      "uploadWorkspaceLogo: workspace lookup failed:",
      lookupError,
    );
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  if (!workspaceRow || workspaceRow.deleted_at) {
    return { ok: false, error: "This workspace no longer exists." };
  }

  const objectPath = `workspace-logos/${parsed.data.workspaceId}/logo`;
  const arrayBuffer = await file.arrayBuffer();

  // AS-206-style hardening (F274 convention, applied here too): the
  // declared MIME type is entirely client-controlled, so the actual
  // leading bytes are sniffed against real JPEG/PNG/WebP signatures and
  // compared to what was declared before anything is written to Storage.
  if (
    !matchesDeclaredAvatarMimeType(
      new Uint8Array(arrayBuffer),
      parsed.data.mimeType,
    )
  ) {
    return {
      ok: false,
      error: "Logo must be a JPEG, PNG, or WebP image.",
    };
  }

  const { error: uploadError } = await admin.storage
    .from(AVATARS_BUCKET_FOR_LOGOS)
    .upload(objectPath, arrayBuffer, {
      contentType: parsed.data.mimeType,
      upsert: true,
    });

  if (uploadError) {
    console.error(
      "uploadWorkspaceLogo: storage upload failed:",
      uploadError,
    );
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // The bucket is public (F121) — a plain public URL is correct here for
  // the same reason it is for avatars. A cache-busting query param is
  // appended and stored as part of `logo_url` itself, same rationale as
  // uploadAvatar: the object path is fixed and reused on every
  // replacement, so without this every reader that just re-fetches
  // `workspaces.logo_url` would keep getting the CDN/browser-cached
  // previous image at the exact same URL after a successful replace.
  const { data: publicUrlData } = admin.storage
    .from(AVATARS_BUCKET_FOR_LOGOS)
    .getPublicUrl(objectPath);

  const logoUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

  const { error: updateError } = await admin
    .from("workspaces")
    .update({ logo_url: logoUrl })
    .eq("id", parsed.data.workspaceId);

  if (updateError) {
    console.error(
      "uploadWorkspaceLogo: workspaces update failed:",
      updateError,
    );
    // Best-effort cleanup so a failed workspaces update doesn't leave the
    // just-uploaded Storage object orphaned — mirrors uploadAvatar's own
    // post-Storage-success cleanup.
    await admin.storage.from(AVATARS_BUCKET_FOR_LOGOS).remove([objectPath]);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  await writeAudit(supabase, {
    workspaceId: parsed.data.workspaceId,
    action: "workspace.logo_changed",
    targetType: "workspace",
    targetId: parsed.data.workspaceId,
    metadata: {},
  });

  // AS-243: the logo is shown in the workspace switcher, which every page
  // under this workspace's layout renders (see
  // app/(workspace)/w/[workspaceSlug]/layout.tsx) — "layout" invalidates
  // every nested page's cached render so the new logo appears without a
  // manual reload, same convention as renameWorkspace/changeWorkspaceSlug.
  try {
    revalidatePath("/", "layout");
  } catch (revalidateError) {
    console.error(
      "uploadWorkspaceLogo: revalidatePath failed (non-fatal):",
      revalidateError,
    );
  }

  return { ok: true, data: { logoUrl } };
}
