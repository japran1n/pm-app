import { logger } from "@/lib/observability/logger";
import { getRequestClient } from "@/lib/auth/current-user";

// The caller's role in this workspace, used by the portal layout to decide
// whether this person belongs here at all. Reads through RLS: after
// 20260902020000 a client can see only their own `workspace_members` row,
// which is precisely the row this needs.
export async function getWorkspaceRoleForCurrentUser(
  workspaceId: string,
  userId: string,
): Promise<string | null> {
  const supabase = await getRequestClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    logger.error("getWorkspaceRoleForCurrentUser failed", { error: error });
    return null;
  }
  return data?.role ?? null;
}

// The signed-in client's own display name/avatar, for the portal
// sidebar's footer identity row (F003, missions/20260903-portal). Reads
// through the ordinary RLS-respecting client (`profiles_select_self_or_
// shared_workspace`, 20260902020000) allows `id = auth.uid()`
// unconditionally, so a client can always read their own row even though
// they cannot read the team's.
export async function getPortalCurrentUserProfile(
  userId: string,
): Promise<{ displayName: string | null; avatarUrl: string | null } | null> {
  const supabase = await getRequestClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name, avatar_url")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    logger.error("getPortalCurrentUserProfile failed", { error });
    return null;
  }
  if (!data) return null;
  return { displayName: data.display_name, avatarUrl: data.avatar_url };
}
