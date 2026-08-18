-- F121: avatar Storage bucket + RLS (AS-203, AS-205, AS-206)
--
-- Depends on F120 (supabase/migrations/20260818200946_create_profiles.sql):
-- profiles.avatar_url already exists as a nullable text column; this
-- migration only adds the Storage bucket + storage.objects policies that
-- let a Server Action (lib/actions/profile.ts) write into it and every
-- reader (task cards, headers, etc.) display it directly.
--
-- Public bucket vs private+signed URLs (this feature's one open decision,
-- resolved here per the clarification's "simpler option, no second source
-- of truth" default — full reasoning in this mission's F121 handoff):
--
--   Attachments (F064) use a PRIVATE bucket + short-lived signed URLs
--   because attachment access must be re-derived from live task/workspace
--   membership on every read (a member removed from a workspace must lose
--   access to files they previously could see). Avatars have no such
--   revocation requirement — a profile picture is not sensitive, workspace-
--   scoped data, it is closer to a public identicon. Card/list views need to
--   render dozens of avatars at once; minting + refreshing a signed URL per
--   avatar per render (attachments' pattern) would mean a Storage round
--   trip for every single avatar on a board, every time it's redrawn, once
--   the 1-hour TTL is up. A PUBLIC bucket with an unguessable object path
--   (`{user_id}/avatar`, a real UUID) lets every reader use
--   `profiles.avatar_url` — a plain, stable string already fetched with the
--   rest of the profile row — directly as an <img src>, with zero extra
--   Storage calls and no expiry to manage. This is the "simpler option,
--   no new dependency, no second source of truth" the clarification asks
--   for when a Notes-for-clarification question is resolved autonomously.
--
-- Path convention (binding for lib/actions/profile.ts): objects live at
--   {user_id}/avatar
-- with NO file extension in the object name. The MIME type is stored as
-- Storage object metadata (contentType), not inferred from the path, so
-- replacing a .jpg avatar with a .png one still resolves to the exact same
-- object path. Every upload uses upsert=true against this fixed path, so a
-- new avatar always overwrites the previous object in place — there is
-- only ever at most one Storage object per user in this bucket, which is
-- what makes "no orphaned objects accumulate on replace" true by
-- construction rather than by a cleanup step.
--
-- Size/MIME limits: declared once in lib/validation/profile.ts
-- (MAX_AVATAR_SIZE_BYTES, ALLOWED_AVATAR_MIME_TYPES) and enforced there for
-- both the client input and the Server Action's server-side check. The
-- literal values below mirror that file at the Storage-bucket level (an
-- enforcement layer, not a second source of truth — same relationship as a
-- DB CHECK mirroring a Zod schema elsewhere in this codebase). If those
-- constants change, this bucket config must be updated to match in the
-- same migration that changes them.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152, -- 2MB, matches MAX_AVATAR_SIZE_BYTES in lib/validation/profile.ts
  array['image/jpeg', 'image/png', 'image/webp'] -- matches ALLOWED_AVATAR_MIME_TYPES
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------
-- storage.objects RLS for the avatars bucket
-- ---------------------------------------------------------------------
--
-- lib/actions/profile.ts performs the actual upload through the admin
-- (secret-key) client, which bypasses RLS — same pattern as
-- lib/actions/attachments.ts. These policies are defense in depth against
-- any direct client-side Storage call using the publishable key, mirroring
-- why F064 added equivalent policies for task-attachments even though its
-- own Server Action also uses the admin client.
--
-- "Own-file write" (per the Draft scope): a user may only insert/update an
-- object whose path's first segment is their own auth.uid(). No join
-- through workspace_members is needed here (unlike attachments) because
-- avatar ownership isn't workspace-scoped — it's a 1:1 relationship with
-- the uploading user, encoded directly in the path.

create policy avatars_objects_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (nullif(split_part(storage.objects.name, '/', 1), ''))::uuid = auth.uid()
  );

-- UPDATE policy is required alongside INSERT because upload(..., { upsert:
-- true }) against an existing path performs an UPDATE under the hood, not
-- a second INSERT. Without this policy, re-uploading a new avatar to
-- replace an existing one would be denied even though the initial upload
-- succeeded.
create policy avatars_objects_update_own
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (nullif(split_part(storage.objects.name, '/', 1), ''))::uuid = auth.uid()
  )
  with check (
    bucket_id = 'avatars'
    and (nullif(split_part(storage.objects.name, '/', 1), ''))::uuid = auth.uid()
  );

-- SELECT: the bucket is public, so Supabase Storage already serves any
-- object in it from the unauthenticated /storage/v1/object/public/...
-- endpoint regardless of storage.objects RLS. This policy exists anyway so
-- that authenticated/anon queries that go through the regular Storage
-- object API (not the public-URL endpoint) — e.g. .list() in a future
-- admin tool — behave consistently with "public bucket" rather than
-- silently returning zero rows.
create policy avatars_objects_select_public
  on storage.objects
  for select
  to authenticated, anon
  using (bucket_id = 'avatars');

-- No DELETE policy: replacement is handled entirely by the fixed-path
-- upsert above (AS-203's "no orphaned objects" requirement is satisfied by
-- there only ever being one object per user, not by a delete step).
-- Absence of a DELETE policy denies deletes by default under RLS, which is
-- the safe baseline until a feature actually needs one (e.g. account
-- deletion cleanup, out of scope here).
