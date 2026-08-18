-- F024: projects schema (no RLS yet — RLS is F025)

-- Generic updated_at trigger function, established here for reuse by future
-- tables (per F024's clarified spec: "if a shared trigger function already
-- exists for updated_at, reuse it; if not, this is a good place to establish
-- one"). No prior migration created updated_at columns, so this is the first.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id),
  name text not null,
  description text,
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  deleted_at timestamptz,
  constraint projects_end_date_after_start_date check (
    end_date is null or start_date is null or end_date >= start_date
  )
);

-- created_by is nullable in case the creating user is later deleted from
-- auth.users (FK would otherwise block that deletion or force a cascade that
-- loses attribution); typically set at insert time by the Server Action (F026).

-- AS-035 (F026 will also validate this in the Server Action) — enforced here
-- at the schema level so it can never be bypassed by a direct write.

-- Index strategy: index any FK/lookup column this table's RLS policy (F025)
-- will join through, per the migration-type clarification's Index strategy answer.
create index if not exists projects_workspace_id_idx on projects (workspace_id);

drop trigger if exists projects_set_updated_at on projects;
create trigger projects_set_updated_at
  before update on projects
  for each row
  execute function set_updated_at();
