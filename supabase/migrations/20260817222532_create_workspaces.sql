-- F011: workspaces + workspace_members schema (no RLS yet — RLS is F012)

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id),
  user_id uuid references auth.users (id),
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  status text not null default 'invited' check (status in ('invited', 'active')),
  invited_email text,
  created_at timestamptz not null default now()
);

-- user_id is nullable to support invited-but-not-yet-signed-up members (no auth.users
-- row exists yet for them, so it can't be FK'd). The spec's original wording made
-- user_id "not null", but that's incompatible with invited_email rows preceding
-- signup — so user_id is nullable here and invited_email carries the invite target
-- until the invitee signs up and a worker (F012/F013-adjacent invite-accept flow)
-- backfills user_id and flips status to 'active'.

-- Enforce "a member can't have two rows for the same workspace" only once user_id is
-- known (a NULL user_id, e.g. two pending invites with different emails, never
-- collides with this constraint, since standard SQL unique indexes treat NULLs as
-- distinct — no partial-index trick is even required here, but we scope it via
-- WHERE for clarity and to match the "not null" intent explicitly).
create unique index if not exists workspace_members_workspace_user_unique
  on workspace_members (workspace_id, user_id)
  where user_id is not null;

-- Prevent duplicate pending invites to the same email within a workspace.
create unique index if not exists workspace_members_workspace_invited_email_unique
  on workspace_members (workspace_id, invited_email)
  where invited_email is not null;

-- Index strategy: every FK/lookup column this table's RLS policy (F012) will join
-- through, per the migration-type clarification's Index strategy answer.
create index if not exists workspace_members_workspace_id_idx on workspace_members (workspace_id);
create index if not exists workspace_members_user_id_idx on workspace_members (user_id);
create index if not exists workspaces_slug_idx on workspaces (slug);
