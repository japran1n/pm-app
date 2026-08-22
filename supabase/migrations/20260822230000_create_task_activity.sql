-- F194: task_activity table + append-only RLS (AS-353, AS-357, AS-359).
--
-- A per-task, chronological activity trail: field changes, comment
-- additions/deletions, and (per F195/AS-360) system-generated changes
-- driven by the recurrence job. This mirrors audit_log's (F139) exact
-- append-only design, applied at task granularity instead of workspace
-- granularity:
--
--   1. Read access follows the SAME visibility rule as the task itself
--      (AS-359) — reused via public.is_task_visible_to(task_id), the
--      shared helper from F132/the project-visibility RLS sweep. A
--      non-member (or a member who cannot see the task's project, e.g.
--      a private project they are not on) gets zero rows, not an error.
--
--   2. The table is genuinely append-only (AS-357) — there is no UPDATE
--      or DELETE RLS policy defined at all, for any role, including
--      owner/admin. "No UI for it" is not the same guarantee as "no
--      policy permits it": even a real owner/admin session (not the
--      service-role admin client) cannot alter or erase an entry via a
--      direct Postgres call.
--
-- Writes happen exclusively through the SECURITY DEFINER function
-- `public.write_task_activity_entry` below. Application code (Server
-- Actions in F195+) calls this RPC; there is intentionally no INSERT
-- policy that lets an authenticated client's own publishable-key session
-- insert a row directly.
--
-- --- `kind` vocabulary (F195/F196 MUST follow this exactly) ------------
--
-- `kind` is a free-form `text` column with a CHECK constraint pinning it
-- to a fixed, closed set (unlike audit_log.action, which is open-ended
-- free text) — activity entries are rendered by a small, fixed set of UI
-- templates in F196, so a closed vocabulary is safer here and costs
-- nothing extra since the set is small and known:
--
--   'field_changed'   - a single tracked field on the task changed value.
--                        `field` names the column (e.g. 'status',
--                        'assignee_id', 'priority', 'due_date',
--                        'estimate', 'title'); `old_value`/`new_value`
--                        hold the before/after values as jsonb (so a
--                        text, a date, and a uuid all fit the same
--                        column shape without a second source of truth).
--   'comment_added'    - a comment was created on the task. `field` is
--                        null; `new_value` carries at minimum the
--                        comment id, e.g. {"comment_id": "..."}.
--   'comment_deleted'  - a comment was deleted from the task. `field` is
--                        null; `old_value` carries the comment id, e.g.
--                        {"comment_id": "..."}.
--
-- `actor_id` is nullable specifically for system-generated entries
-- (AS-360, e.g. the recurrence job creating a new occurrence or copying
-- forward fields) — the reading UI renders a null actor_id as "System"
-- (F196). A human-attributed entry always has actor_id set; the RPC
-- pins it to auth.uid() when the caller has a session, and accepts an
-- explicit null only when called with no authenticated caller (the
-- recurrence job's own service-role/cron context).

create table public.task_activity (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null,
  field text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now(),
  constraint task_activity_kind_check check (
    kind in ('field_changed', 'comment_added', 'comment_deleted')
  ),
  -- field is required for field_changed entries and must be absent for
  -- the comment_* kinds, which identify the comment via new_value/
  -- old_value instead.
  constraint task_activity_field_presence_check check (
    (kind = 'field_changed' and field is not null)
    or (kind <> 'field_changed' and field is null)
  )
);

comment on table public.task_activity is
  'Append-only per-task activity trail (F194). Writes only via public.write_task_activity_entry(); no UPDATE/DELETE policy exists for any role. See migration header comment for the kind vocabulary (field_changed / comment_added / comment_deleted) that F195/F196 must follow.';

-- Main read path: "activity feed for task X, most recent first" — the
-- only read path named in the spec.
create index task_activity_task_id_created_at_idx
  on public.task_activity (task_id, created_at desc);

alter table public.task_activity enable row level security;

-- SELECT: same visibility as the task itself (AS-359). Reuses the shared
-- helper rather than a copy-pasted predicate, per the clarification's
-- "shared SQL helper" answer and this feature's explicit instruction to
-- reuse F132's is_task_visible_to.
create policy task_activity_select_visible_task
  on public.task_activity
  for select
  to authenticated
  using (
    public.is_task_visible_to(task_id)
  );

-- Deliberately no INSERT/UPDATE/DELETE policy of any kind on this table.
-- INSERT happens only through the SECURITY DEFINER function below, which
-- runs with the privileges of its owner (bypassing RLS internally) — RLS
-- on the table itself need not (and does not) grant INSERT to any role.
-- UPDATE/DELETE are omitted entirely and permanently: this is what makes
-- the table append-only, not just "no UI calls it" (AS-357).

create or replace function public.write_task_activity_entry(
  p_task_id uuid,
  p_kind text,
  p_field text default null,
  p_old_value jsonb default null,
  p_new_value jsonb default null,
  p_system boolean default false
)
returns public.task_activity
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.task_activity;
  v_actor uuid;
begin
  -- A human-attributed entry requires an authenticated caller who can
  -- see the task (defense in depth — the Server Action layer in F195
  -- should already re-check this, but the function does not blindly
  -- trust it either). A system-generated entry (p_system = true, used
  -- by the recurrence job, AS-360) is exempt from the auth requirement
  -- and always writes a null actor_id, regardless of any session.
  if p_system then
    v_actor := null;
  else
    if auth.uid() is null then
      raise exception 'task_activity: no authenticated actor';
    end if;
    if not public.is_task_visible_to(p_task_id) then
      raise exception 'task_activity: caller cannot see this task';
    end if;
    v_actor := auth.uid();
  end if;

  if not exists (select 1 from public.tasks t where t.id = p_task_id) then
    raise exception 'task_activity: task % does not exist', p_task_id;
  end if;

  insert into public.task_activity (task_id, actor_id, kind, field, old_value, new_value)
  values (p_task_id, v_actor, p_kind, p_field, p_old_value, p_new_value)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.write_task_activity_entry(uuid, text, text, jsonb, jsonb, boolean) from public;
grant execute on function public.write_task_activity_entry(uuid, text, text, jsonb, jsonb, boolean) to authenticated, service_role;
