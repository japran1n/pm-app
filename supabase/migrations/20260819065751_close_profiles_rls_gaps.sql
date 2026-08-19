-- F276 (AS-210 major, AS-208 hardening): close the profiles RLS gaps found
-- by M10 scrutiny (missions/20260818-213033/milestones/M10-scrutiny.md,
-- "AS-210 -- soft-deleted workspace is a permanent profile-visibility
-- grant" + the AS-208 note under "Major findings on PASSing assertions" +
-- FU-4). Independently confirmed: `shares_workspace_with()`
-- (20260818200946_create_profiles.sql) never joins `workspaces` and never
-- checks `deleted_at`, and `deleteWorkspace` only soft-deletes the
-- `workspaces` row -- `workspace_members` rows stay `active` forever. Two
-- users whose only shared workspace was deleted keep permanent,
-- unrevocable read access to each other's profile. This migration is
-- purely additive (CREATE OR REPLACE / ALTER / new policies) -- no table
-- is dropped or recreated.

-- ---------------------------------------------------------------------------
-- 1) AS-210 fix: shares_workspace_with() must stop granting visibility once
-- the shared workspace is soft-deleted. Every other policy in this schema
-- (workspaces_select_active_members, projects, tasks, comments) pairs the
-- membership check with `deleted_at is null`; this helper was the one
-- place that didn't.
--
-- Bundled with the same sweep as (2) below: `set search_path = ''` with
-- every relation fully `public.`-qualified, rather than the previous
-- `set search_path = public`. `search_path = public` searches `pg_temp`
-- before `public` for unqualified relation names when `pg_temp` isn't
-- listed explicitly, so a session able to `CREATE TEMP TABLE
-- workspace_members(...)` could in principle shadow the unqualified
-- references this function used to have. Not reachable through PostgREST
-- today (no DDL surface), so this was latent, not exploited -- but the
-- migration comment that shipped with it overstated the guarantee. This
-- fixes it correctly: pg_catalog (auth.uid(), exists, etc.) is always
-- implicitly searched regardless of search_path, so only the schema-owned
-- relations need qualification.
-- ---------------------------------------------------------------------------
create or replace function public.shares_workspace_with(target_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.workspace_members caller_membership
    join public.workspace_members target_membership
      on target_membership.workspace_id = caller_membership.workspace_id
    join public.workspaces w
      on w.id = caller_membership.workspace_id
    where caller_membership.user_id = auth.uid()
      and caller_membership.status = 'active'
      and target_membership.user_id = target_user_id
      and target_membership.status = 'active'
      and w.deleted_at is null
  );
$$;

-- Minor finding from the same scrutiny section: `grant ... to anon` on this
-- function is pointless (auth.uid() is null for anon, so the function
-- always returns false for that role) and PostgREST exposes it as a
-- callable RPC, letting any authenticated user probe an arbitrary UUID for
-- co-membership with no anon caller ever needing it. `authenticated` keeps
-- its grant (profiles_select_self_or_shared_workspace depends on it);
-- `anon` loses it.
revoke execute on function public.shares_workspace_with(uuid) from anon;

-- ---------------------------------------------------------------------------
-- 2) search_path sweep, continued: the same `set search_path = public` ->
-- `set search_path = ''` + `public.`-qualified fix, applied to the three
-- other SECURITY DEFINER helpers the scrutiny report named as inheriting
-- the same pattern (20260817222822_rls_workspaces.sql,
-- 20260817234900_remove_member_atomic_owner_guard.sql). Grants are
-- untouched by CREATE OR REPLACE FUNCTION, so the existing
-- `authenticated, anon` / `authenticated, service_role` grants on these
-- three carry forward unchanged -- only shares_workspace_with's anon grant
-- was flagged as pointless above.
-- ---------------------------------------------------------------------------
create or replace function public.is_active_workspace_member(target_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
  );
$$;

create or replace function public.is_workspace_admin(target_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role in ('owner', 'admin')
  );
$$;

create or replace function public.remove_workspace_member(
  p_membership_id uuid,
  p_workspace_id uuid
)
returns table (
  deleted boolean,
  reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_status text;
  v_remaining_owners int;
begin
  select role, status
    into v_role, v_status
    from public.workspace_members
   where id = p_membership_id
     and workspace_id = p_workspace_id
   for update;

  if not found then
    return query select false, 'not_found';
    return;
  end if;

  if v_status <> 'active' then
    return query select false, 'not_active';
    return;
  end if;

  if v_role = 'owner' then
    perform 1
      from public.workspace_members
     where workspace_id = p_workspace_id
       and role = 'owner'
       and status = 'active'
       for update;

    select count(*)
      into v_remaining_owners
      from public.workspace_members
     where workspace_id = p_workspace_id
       and role = 'owner'
       and status = 'active';

    if v_remaining_owners <= 1 then
      return query select false, 'sole_owner';
      return;
    end if;
  end if;

  delete from public.workspace_members
   where id = p_membership_id
     and workspace_id = p_workspace_id
     and status = 'active';

  return query select true, null::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) profiles.id FK: add ON DELETE CASCADE.
--
-- Every user now has a profiles row (F120's on_auth_user_created trigger +
-- backfill). Without ON DELETE CASCADE, deleting an auth.users row always
-- fails with an FK violation unless the profiles row is deleted first --
-- the existing rls-profiles.test.ts afterAll already has to work around
-- this by manually deleting profiles before deleting the auth user. This
-- makes user deletion (admin.auth.admin.deleteUser, used by every test's
-- cleanup and any future account-deletion feature) work without that
-- workaround.
-- ---------------------------------------------------------------------------
alter table public.profiles
  drop constraint profiles_id_fkey,
  add constraint profiles_id_fkey
    foreign key (id) references auth.users (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 4) handle_new_user(): add an exception handler so a future constraint on
