import { logger } from "@/lib/observability/logger";

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
//
// F123 (AS-202): the "name" this function returns is the single fallback
// chain every caller renders — `personLabel` (components/user-avatar.tsx)
// and `resolveAssigneeNames` (lib/queries/assignee-names.ts) both just do
// `person.name ?? person.email`/`person.name || person.email`, so the
// chain has to live here, not be re-implemented at each call site (that
// would be exactly the "second name-resolution path" this feature is
// told not to build). The chain is: `profiles.display_name` (AS-202's
// "a user can set their display name") -> `user_metadata.full_name`
// (pre-existing F122 fallback for an OAuth-supplied name; nothing in this
// codebase's own sign-up flow sets it today, but a future OAuth provider
// might) -> the local part of the email (everything before "@") -> the
// full email as a last resort (only reachable if the local part somehow
// comes out empty, e.g. an address starting with "@"). Inserting the
// local-part step is this feature's fix: before it, a user who hadn't
// set a display name yet was rendered by their full email address
// app-wide, which reads as "the email wasn't actually replaced by
// anything nicer" even though AS-202 only requires the *set* case to
// replace the email. `email` itself is still returned unchanged (full
// address) for callers that want it verbatim (e.g. a mailto link).

import { createAdminClient } from "@/lib/supabase/admin";

export type PersonSummary = {
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};

/**
 * The part of an email address before "@", e.g. "j.smith" from
 * "j.smith@example.com". Falls back to the full address if it has no "@"
 * or the local part is empty (defensive — every real email has both).
 */
export function emailLocalPart(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) return email;
  return email.slice(0, atIndex);
}

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
    logger.error("resolvePeople: profiles fetch failed", { error: profileError });
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
            logger.error("resolvePeople: getUserById failed for", { userId: id, error });
          } else if (data?.user) {
            email = data.user.email ?? null;
            metadataName =
              (data.user.user_metadata?.full_name as string | undefined) ??
              null;
          }
        } catch (lookupError) {
          logger.error("resolvePeople: getUserById threw for", { userId: id, error: lookupError });
        }
      }

      summaries.set(id, {
        name:
          profileRow?.display_name ??
          metadataName ??
          (email ? emailLocalPart(email) : null),
        email,
        avatarUrl: profileRow?.avatar_url ?? null,
      });
    }),
  );

  return summaries;
}
