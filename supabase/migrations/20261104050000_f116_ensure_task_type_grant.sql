-- F116 follow-up: 20261104040000 revoked public execute on
-- ensure_task_type but never granted it back to `authenticated` —
-- `tasks_default_task_type` runs as a plain (non-SECURITY DEFINER)
-- trigger, i.e. with the INSERTing session's own privileges, so an
-- ordinary member's direct `tasks` insert failed with "permission
-- denied for function ensure_task_type" the moment it fell through to
-- the self-heal path. `ensure_task_type` being SECURITY DEFINER already
-- controls what it's allowed to touch; EXECUTE is the separate, missing
-- permission to invoke it at all.
grant execute on function public.ensure_task_type(uuid, text, text, text, boolean, boolean) to authenticated;
