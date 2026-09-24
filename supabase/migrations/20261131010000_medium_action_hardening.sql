-- Audit 2026-09-24, medium server-action findings — database half.
--
-- 1. SEC-ACT3-07: doc_links writes (insert/update/delete) required only
--    can_READ_workspace_docs, so a viewer could add a link to any doc —
--    doc_links are rendered as preview cards in the client portal. Writes
--    now need can_write_workspace_docs plus project visibility on a live
--    (not soft-deleted) doc, matching the docs_* write policies.
--
-- 2. SEC-ACT4-07 / GAP3-04: brief_answers had no unique key, so two
--    concurrent first saves could both insert. Unique index on
--    (brief_id, question_id) — verified live before this migration: zero
--    duplicate groups. NULL question_id (question deleted, ON DELETE SET
--    NULL) stays allowed any number of times (NULLs are distinct).
--    saveBriefAnswer upserts on it.
--
-- 3. GAP3-04: record_brief_answer_revision wrote a revision on every
--    autosave keystroke batch. It now coalesces: when the SAME author
--    changes their own answer again within 10 minutes of their previous
--    save, the intermediate state is not recorded (the value that existed
--    before that editing session was already recorded by its first save).
--
-- 4. SEC-ACT1-05: change_workspace_member_role — the role change and the
--    last-owner guard in one statement-level transaction, with every
--    active owner row locked (FOR UPDATE, deterministic order) before
--    counting, and "only an owner may change an owner's role" checked
--    against the actor's locked row. Service-role only (called by the
--    app's admin client after requireWorkspaceAdmin).
--
-- 5. SEC-ACT1-06: is_project_lead_or_workspace_admin granted lead rights
--    from a project_members row alone, so a former member (or someone
--    demoted to client/viewer) who had been a lead kept them. The lead
--    branch now also requires an active workspace membership with a role
--    other than client/viewer.
--
-- An event trigger in this project revokes default EXECUTE on functions
-- created here, so every function below is granted explicitly.

-- 1. doc_links write policies ------------------------------------------

drop policy if exists doc_links_insert_team on public.doc_links;
create policy doc_links_insert_team
  on public.doc_links
  for insert
  to authenticated
  with check (
    exists (
      select 1
        from public.docs d
       where d.id = doc_links.doc_id
         and d.deleted_at is null
         and public.is_active_workspace_member(d.workspace_id)
         and public.can_write_workspace_docs(d.workspace_id)
         and (d.project_id is null or public.is_project_visible_to(d.project_id))
    )
  );

drop policy if exists doc_links_update_team on public.doc_links;
create policy doc_links_update_team
  on public.doc_links
  for update
  to authenticated
  using (
    exists (
      select 1
        from public.docs d
       where d.id = doc_links.doc_id
         and d.deleted_at is null
         and public.is_active_workspace_member(d.workspace_id)
         and public.can_write_workspace_docs(d.workspace_id)
         and (d.project_id is null or public.is_project_visible_to(d.project_id))
    )
  )
  with check (
    exists (
      select 1
        from public.docs d
       where d.id = doc_links.doc_id
         and d.deleted_at is null
         and public.is_active_workspace_member(d.workspace_id)
         and public.can_write_workspace_docs(d.workspace_id)
         and (d.project_id is null or public.is_project_visible_to(d.project_id))
    )
  );

drop policy if exists doc_links_delete_team on public.doc_links;
create policy doc_links_delete_team
  on public.doc_links
  for delete
  to authenticated
  using (
    exists (
      select 1
        from public.docs d
       where d.id = doc_links.doc_id
         and public.is_active_workspace_member(d.workspace_id)
         and public.can_write_workspace_docs(d.workspace_id)
         and (d.project_id is null or public.is_project_visible_to(d.project_id))
    )
  );

-- 2. brief_answers unique key ------------------------------------------

create unique index if not exists brief_answers_brief_question_unique
  on public.brief_answers (brief_id, question_id);

-- 3. Revision coalescing -----------------------------------------------

