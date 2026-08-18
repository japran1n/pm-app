// F122 (AS-214): shared batched person-summary resolver, extracted so
// `lib/queries/assignee-names.ts` (task assignees) and `lib/queries/
// members.ts` (workspace member list) don't each carry their own
// near-identical Auth Admin API loop, now that F120's `profiles` table
// (display_name/avatar_url) exists to resolve most of this from a single
// query instead.
//
// Performance (this feature's explicit "no N+1 queries per row, no
// per-item network call" budget): resolves `profiles.display_name`/
// `avatar_url` for every requested id with ONE batched `.in("id", ids)`
// query, not one query per id. The Auth Admin API (`getUserById`) is only
// called — still once per id, same cost as the pre-F122 code — as a
// fallback for ids that have no `display_name` yet (F120's profile row is
// created with a null display_name until AS-202's "set display name"
// action lands; email itself is never stored in `profiles`, only in
// `auth.users`, so email always needs this fallback path). Once a user
// sets a display name, their row never needs the Admin API fallback again.
//
// Uses the admin client throughout (like the code it replaces) — this is
// a read of data already permitted to the caller by the RLS-scoped
// queries that produced these ids in the first place (task assignees
// scoped by `tasks_select_active_members`, workspace members scoped by
// `workspace_members_select_fellow_members`); the admin client here is
// resolving a *display value* for already-permitted rows, not widening
// which rows are visible, mirroring the same justification
// `getWorkspaceMembers`'s own pre-existing doc comment gives.

import { createAdminClient } from "@/lib/supabase/admin";

export type PersonSummary = {
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};

export async function resolvePeople(
  ids: string[],
): Promise<Map<string, PersonSummary>> {
  const summaries = new Map<string, PersonSummary>();
  if (ids.length === 0) return summaries;

  const admin = createAdminClient();

  const { data: profileRows, error: profileError } = await admin
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", ids);

  if (profileError) {
    console.error("resolvePeople: profiles fetch failed:", profileError);
  }

  const profileById = new Map(
    (profileRows ?? []).map((row) => [row.id, row]),
  );

  await Promise.all(
    ids.map(async (id) => {
      const profileRow = profileById.get(id);
      let email: string | null = null;
      let metadataName: string | null = null;

      if (!profileRow?.display_name) {
        try {
          const { data, error } = await admin.auth.admin.getUserById(id);
          if (error) {
            console.error("resolvePeople: getUserById failed for", id, error);
          } else if (data?.user) {
            email = data.user.email ?? null;
            metadataName =
              (data.user.user_metadata?.full_name as string | undefined) ??
              null;
          }
        } catch (lookupError) {
          console.error("resolvePeople: getUserById threw for", id, lookupError);
        }
      }

      summaries.set(id, {
        name: profileRow?.display_name ?? metadataName ?? null,
        email,
        avatarUrl: profileRow?.avatar_url ?? null,
      });
    }),
  );

  return summaries;
}
