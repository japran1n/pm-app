-- F120: profiles table + RLS (AS-201, AS-208, AS-209, AS-210)
--
-- profiles is the identity primitive this whole mission builds on (avatars,
-- mentions, notifications, timezone-aware date math). One row per
-- auth.users row, created automatically — never by client-side INSERT.
--
-- Columns beyond `id`/`timezone` (display_name, avatar_url, color) are
-- nullable here on purpose: this feature only owns the schema, the
-- auto-create trigger, and RLS (AS-201, AS-208, AS-209, AS-210). Populating
-- display_name/avatar_url/color is out of scope — later features (F121
-- avatar-storage-bucket, F122 avatar-component, and whichever feature adds
-- the "set display name" Server Action for AS-202) write to those columns
-- through their own Zod-validated Server Actions, per tech-decisions.md's
-- "DB is the last line, not the only line" validation convention. There is
-- no Server Action in this feature to mirror a Zod schema against, since
-- clients never INSERT/UPDATE display_name etc. here.

create table if not exists profiles (
  id uuid primary key references auth.users (id),
  display_name text,
  avatar_url text,
  color text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Reuses set_updated_at(), established in 20260818004413_create_projects.sql.
drop trigger if exists profiles_set_updated_at on profiles;
create trigger profiles_set_updated_at
  before update on profiles
  for each row
  execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- AS-201: a profile row is created automatically on first sign-in, without
-- any manual step. Supabase's standard pattern for this is a trigger on
-- auth.users — the same table Supabase itself owns — firing a SECURITY
-- DEFINER function so it can write into public.profiles regardless of who
-- (Supabase Auth's internal role) performed the auth.users insert.
--
-- `on conflict (id) do nothing` makes this safe to fire even if a profile
-- row already exists for that id (defensive; auth.users.id is unique so in
-- practice this never fires twice for the same user, but it keeps the
-- trigger idempotent rather than erroring the signup transaction).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, timezone)
  values (new.id, 'UTC')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- Backfill: any user that signed up before this migration ran gets a
-- profile row too (AS-201 must hold for existing users, not only future
-- signups). Safe to re-run — `on conflict` no-ops for rows already backfilled.
insert into public.profiles (id, timezone)
select id, 'UTC' from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Shared-workspace visibility predicate (AS-209, AS-210).
--
-- Per this feature's spec note: "The shared-workspace visibility predicate
-- is reused by mentions (F203) and members lists — put it in a SQL helper
-- function, not copy-pasted into each policy." This is that helper.
--
-- SECURITY DEFINER + fixed search_path, mirroring F012's
-- public.is_active_workspace_member: it needs to read workspace_members for
-- BOTH the caller and the target user, and workspace_members' own RLS
-- (F012) only lets a caller see membership rows for workspaces they're
-- already in — a plain `stable` function running as the caller would only
-- ever see its own side of the join. SECURITY DEFINER bypasses that so the
-- self-join can actually compare both sides.
--
-- Deliberately does NOT special-case target_user_id = auth.uid() (a user
-- always being able to see their own profile) — that's handled by the
-- separate `id = auth.uid()` clause in profiles_select_self_or_shared
-- below, keeping this predicate a pure "do these two users share an active
-- workspace" check that future features (F203 mentions, members lists) can
-- reuse as-is without inheriting a self-select special case they may not
-- want.
-- ---------------------------------------------------------------------------
create or replace function public.shares_workspace_with(target_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from workspace_members caller_membership
    join workspace_members target_membership
      on target_membership.workspace_id = caller_membership.workspace_id
    where caller_membership.user_id = auth.uid()
      and caller_membership.status = 'active'
      and target_membership.user_id = target_user_id
      and target_membership.status = 'active'
  );
$$;

revoke all on function public.shares_workspace_with(uuid) from public;
grant execute on function public.shares_workspace_with(uuid) to authenticated, anon;

alter table profiles enable row level security;

-- No FORCE ROW LEVEL SECURITY: same rationale as F012/F025/F034/F058 — the
-- app never connects as the table owner for reads; privileged server-side
-- access (including the on_auth_user_created trigger above, which runs
-- SECURITY DEFINER) bypasses RLS by design.

-- SELECT: a user can always read their own profile, and can read another
-- user's profile only if they share at least one active workspace
-- (AS-209, AS-210).
create policy profiles_select_self_or_shared_workspace
  on profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or public.shares_workspace_with(id)
  );

-- UPDATE: only the profile's own owner may update it, and `with check`
-- re-validates the same predicate against the resulting row so a caller
-- cannot use an UPDATE to reassign a profile's id to someone else's
-- (AS-208 — no path, including a direct API call, lets a user edit another
-- user's profile).
create policy profiles_update_self
  on profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No INSERT/DELETE policy for profiles: rows are created exclusively by the
-- on_auth_user_created trigger (SECURITY DEFINER, bypasses RLS) and are
-- never hard-deleted by this feature. Absence of INSERT/DELETE policies
-- denies both by default under RLS for authenticated and anon roles, which
-- is the safe baseline — a client-side INSERT (even of their own id) or
-- DELETE is rejected, matching "no client-side INSERT/DELETE" from the
-- Draft scope.

-- No policy is created for anon: absence of a matching policy means anon
-- reads return zero rows rather than an error (AS-210's same "filtered, not
-- errored" shape as every other RLS-gated table in this schema).