-- `profiles` cannot break sign-up.
--
-- `on conflict (id) do nothing` only covers the duplicate-key case, despite
-- the original migration's comment implying broader protection. Any other
-- future NOT NULL/CHECK/FK failure on the insert would currently abort the
-- whole `auth.users` insert transaction, turning every sign-up into
-- "Database error saving new user". Catching the exception here means the
-- trigger logs a warning and lets the auth.users insert commit regardless
-- -- sign-up must never depend on profile-row creation succeeding.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, timezone)
  values (new.id, 'UTC')
  on conflict (id) do nothing;
  return new;
exception
  when others then
    raise warning 'handle_new_user: failed to create profile for user %: %', new.id, sqlerrm;
    return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Constrain self-writes.
--
-- `profiles_update_self`'s RLS policy gates *rows* (only the caller's own
-- row is reachable), but RLS has no column granularity: as shipped, an
-- authenticated caller could PATCH display_name to arbitrary length or
-- avatar_url to any external URL via a direct PostgREST call, bypassing
-- uploadAvatarSchema/updateProfileSchema entirely -- an attacker-controlled
-- avatar_url renders in every co-worker's browser as a plain <img src>
-- (components/user-avatar.tsx), an IP/User-Agent beacon at minimum.
--
-- Chosen fix (the feature spec's second option): narrow the table-level
-- UPDATE grant for `authenticated` to the `timezone` column only, rather
-- than adding a CHECK constraint for display_name length + an avatar_url
-- bucket-prefix regex. Reasons:
--   - Both write paths that ever set display_name/avatar_url
--     (lib/actions/profile.ts's updateProfile/uploadAvatar) already use
--     createAdminClient() (service_role), which this GRANT change does not
--     touch at all -- service_role bypasses RLS and table-level grants by
--     design, the same pattern every other privileged write in this repo
--     uses. Nothing in the app's own write path changes behaviour.
--   - A CHECK-based approach would need to duplicate the avatars bucket's
--     public-URL shape (host + `/storage/v1/object/public/avatars/` +
--     `{user_id}/avatar` + a cache-busting query param) as a second source
--     of truth in a regex, which could drift from the Storage config
--     independently -- exactly the kind of duplication tech-decisions.md's
--     validation convention tries to avoid.
--   - Grant-narrowing is enforced by Postgres before RLS is even evaluated
--     (a column-privilege check at parse time), so it also fully closes
--     the AS-208 "WITH CHECK path is untested" gap for the `id` column
--     specifically: a caller can no longer even attempt to set `id` via a
--     direct PostgREST PATCH, regardless of what value; `profiles_update_
--     self`'s `with check (id = auth.uid())` stays in place as a second,
--     redundant layer.
--
-- Net effect: a direct authenticated-role PATCH can change only its own
-- `timezone`; every other column write must go through the Server Actions.
-- This changes real behaviour for one existing test
-- (tests/integration/rls-profiles.test.ts's "a user CAN update their own
-- profile" used to PATCH display_name directly) -- updated in the same
-- commit as this migration to reflect the new, intentionally narrower
-- surface, with a new test proving the direct-PATCH display_name path is
-- now rejected.
-- ---------------------------------------------------------------------------
revoke update on public.profiles from authenticated;
grant update (timezone) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 6) storage.objects: drop the anon-enumeration hole on the avatars bucket.
--
-- `avatars_objects_select_public` (20260818201642_create_avatars_bucket.sql)
-- granted SELECT on storage.objects for bucket 'avatars' to BOTH anon and
-- authenticated, so any anonymous caller could `.storage.from('avatars')
-- .list()` and enumerate every user id that has ever uploaded an avatar
-- (the object path's first segment is a real auth.users id).
--
-- Checked before dropping (per this feature's explicit instruction) how
-- avatars are actually rendered: `components/user-avatar.tsx` renders
-- `<AvatarImage src={person.avatarUrl} />`, a plain <img>, and
-- `person.avatarUrl` is `profiles.avatar_url` -- already the full public
-- URL returned by `admin.storage.from('avatars').getPublicUrl(...)`
-- (lib/actions/profile.ts). Because the `avatars` bucket itself is public
-- (`storage.buckets.public = true`,
-- 20260818201642_create_avatars_bucket.sql), Supabase Storage serves that
-- URL from the unauthenticated `/storage/v1/object/public/...` CDN
-- endpoint regardless of storage.objects RLS -- exactly what that
-- migration's own comment on this policy already said ("the bucket is
-- public, so Supabase Storage already serves any object in it from the
-- unauthenticated public endpoint regardless of storage.objects RLS. This
-- policy exists anyway so [.list()/other query-API calls] behave
-- consistently"). So dropping SELECT for `anon` cannot break avatar
-- rendering for anyone, signed in or not -- rendering never goes through
-- this policy in the first place.
--
-- `authenticated` SELECT is kept (narrowed from `anon, authenticated` to
-- `authenticated` only) so any in-app authenticated Storage-API usage
-- (`.list()`/`.download()` via the publishable-key client) keeps behaving
-- like a public bucket, per that same original comment's stated intent --
-- only the anonymous enumeration path is removed.
-- ---------------------------------------------------------------------------
drop policy if exists avatars_objects_select_public on storage.objects;

create policy avatars_objects_select_authenticated
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'avatars');
