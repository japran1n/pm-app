// Shared server-side membership/role re-check helper (AS-143 convention:
// every Server Action that touches workspace-scoped data re-verifies the
// caller's membership/role itself, even though RLS is the actual
// enforcement boundary — this is defense in depth, not the only line).
//
// Takes the admin client (bypasses RLS) so the check itself can never be
// silently defeated by a missing/incomplete RLS policy on workspace_members
// — it must independently answer "is this real caller really an
// owner/admin of this real workspace" without relying on the same
// enforcement layer it exists to back up.

import type { createAdminClient } from "@/lib/supabase/admin";
import type { WorkspaceRole } from "@/lib/auth/permissions";

// F128: widened from the original "owner" | "admin" | "member" to the full
// `WorkspaceRole` (adds "viewer" | "guest", F126) — this check only proves
// *active membership*, not write access. Callers that need to gate a
// mutation must separately re-check the returned `role` against
// lib/auth/permissions.ts's predicates (e.g. `canWrite`); this function
// deliberately does not filter role itself so read-only actions (viewers
// listing tasks, etc.) can keep using it unchanged.
export type MembershipCheckResult =
  | { ok: true; role: WorkspaceRole }
  | { ok: false };

// Active membership of any role.
export async function requireActiveMembership(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  userId: string,
): Promise<MembershipCheckResult> {
  const { data, error } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) {
    return { ok: false };
  }

  return { ok: true, role: data.role as WorkspaceRole };
}

// Active membership restricted to owner/admin roles.
export async function requireWorkspaceAdmin(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  userId: string,
): Promise<MembershipCheckResult> {
  const result = await requireActiveMembership(admin, workspaceId, userId);
  if (!result.ok) return result;
  if (result.role !== "owner" && result.role !== "admin") {
    return { ok: false };
  }
  return result;
}

// Active membership restricted to the owner role only. Used by actions
// that AS-014/AS-015/AS-019 say only the owner may perform (e.g. changing
// another member's role) — deliberately stricter than
// `requireWorkspaceAdmin`, since "admin" is explicitly not enough here
// (AS-019: an admin can invite/remove members but is not granted every
// owner-only capability).
export async function requireWorkspaceOwner(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  userId: string,
): Promise<MembershipCheckResult> {
  const result = await requireActiveMembership(admin, workspaceId, userId);
  if (!result.ok) return result;
  if (result.role !== "owner") {
    return { ok: false };
  }
  return result;
}