create or replace function public.record_brief_answer_revision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.answer_text is distinct from old.answer_text)
     or (new.answer_options is distinct from old.answer_options) then
    -- Same author continuing their own recent edit: the pre-session value
    -- is already in history, the intermediate autosave state is noise.
    if auth.uid() is not null
       and old.answered_by is not distinct from auth.uid()
       and old.answered_at is not null
       and old.answered_at > now() - interval '10 minutes' then
      return new;
    end if;

    insert into public.brief_answer_revisions (
      answer_id,
      previous_text,
      previous_options,
      changed_by,
      changed_at
    )
    values (
      old.id,
      old.answer_text,
      old.answer_options,
      auth.uid(),
      now()
    );
  end if;

  return new;
end;
$$;

revoke all on function public.record_brief_answer_revision() from public, anon, authenticated;
grant execute on function public.record_brief_answer_revision() to service_role;

-- 4. Atomic role change ------------------------------------------------

create or replace function public.change_workspace_member_role(
  p_membership_id uuid,
  p_workspace_id uuid,
  p_new_role text,
  p_actor_id uuid
)
returns table (changed boolean, reason text, old_role text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role  text;
  v_target_role text;
  v_status      text;
  v_owner_count int;
begin
  if p_new_role not in ('member', 'admin', 'viewer', 'guest', 'client') then
    return query select false, 'invalid_role'::text, null::text;
    return;
  end if;

  -- Serialize every role change in this workspace on its owner rows,
  -- always in id order so concurrent calls cannot deadlock each other.
  perform 1
    from public.workspace_members wm
   where wm.workspace_id = p_workspace_id
     and wm.role = 'owner'
     and wm.status = 'active'
   order by wm.id
     for update;

  select wm.role
    into v_actor_role
    from public.workspace_members wm
   where wm.workspace_id = p_workspace_id
     and wm.user_id = p_actor_id
     and wm.status = 'active';

  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    return query select false, 'forbidden'::text, null::text;
    return;
  end if;

  select wm.role, wm.status
    into v_target_role, v_status
    from public.workspace_members wm
   where wm.id = p_membership_id
     and wm.workspace_id = p_workspace_id
     for update;

  if not found then
    return query select false, 'not_found'::text, null::text;
    return;
  end if;

  if v_status <> 'active' then
    return query select false, 'not_active'::text, v_target_role;
    return;
  end if;

  if v_target_role = p_new_role then
    return query select true, 'unchanged'::text, v_target_role;
    return;
  end if;

  if v_target_role = 'guest' and p_new_role = 'admin' then
    return query select false, 'guest_to_admin'::text, v_target_role;
    return;
  end if;

  if v_target_role = 'owner' then
    if v_actor_role <> 'owner' then
      return query select false, 'owner_protected'::text, v_target_role;
      return;
    end if;

    select count(*)
      into v_owner_count
      from public.workspace_members wm
     where wm.workspace_id = p_workspace_id
       and wm.role = 'owner'
       and wm.status = 'active';

    if v_owner_count <= 1 then
      return query select false, 'sole_owner'::text, v_target_role;
      return;
    end if;
  end if;

  update public.workspace_members wm
     set role = p_new_role
   where wm.id = p_membership_id
     and wm.workspace_id = p_workspace_id
     and wm.status = 'active';

  return query select true, null::text, v_target_role;
end;
$$;

revoke all on function public.change_workspace_member_role(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.change_workspace_member_role(uuid, uuid, text, uuid)
  to service_role;

-- 5. Project-lead rights need a live, non-client membership --------------

create or replace function public.is_project_lead_or_workspace_admin(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.projects p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
     where p.id = target_project_id
       and wm.user_id = auth.uid()
       and wm.status = 'active'
       and wm.role in ('owner', 'admin')
  )
  or exists (
    select 1
      from public.project_members pm
      join public.projects p on p.id = pm.project_id
      join public.workspace_members wm
        on wm.workspace_id = p.workspace_id
       and wm.user_id = pm.user_id
     where pm.project_id = target_project_id
       and pm.user_id = auth.uid()
       and pm.project_role = 'lead'
       and wm.status = 'active'
       and wm.role not in ('client', 'viewer')
  );
$$;

revoke all on function public.is_project_lead_or_workspace_admin(uuid) from public, anon;
grant execute on function public.is_project_lead_or_workspace_admin(uuid)
  to authenticated, service_role;
