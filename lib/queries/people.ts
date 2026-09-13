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

import { cache } from "react";
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
  if (ids.length === 0) return new Map();

  // F008b (perf): `cache()` from React memoizes by argument identity, and
  // arrays are compared by reference -- two calls with equal-but-distinct
  // arrays (e.g. `resolvePeople([a, b])` called from four different call
  // sites within the same request) would each be treated as a cache miss.
  // Sorting the ids and joining them into a stable string gives `cache()`
  // a primitive key so identical id sets (regardless of input order or
  // array identity) collapse into a single `get_users_by_ids` round-trip
  // per request.
  const sortedIds = [...ids].sort();
  return resolvePeopleCached(sortedIds.join(","), sortedIds);
}

const resolvePeopleCached = cache(async function resolvePeopleInner(
  _sortedKey: string,
  ids: string[],
): Promise<Map<string, PersonSummary>> {
  const summaries = new Map<string, PersonSummary>();

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

  // F087 (perf audit item 7): the GoTrue Admin API has no bulk "get
  // users by ids" endpoint (`auth.admin.listUsers()` only supports
  // page/perPage, not an id filter), so ids missing a `display_name`
  // used to fall back to one `auth.admin.getUserById` HTTP call EACH,
  // inside a `Promise.all` -- N admin API round-trips for N un-named
  // users. `get_users_by_ids` (20261027020000_f087_batch_get_users_by_ids
  // .sql) is a single SECURITY DEFINER RPC that reads `auth.users`
  // directly for the whole id list in one round-trip; only the ids that
  // still need it (no `display_name` yet) are sent, keyed into a map
  // before the loop below reads it, same "batched lookup" shape the
  // `profiles` query above already uses.
  const idsNeedingAuthLookup = ids.filter(
    (id) => !profileById.get(id)?.display_name,
  );

  const authUserById = new Map<
    string,
    { email: string | null; metadataName: string | null }
  >();

  if (idsNeedingAuthLookup.length > 0) {
    const { data: authRows, error: authError } = await admin.rpc(
      "get_users_by_ids",
      { p_ids: idsNeedingAuthLookup },
    );

    if (authError) {
      logger.error("resolvePeople: get_users_by_ids failed", { error: authError });
    } else {
      for (const row of authRows ?? []) {
        authUserById.set(row.id, {
          email: row.email ?? null,
          metadataName:
            ((row.raw_user_meta_data as Record<string, unknown> | null)
              ?.full_name as string | undefined) ?? null,
        });
      }
    }
  }

  for (const id of ids) {
    const profileRow = profileById.get(id);
    const authUser = authUserById.get(id);
    const email = authUser?.email ?? null;
    const metadataName = authUser?.metadataName ?? null;

    summaries.set(id, {
      name:
        profileRow?.display_name ??
        metadataName ??
        (email ? emailLocalPart(email) : null),
      email,
      avatarUrl: profileRow?.avatar_url ?? null,
    });
  }

  return summaries;
});
