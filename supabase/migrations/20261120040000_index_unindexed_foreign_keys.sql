-- P1 — index every foreign key that has no supporting index.
--
-- Supabase advisor lint 0001 (unindexed_foreign_keys) flagged 52 constraints.
-- Without an index on the referencing column, every DELETE or key UPDATE on
-- the parent row forces a sequential scan of the child table to enforce the
-- constraint, and joins across the FK have no cheap path.
--
-- An index "supports" an FK when the constraint's columns are a leading prefix
-- of the index's columns, so a composite index that starts with the FK column
-- counts and is not duplicated here.
--
-- Plain CREATE INDEX (not CONCURRENTLY) is used deliberately: this runs inside
-- a migration transaction, and the largest table in this database has 20 rows.

do $$
declare
  r record;
  idx_name text;
  cols text;
  n int := 0;
begin
  for r in
    select
      c.conrelid::regclass::text as tbl,
      c.conname,
      array_agg(a.attname order by k.ord) as colnames
    from pg_constraint c
    join pg_namespace ns on ns.oid = c.connamespace
    join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.contype = 'f'
      and ns.nspname = 'public'
    group by c.conrelid, c.conname, c.conkey
    having not exists (
      select 1
      from pg_index i
      where i.indrelid = c.conrelid
        and (i.indkey::smallint[])[0:array_length(c.conkey,1)-1] = c.conkey
    )
  loop
    cols := array_to_string(array(select quote_ident(x) from unnest(r.colnames) x), ', ');
    idx_name := left(
      'idx_' || replace(r.tbl, 'public.', '') || '_' || array_to_string(r.colnames, '_'),
      63
    );

    if to_regclass('public.' || quote_ident(idx_name)) is null then
      execute format('create index %I on %s (%s)', idx_name, r.tbl, cols);
      n := n + 1;
    end if;
  end loop;

  raise notice 'created % foreign-key indexes', n;
end $$;

-- Deliberately NOT dropping the 18 indexes currently reporting idx_scan = 0.
-- This database holds 6 users, 1 project and 20 tasks; at that size Postgres
-- picks a sequential scan over any index, so a zero scan count says nothing
-- about whether the index is needed. Re-evaluate against a realistically
-- sized dataset before dropping anything.
