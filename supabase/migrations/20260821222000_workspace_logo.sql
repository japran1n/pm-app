-- F138: workspace logo upload (AS-243)
--
-- Additive migration: adds a nullable `logo_url` column to `workspaces`
-- (no backfill needed — every existing workspace simply has no logo yet,
-- which is a valid, already-handled state: the switcher/sidebar fall back
-- to an initials avatar, same as UserAvatar does for a user with no
-- avatar_url) and RLS policies letting an owner/admin write into a
-- `workspace-logos/` prefix of the EXISTING `avatars` bucket (F121,
-- supabase/migrations/20260818201642_create_avatars_bucket.sql).
--
-- Bucket choice (this feature's one open "Notes for clarification"
-- decision, resolved per the clarified spec's "simpler option, no new
-- dependency, no second source of truth" default): reuse the `avatars`
-- bucket with a distinct path prefix, rather than provisioning a second
-- public bucket. A second bucket would need its own bucket-level
-- size/MIME config (currently declared once, in the F121 migration) and
-- its own baseline RLS policies duplicated from the ones below, for zero
-- functional benefit — object paths already namespace avatars vs. logos
-- unambiguously (`{user_id}/avatar` vs. `workspace-logos/{workspace_id}/
-- logo`), and both kinds of image share the exact same size/MIME rules
-- (lib/validation/profile.ts's MAX_AVATAR_SIZE_BYTES /
-- ALLOWED_AVATAR_MIME_TYPES, reused as-is by the upload action rather than
-- a second copy of those constants). Documented here per the clarified
-- spec's "pick one and document it" instruction; also recorded in this
-- feature's handoff.

alter table public.workspaces
  add column if not exists logo_url text;

comment on column public.workspaces.logo_url is
  'Public Storage URL of the workspace logo (avatars bucket, workspace-logos/{workspace_id}/logo path), or null when the workspace has no logo and the switcher/sidebar fall back to an initials avatar. Set by lib/actions/workspaces.ts uploadWorkspaceLogo (F138, AS-243).';

-- ---------------------------------------------------------------------
-- storage.objects RLS for the `workspace-logos/` prefix of the `avatars`
-- bucket
-- ---------------------------------------------------------------------
--
-- lib/actions/workspaces.ts's uploadWorkspaceLogo performs the actual
-- upload through the admin (secret-key) client, which bypasses RLS — same
-- pattern as lib/actions/profile.ts's uploadAvatar. These policies are
-- defense in depth against any direct client-side Storage call using the
-- publishable key.
--
-- Path convention: `workspace-logos/{workspace_id}/logo`, no file
-- extension (mirrors the avatars bucket's own `{user_id}/avatar`
-- convention — MIME type lives in Storage object metadata, not the path).
-- A caller may only insert/update an object under this prefix when the
-- second path segment is a workspace they are an active owner or admin
-- member of — mirrors requireWorkspaceAdmin's server-side check in
-- lib/actions/workspaces.ts (defense in depth, since the admin client
-- already bypasses this).
create policy workspace_logos_objects_insert_admin
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and split_part(storage.objects.name, '/', 1) = 'workspace-logos'
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = (nullif(split_part(storage.objects.name, '/', 2), ''))::uuid
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role in ('owner', 'admin')
    )
  );

-- UPDATE policy is required alongside INSERT for the same reason the
-- avatars bucket has one: upload(..., { upsert: true }) against an
-- existing path performs an UPDATE under the hood, not a second INSERT.
create policy workspace_logos_objects_update_admin
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and split_part(storage.objects.name, '/', 1) = 'workspace-logos'
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = (nullif(split_part(storage.objects.name, '/', 2), ''))::uuid
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role in ('owner', 'admin')
    )
  )
  with check (
    bucket_id = 'avatars'
    and split_part(storage.objects.name, '/', 1) = 'workspace-logos'
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = (nullif(split_part(storage.objects.name, '/', 2), ''))::uuid
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role in ('owner', 'admin')
    )
  );

-- SELECT: the bucket is already public (F121) — the
-- `avatars_objects_select_public` policy from that migration already
-- covers every object in the bucket regardless of prefix, so no
-- additional SELECT policy is needed here.

-- No DELETE policy, matching the avatars bucket's own convention: logo
-- replacement is handled entirely by the fixed-path upsert above, so
-- there is only ever at most one Storage object per workspace in this
-- prefix — no orphan-cleanup delete step is required.
