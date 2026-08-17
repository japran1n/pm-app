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

export type MembershipCheckResult =
  | { ok: true; role: "owner" | "admin" | "member" }
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

  return { ok: true, role: data.role as "owner" | "admin" | "member" };
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
