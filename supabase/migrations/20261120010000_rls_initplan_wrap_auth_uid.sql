-- P0 — RLS initplan: wrap auth.uid() in a scalar subquery.
--
-- Postgres evaluates `auth.uid()` once PER ROW inside an RLS policy, because
-- the planner treats the bare function call as row-dependent. Wrapping it as
-- `(select auth.uid())` turns it into an InitPlan, evaluated once per query.
--
-- Supabase advisor lint 0003 (auth_rls_initplan) flagged 70 policies.
-- Live state at time of writing: 48 USING and 41 WITH CHECK expressions with
-- an unwrapped call.
--
-- This is a pure performance change: the boolean result of every policy is
-- identical before and after. It rewrites live policy expressions in place via
-- ALTER POLICY, so policy names, roles and commands are preserved.

do $$
declare
  r record;
  new_qual text;
  new_check text;
  stmt text;
  n int := 0;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        (qual is not null and qual ~ 'auth\.uid\(\)')
        or (with_check is not null and with_check ~ 'auth\.uid\(\)')
      )
  loop
    -- Only rewrite bare calls. A call already preceded by `select ` (i.e.
    -- already wrapped) is left alone, so this migration is idempotent.
    new_qual  := regexp_replace(r.qual,       '(?<![Ss][Ee][Ll][Ee][Cc][Tt] )auth\.uid\(\)', '(select auth.uid())', 'g');
    new_check := regexp_replace(r.with_check, '(?<![Ss][Ee][Ll][Ee][Cc][Tt] )auth\.uid\(\)', '(select auth.uid())', 'g');

    if new_qual is not distinct from r.qual
       and new_check is not distinct from r.with_check then
      continue;
    end if;

    stmt := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if new_qual is not null then
      stmt := stmt || format(' using (%s)', new_qual);
    end if;
    if new_check is not null then
      stmt := stmt || format(' with check (%s)', new_check);
    end if;

    execute stmt;
    n := n + 1;
  end loop;

  raise notice 'rls_initplan: rewrote % policies', n;
end $$;

-- The same per-row evaluation happens inside the SECURITY DEFINER helper
-- functions the policies call (is_workspace_admin, is_task_visible_to, ...).
-- Their bodies are rewritten in 20261120020000.
