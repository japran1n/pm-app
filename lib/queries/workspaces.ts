// Shared "default workspace" lookup (AS-005 / AS-003 adjacent).
//
// Both the auth callback route (app/(auth)/auth/callback/route.ts) and the
// onboarding page (app/(workspace)/onboarding/page.tsx) need to answer the
// same question: does this signed-in user already have an active workspace
// membership, and if so, which workspace should they land on? Extracted
// here so the "pick the most-recently-created active membership" rule is
// defined in exactly one place instead of drifting between the two
// call sites.
//
// Takes the caller's RLS-respecting client (not the admin client) — this
// is a read of the current user's own membership/workspace rows, which RLS
// already permits, so there's no reason to bypass it here.

import type { SupabaseClient } from "@supabase/supabase-js";

export async function getDefaultWorkspaceSlug(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | undefined> {
  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id, created_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    console.error(
      "getDefaultWorkspaceSlug: failed to look up workspace memberships:",
      membershipError,
    );
  }

  if (!membership) {
    return undefined;
  }

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("slug")
    .eq("id", membership.workspace_id)
    .maybeSingle();

  if (workspaceError) {
    console.error(
      "getDefaultWorkspaceSlug: failed to look up workspace slug:",
      workspaceError,
    );
  }

  return workspace?.slug ?? undefined;
}
