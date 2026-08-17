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

// Validates invite-member input (AS-007).
export const inviteMemberSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email is required.")
    .email("Enter a valid email address."),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

// Validates revoke-invite input (AS-024).
export const revokeInviteSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  workspaceMemberId: z.string().uuid("Invalid invite."),
});

export type RevokeInviteInput = z.infer<typeof revokeInviteSchema>;

// Validates change-member-role input (AS-014/AS-015/AS-019). `newRole` is
// deliberately restricted to "member" | "admin" — "owner" is never an
// accepted value here: this action changes an *existing* member's role,
// and granting ownership isn't supported through it (a workspace must
// always have exactly the ownership it already has resolved elsewhere;
// see AS-018's sole-owner protection, which a generic "promote to owner"
// path would need to coordinate with and which is out of this feature's
// scope).
export const changeMemberRoleSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
  targetMembershipId: z.string().uuid("Invalid member."),
  newRole: z.enum(["member", "admin"], {
    message: "Role must be member or admin.",
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
