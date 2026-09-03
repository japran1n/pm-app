-- F011b (missions/20260903-portal, M2 remediation — blocker): a settled
-- `changes_requested` decision links a task via `resulting_task_id uuid
-- references tasks (id) on delete set null` (20260923010000). Trashing
-- and then purging that task fires `purge_task`'s `delete from tasks`
-- (20260822220000), which the FK's referential action turns into a real
-- `UPDATE approval_requests SET resulting_task_id = NULL ...` on the
-- linking row. That is a genuine row-level UPDATE — it fires
-- `approval_requests_block_settled_update` — and the trigger's
-- unconditional `OLD.state <> 'pending'` check
-- (`prevent_approval_request_settled_update`, 20260916010000) raises
-- 42501 and aborts the whole purge, permanently, because the row it just
-- rejected updating is exactly the row that is settled and therefore
-- can never leave that state.
--
-- Three ways to make the immutability rule and the FK coexist (this
-- feature's own brief): (1) have the trigger exempt the
-- `resulting_task_id` write when it's the FK's own referential action,
-- (2) change the FK to `on delete no action` and have `purge_task` null
-- the column itself before the delete, or (3) move the link into a side
-- table that carries no immutability trigger at all.
--
-- Chosen: (1), but implemented as "check the four guarded fields
-- explicitly" rather than trying to detect *why* the UPDATE fired.
-- Postgres gives a trigger no supported, non-hacky way to distinguish
-- "this UPDATE was queued by a FK's ON DELETE SET NULL action" from "a
-- session ran an UPDATE by hand" inside a row trigger body — both look
-- identical to `pg_trigger_depth()`/`TG_OP` (a superuser-only
-- `pg_trigger_depth()` check is not a security boundary here since this
-- function already runs SECURITY DEFINER and is reachable from
-- `authenticated`). So instead of gating on *origin*, the trigger gates
-- on *effect*: AS-024's actual guarantee is that `state`, `decided_by`,
-- `decided_at` and `decision_note` are unwritable once settled — not
-- that the row is frozen byte-for-byte forever. Checking those four
-- columns by name, instead of blocking every column via `OLD.state`,
-- satisfies AS-024 exactly as worded and lets `resulting_task_id` (the
-- one column this same migration's F011 predecessor already documented
-- as "no trigger guards it... this column is only ever written once,
-- inside this same function") be nulled by the FK's referential action
-- without a direct write ever earning the same exemption for the
-- guarded fields.
--
-- Cost of this choice, stated plainly: the trigger no longer blocks
-- *every* column on a settled row — it blocks the four decision fields
-- by name. Any column added to `approval_requests` in the future is NOT
-- automatically covered by this trigger the way it was before; a future
-- migration that adds a new mutable-after-settlement column must audit
-- this trigger, same as it must already audit the RLS
-- `approval_requests_update_team` WITH CHECK (20260916010000) which has
-- the identical shape (denies by checking named columns, not by
-- blocking the whole row). Rejected (2): `on delete no action` pushes
-- the "clear this FK before deleting the task" responsibility onto
-- every present and future caller of a task hard-delete
-- (`purge_task` is not the only place; `cascade_delete_task`,
-- 20260819071821, deletes tasks too) — a second, easy-to-forget
-- call site instead of one column-scoped trigger change. Rejected (3):
-- a side table buys nothing here — `resulting_task_id` already has NO
-- immutability protection of its own (F011's own header, quoted above);
-- moving it doesn't remove a rule that was never applied to it, it just
-- adds a table and a join for every future read of "what task did this
-- decision create".

create or replace function public.prevent_approval_request_settled_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if OLD.state <> 'pending' then
    if NEW.state is distinct from OLD.state
       or NEW.decided_by is distinct from OLD.decided_by
       or NEW.decided_at is distinct from OLD.decided_at
       or NEW.decision_note is distinct from OLD.decision_note
    then
      raise exception 'approval_requests: a settled decision cannot be modified (id=%, state=%)', OLD.id, OLD.state
        using errcode = '42501';
    end if;
  end if;
  return NEW;
end;
$$;
