// Data-fetching for the members list page (F017, AS-023).
//
// workspace_members rows are readable via the normal RLS-respecting client
// (workspace_members_select_fellow_members already scopes this to fellow
// active members of the same workspace — see
// supabase/migrations/20260817222822_rls_workspaces.sql), so that's what's
// used for the row data itself.
//
// Email/name/avatar for active members: F120 added `public.profiles`
// (display_name/avatar_url), so this no longer depends on the Auth Admin
// API alone. F122 (AS-214) switched this to `resolvePeople`
// (lib/queries/people.ts), which resolves every active member's
// display_name/avatar_url with ONE batched query, falling back to the
// Auth Admin API's email/user_metadata.full_name (this file's original
// approach, kept for exactly this fallback — see `resolvePeople`'s own
// doc comment) only for members who haven't set a display name yet. This
// is read-only, server-only (never reaches the browser, AS-140), and
// scoped to exactly the user ids already returned by the RLS-scoped
// membership query above — the admin client is not used to widen which
// *rows* are visible, only to resolve a display value for rows already
// permitted.

import { createClient } from "@/lib/supabase/server";
import { resolvePeople } from "@/lib/queries/people";

export type ActiveMember = {
  id: string;
  userId: string;
  role: "owner" | "admin" | "member";
  email: string | null;
  name: string | null;
  /** F122 (AS-214): the member's uploaded avatar, or null for the
   * initials-avatar fallback — sourced from `profiles.avatar_url`. */
  avatarUrl: string | null;
};

export type PendingInvite = {
  id: string;
  invitedEmail: string;
  role: "owner" | "admin" | "member";
};

export type WorkspaceMembers = {
  active: ActiveMember[];
  pending: PendingInvite[];
};

export async function getWorkspaceMembers(
  workspaceId: string,
): Promise<WorkspaceMembers> {
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("workspace_members")
    .select("id, user_id, role, status, invited_email, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("getWorkspaceMembers: fetch failed:", error);
    throw error;
  }

  const activeRows = (rows ?? []).filter(
    (r) => r.status === "active" && r.user_id,
  );
  const pendingRows = (rows ?? []).filter((r) => r.status === "invited");

  const activeUserIds = activeRows.map((row) => row.user_id as string);
  const people = await resolvePeople(activeUserIds);

  const active: ActiveMember[] = activeRows.map((row) => {
    const userId = row.user_id as string;
    const person = people.get(userId);
    return {
      id: row.id,
      userId,
      role: row.role as "owner" | "admin" | "member",
      email: person?.email ?? null,
      name: person?.name ?? null,
      avatarUrl: person?.avatarUrl ?? null,
    };
  });

  const pending: PendingInvite[] = pendingRows.map((row) => ({
    id: row.id,
    invitedEmail: row.invited_email ?? "(unknown)",
    role: row.role as "owner" | "admin" | "member",
  }));

  return { active, pending };
}
