// Data-fetching for the members list page (F017, AS-023).
//
// workspace_members rows are readable via the normal RLS-respecting client
// (workspace_members_select_fellow_members already scopes this to fellow
// active members of the same workspace — see
// supabase/migrations/20260817222822_rls_workspaces.sql), so that's what's
// used for the row data itself.
//
// Email/name for active members is a separate problem: there is no
// public.profiles/users table or view in this schema (checked — F011's
// migration only creates `workspaces` and `workspace_members`; auth.users
// is Supabase-managed and not exposed through the public PostgREST schema
// at all). The only way to resolve an auth user's email server-side is the
// Auth Admin API, which requires the secret-key admin client (same
// approach `inviteMember` in lib/actions/workspaces.ts already takes for
// its by-email duplicate-invite check). This is read-only, server-only
// (never reaches the browser, AS-140), and scoped to exactly the user ids
// already returned by the RLS-scoped membership query above — the admin
// client is not used to widen which *rows* are visible, only to resolve a
// display value for rows already permitted.
//
// Known limitation (documented per the feature spec's instruction to note
// any limitation rather than silently working around it): `getUserById` is
// called once per active member. For a workspace with very many members
// this is N Auth Admin API calls per page render; acceptable for this
// milestone's scale, but a future feature should introduce a
// public.profiles table (populated by a trigger on auth.users) if member
// lists grow large, both for performance and to avoid depending on the
// Auth Admin API for a read this common.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActiveMember = {
  id: string;
  userId: string;
  role: "owner" | "admin" | "member";
  email: string | null;
  name: string | null;
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

  const admin = createAdminClient();

  const active: ActiveMember[] = await Promise.all(
    activeRows.map(async (row) => {
      let email: string | null = null;
      let name: string | null = null;
      try {
        const { data, error: userError } = await admin.auth.admin.getUserById(
          row.user_id as string,
        );
        if (userError) {
          console.error(
            "getWorkspaceMembers: getUserById failed for",
            row.user_id,
            userError,
          );
        } else if (data?.user) {
          email = data.user.email ?? null;
          name = (data.user.user_metadata?.full_name as string) ?? null;
        }
      } catch (userLookupError) {
        console.error(
          "getWorkspaceMembers: getUserById threw for",
          row.user_id,
          userLookupError,
        );
      }
      return {
        id: row.id,
        userId: row.user_id as string,
        role: row.role as "owner" | "admin" | "member",
        email,
        name,
      };
    }),
  );

  const pending: PendingInvite[] = pendingRows.map((row) => ({
    id: row.id,
    invitedEmail: row.invited_email ?? "(unknown)",
    role: row.role as "owner" | "admin" | "member",
  }));

  return { active, pending };
}
