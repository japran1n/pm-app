-- F009d (missions/20260903-portal, M2 non-blocking follow-up, item FM):
-- inverts `approval_requests`' settled-row immutability trigger from a
-- deny-list to an allow-list, porting F016j's technique
-- (20261008010000, `client_requests`) and F020b's (20261017010000,
-- `projects`) to the third and, per F016j's own header, intended-next
-- table.
--
-- ---------------------------------------------------------------------
-- Defect (non-blocking, defence in depth — no live hole today): F011b
-- (20260924010000) narrowed `prevent_approval_request_settled_update`
-- from "no column may change once OLD.state <> 'pending'" to "only
-- state/decided_by/decided_at/decision_note may not change" so that
-- `resulting_task_id`'s `on delete set null` FK action (fired by
-- `purge_task` deleting a linked, trashed task) could still go through.
-- That migration's own header states the cost plainly: any column added
-- to `approval_requests` after F011b is NOT automatically frozen by
-- this trigger — `service_role` (and any future RLS grant reaching
-- UPDATE) can rewrite `subject_id`, `project_id`, `artifact_url` or
-- `round` on a settled row today, with nothing in the schema stopping
-- it. The M2 reviewer checked all UPDATE call sites and found none
-- exploit this — it is defence in depth, not a live hole — but the
-- shape is the one this mission has been bitten by eight times
-- (F006b, F006i, F006k, F006l, F009b, F016d, F016j, F020b): a
-- hand-enumerated deny-list goes stale the moment a column is added.
--
-- Fix: invert to an allow-list of the columns that may legitimately
-- change on a settled row. Grepped every `update approval_requests` /
-- `update public.approval_requests` site in supabase/migrations
-- (20260916010000:420, 20260920010000:104, 20260923010000:231,
-- 20260925010000:248, 20261001010000:474, 20261002010000:137,
-- 20261005010000:208, 20261018010000:148) — every one of them either
-- writes the four decision fields while `decide_approval_atomic` has
-- already asserted `v_state = 'pending'` moments earlier
-- (20260916010000:401-402, preserved unchanged in every later version
-- of that function), or writes `state = 'withdrawn'` with an explicit
-- `and state = 'pending'` in its own WHERE clause
-- (20261002010000:137, 20261005010000:208, 20261018010000:148). None of
-- them update a row whose OLD.state is already settled. The only two
-- writes that DO land on an already-settled row are:
--   - `resulting_task_id`, nulled by the `tasks.resulting_task_id ...
--     on delete set null` FK action when `purge_task` deletes a linked
--     trashed task (F011/F011b's own subject) -- carries no
--     immutability rule of its own, per F011's original header.
--   - `updated_at`, touched by `approval_requests_set_updated_at`
--     (20260916010000:81-85, `BEFORE UPDATE`, fires before this guard
--     alphabetically: "block_settled_update" < "set_updated_at") on
--     EVERY update to the row, settled or not -- there is no update
--     path, legitimate or otherwise, that leaves it unchanged.
-- No SECURITY DEFINER function anywhere in supabase/migrations writes
-- any other column to a row with OLD.state <> 'pending'. Unlike F020b's
-- own `task_counter` surprise (F025c), there is no third legitimate
-- writer here to carve a bypass flag for -- the two-column allow-list
-- is already complete, verified by grep rather than assumed.
--
-- Also unlike F016j/F020b, this guard does NOT exempt `service_role`:
-- FM's own complaint is precisely that `service_role` can rewrite these
-- columns today, so the fix must close that path for `service_role`
-- too, not carry it forward as an exemption. Nothing SECURITY DEFINER
-- and reachable from `authenticated` needs to write a non-allow-listed
-- column of a settled row, so no bypass flag is added either -- the
-- allow-list is deliberately not escapable from inside this migration.
--
-- No INSERT-side guard is added: F011b's original trigger, and every
-- caller of it, was UPDATE-only, and this feature's own definition of
-- done scopes the fix to the settled-row UPDATE guarantee, not to a
-- general field-role policy the way F020b added for `projects`. INSERT
-- validity (subject_type/subject_id/decision_type shape, decision-owner
-- checks) is already covered by `approval_requests_subject_shape_check`
-- and the RLS/RPC layer (20260916010000), untouched here.
-- ---------------------------------------------------------------------

create or replace function public.prevent_approval_request_settled_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allow constant text[] := array['updated_at', 'resulting_task_id'];
  v_new_diff jsonb;
  v_old_diff jsonb;
  v_key text;
begin
  if OLD.state <> 'pending' then
    v_new_diff := to_jsonb(NEW) - v_allow;
    v_old_diff := to_jsonb(OLD) - v_allow;

    for v_key in select jsonb_object_keys(v_new_diff)
    loop
      if (v_new_diff -> v_key) is distinct from (v_old_diff -> v_key) then
        raise exception 'approval_requests: a settled decision cannot be modified (id=%, state=%, column=%)', OLD.id, OLD.state, v_key
          using errcode = '42501';
      end if;
    end loop;
  end if;
  return NEW;
end;
$$;

comment on function public.prevent_approval_request_settled_update() is
  'F007/F011b/F009d: once OLD.state leaves ''pending'', every column of approval_requests is frozen EXCEPT updated_at (touched by approval_requests_set_updated_at on every write) and resulting_task_id (nulled by tasks.resulting_task_id''s ON DELETE SET NULL when purge_task removes a linked trashed task -- carries no immutability rule of its own, F011''s original header). F009d inverted this from F011b''s four-column deny-list to this two-column allow-list, computed via to_jsonb() diff rather than named per-column checks, so a column added to approval_requests later is frozen by default instead of exposed by default -- matching F016j (client_requests) and F020b (projects). Deliberately has no service_role exemption and no bypass flag: FM''s own defect was service_role''s ability to rewrite a settled row, and grep of every UPDATE call site in supabase/migrations found no legitimate writer that touches a settled row outside these two columns.';
