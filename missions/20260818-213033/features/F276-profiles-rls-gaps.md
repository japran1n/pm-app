# F276: close the profiles RLS gaps

**Milestone:** M10 (follow-up from M10 scrutiny)
**Estimated worker time:** 45 minutes
**Depends on:** F120, F121
**Parent feature:** F120 (inherits its clarification)

## Assertion IDs covered
- AS-210: a user with no shared workspace cannot read another user's profile
- AS-208 (hardening): a user cannot edit another user's profile

## Why this exists
M10 scrutiny FAIL, verified independently: `shares_workspace_with()` contains no reference to `workspaces.deleted_at`, and `deleteWorkspace` leaves `workspace_members` rows `active`. Two users whose only shared workspace was deleted keep permanent, unrevocable read access to each other's profile. See `missions/20260818-213033/milestones/M10-scrutiny.md` § AS-210.

## Draft scope
- Join `workspaces` in `shares_workspace_with()` and require `deleted_at is null`.
- Sweep the four SECURITY DEFINER helpers (`shares_workspace_with`, `is_active_workspace_member`, `is_workspace_admin`, `remove_workspace_member`) to `set search_path = ''` with `public.`-qualified references.
- Add `on delete cascade` to `profiles.id`'s FK; add an exception handler to `handle_new_user()` so a future constraint cannot break sign-up.
- Constrain self-writes: bound `display_name` length and restrict `avatar_url` to the project's avatars-bucket prefix (or narrow the UPDATE grant to `timezone` and route name/avatar writes through the Server Actions).
- Drop the pointless `anon` grant on `shares_workspace_with` and the `avatars_objects_select_public` policy that enables anonymous user-id enumeration.

## Files (approximate)
supabase/migrations/ (new), tests/integration/rls-profiles.test.ts

## Clarified implementation
- Inherits F120's clarification (archetype: db). Additive migration; helper stays the single source of the visibility predicate.

## Definition of done
- Test: soft-delete the shared workspace, assert the profile read drops to zero rows.
- Test: remove the member, assert the same.
- Test: `update({ id: otherUserId }).eq("id", myUserId)` is rejected (the WITH CHECK path, currently untested).
- Test: a cross-user Storage write with two real user JWTs is rejected.
- `npm run test`, `npx tsc --noEmit`, `npx eslint .` clean.
