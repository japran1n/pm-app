-- P1 — pin search_path on functions that currently inherit it.
--
-- Supabase advisor lint 0011 (function_search_path_mutable) flagged 25
-- functions. The filter below resolves to exactly those 25. A function without a pinned search_path resolves unqualified
-- names using the *caller's* search_path, so a caller can shadow a table or
-- operator and change what the function does. For SECURITY DEFINER functions
-- that is a privilege-escalation path.
--
-- These functions' bodies use unqualified names today, so they are pinned to
-- `public` rather than `''`. That removes the mutability (which is the actual
-- vulnerability) while preserving name resolution exactly as it is now.
-- Moving to `search_path = ''` with fully-qualified bodies is a follow-up that
-- requires rewriting each body and re-running its tests.
--
-- pg_temp is deliberately not listed: naming it would let a caller pre-create
-- a shadowing temp object, which is the very thing being closed.

do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.prokind = 'f'
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) c
        where c like 'search\_path=%'
      )
      -- Extension-owned functions are excluded. btree_gist alone contributes
      -- ~188 unpinned functions (gbt_*, *_dist, gbtreekey*), all owned by
      -- supabase_admin. `postgres` is not a superuser on this project, so
      -- ALTER FUNCTION on them errors out and would abort this migration.
      and not exists (
        select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
      )
      and pg_get_userbyid(p.proowner) = current_user
  loop
    execute format('alter function %s set search_path = public', r.sig);
    n := n + 1;
  end loop;

  raise notice 'search_path pinned on % functions', n;
end $$;
