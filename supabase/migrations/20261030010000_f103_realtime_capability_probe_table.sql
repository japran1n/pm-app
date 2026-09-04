-- F103 (AS-369): a tiny, permanent, product-data-free table used only to
-- answer one runtime question at test time -- "can this Postgres/Realtime
-- stack deliver postgres_changes for a REPLICA IDENTITY FULL table right
-- now?" -- without touching comment_reactions itself.
--
-- Why a real table instead of dynamic DDL from the test process: the test
-- runner authenticates with the anon/service-role REST API, which has no
-- path to run CREATE TABLE / ALTER PUBLICATION at request time, and adding
-- a raw Postgres driver just to do DDL from a vitest file is more risk than
-- a three-line migration. This table is created once, kept in
-- REPLICA IDENTITY FULL and in the supabase_realtime publication
-- permanently, and the probe (tests/helpers/replica-identity-delivery-
-- probe.ts) only ever INSERTs and DELETEs a single throwaway row into it
-- with a service-role client -- RLS is enabled with no policies so nothing
-- but the service role (which bypasses RLS) can touch it at all.
--
-- See missions/20260903-portal/handoffs/F103-handoff.md for the full
-- investigation this table exists to support.
create table if not exists public._realtime_capability_probe (
  id uuid primary key default gen_random_uuid(),
  tag text not null,
  created_at timestamptz not null default now()
);

alter table public._realtime_capability_probe enable row level security;

alter table public._realtime_capability_probe replica identity full;

alter publication supabase_realtime add table public._realtime_capability_probe;
