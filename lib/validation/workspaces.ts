import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";

// Validates create-workspace input (AS-006) before it reaches Supabase.
export const createWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Workspace name is required.")
    .max(80, "Workspace name must be 80 characters or fewer."),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

// Validates invite-member input (AS-007, AS-238, AS-220). `role` names the
// role the invite grants on acceptance (F126) — deliberately excludes
// "owner" (an invite can never hand out ownership; see F095/AS-006 for how
// ownership is established). Defaults to "member" so every existing caller
// that doesn't pass a role keeps its current behaviour unchanged.
//
// F134: "guest" is now an acceptable invite role, and a guest invite may
// additionally carry `projectId` — the single project the invitee is
// scoped to on acceptance (AS-220: a guest sees only the projects they are
// added to, so a guest invite with no project would create a guest with
// zero project access, which is a valid-but-useless state, not an error;
// the server independently re-derives "guest requires a project" as a
// business rule below, not a hard schema constraint, so an admin can still
// invite a guest first and add project(s) via F131's addProjectMember
// afterward).
export const inviteMemberSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email is required.")
    .email("Enter a valid email address."),
  role: z
    .enum(["admin", "member", "viewer", "guest"], {
      message: "Role must be admin, member, viewer, or guest.",
    })
    .default("member"),
  projectId: z.string().uuid("Invalid project.").optional(),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

// Validates revoke-invite input (AS-024).
export const revokeInviteSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  workspaceMemberId: z.string().uuid("Invalid invite."),
});

export type RevokeInviteInput = z.infer<typeof revokeInviteSchema>;

// Validates change-member-role input (AS-218/AS-219/AS-232/AS-235,
// superseding mission-1's AS-014/AS-015/AS-019 now that F126 has widened
// workspace_members.role to the full 5-role set). `newRole` is deliberately
// restricted to "member" | "admin" | "viewer" | "guest" — "owner" is never
// an accepted value here: this action changes an *existing* member's role,
// and granting ownership isn't supported through it (a workspace must
// always have exactly the ownership it already has resolved elsewhere;
// see AS-219's sole-owner protection, which a generic "promote to owner"
// path would need to coordinate with and which is out of this feature's
// scope). An *owner*'s row CAN now be the target of this action (demoting
// them to one of these four roles) — AS-219 only blocks that when the
// target is the workspace's sole remaining owner; see
// lib/actions/workspaces.ts `changeMemberRole` for the atomic guard.
export const changeMemberRoleSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  targetMembershipId: z.string().uuid("Invalid member."),
  newRole: z.enum(["member", "admin", "viewer", "guest"], {
    message: "Role must be member, admin, viewer, or guest.",
  }),
});

export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;

// Validates remove-member input (AS-016/AS-017/AS-018).
export const removeMemberSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  targetMembershipId: z.string().uuid("Invalid member."),
});

export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;

// Validates delete-workspace input (AS-020/AS-021).
export const deleteWorkspaceSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
});

export type DeleteWorkspaceInput = z.infer<typeof deleteWorkspaceSchema>;

// Validates rename-workspace input (F136, AS-240). Same name shape as
// `createWorkspaceSchema` — one workspace-name validation rule for the
// whole app rather than a second, possibly-drifting copy.
export const renameWorkspaceSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  name: z
    .string()
    .trim()
    .min(1, "Workspace name is required.")
    .max(80, "Workspace name must be 80 characters or fewer."),
});

export type RenameWorkspaceInput = z.infer<typeof renameWorkspaceSchema>;

// Validates change-slug input (F137, AS-241/AS-242). Slugs are
// user-editable, unlike the auto-generated `slugify()` output used at
// creation time, so this enforces the same URL-safe shape directly
// (lowercase letters, digits, single hyphens, no leading/trailing
// hyphen) rather than silently normalizing arbitrary input through
// `slugify()` and surprising the caller with a value that doesn't match
// what they typed.
export const changeWorkspaceSlugSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Slug is required.")
    .max(80, "Slug must be 80 characters or fewer.")
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      "Slug can only contain lowercase letters, numbers, and single hyphens.",
    ),
});

export type ChangeWorkspaceSlugInput = z.infer<
  typeof changeWorkspaceSlugSchema
>;

// Turns "My Team!!" into "my-team", collapsing non-alphanumerics to single
// hyphens and trimming leading/trailing ones. Falls back to "workspace" if
// the name has no URL-safe characters at all (e.g. an all-emoji name).
//
// Lives outside lib/actions/workspaces.ts (a "use server" file) because
// every export of a "use server" module must itself be an async Server
// Action — a plain sync helper like this fails the Next.js build.
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "workspace";
}

// Finds a unique slug by appending -2, -3, ... on collision. Takes the admin
// client because uniqueness must be checked against all workspaces, not just
// ones the caller (who may not be a member of any yet) can see under RLS.
export async function findAvailableSlug(
  admin: ReturnType<typeof createAdminClient>,
  baseSlug: string,
): Promise<string> {
  const { data: existing, error } = await admin
    .from("workspaces")
    .select("slug")
    .like("slug", `${baseSlug}%`);

  if (error) {
    console.error("createWorkspace: slug uniqueness check failed:", error);
    // Fall back to the base slug; the insert's unique constraint on `slug`
    // is the final backstop if this races with another creation.
    return baseSlug;
  }

  const taken = new Set((existing ?? []).map((row) => row.slug));
  if (!taken.has(baseSlug)) {
    return baseSlug;
  }

  let n = 2;
  while (taken.has(`${baseSlug}-${n}`)) {
    n += 1;
  }
  return `${baseSlug}-${n}`;
}
