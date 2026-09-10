// Reconstructs a single baseline schema file for `public` from the live
// catalog, via the Management API query endpoint. Used instead of
// `supabase db dump` / pg_dump because this project is remote-only and the
// database password is not in .env (and resetting it is destructive).
import { writeFileSync } from "node:fs";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;
const url = `https://api.supabase.com/v1/projects/${REF}/database/query`;

async function q(query) {
  for (let a = 1; ; a++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const body = await res.json();
    if (res.ok) return body;
    const msg = JSON.stringify(body);
    if ((res.status === 429 || /Throttler/i.test(msg)) && a <= 12) {
      await new Promise((r) => setTimeout(r, 2500 * a));
      continue;
    }
    throw new Error(msg);
  }
}

const out = [];
const S = (s) => out.push(s);

S(`-- Baseline schema for \`public\`, generated from the live catalog of
-- project ${REF} on ${new Date().toISOString().slice(0, 10)}.
--
-- This is the squashed equivalent of the 246 incremental migrations in
-- supabase/migrations/. It is NOT applied to the existing project (whose
-- ledger already records those 246). It exists so a new Supabase project can
-- be stood up from one file, with every fix from 20261120* already folded in.
--
-- Regenerate with scripts/gen-baseline-schema.mjs.
--
-- Not included: auth/storage schemas (Supabase manages those), row data, and
-- role/grant statements that require superuser.

set check_function_bodies = off;
`);

// --- extensions -------------------------------------------------------------
const exts = await q(`
  select e.extname, n.nspname as schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname not in ('plpgsql')
  order by e.extname`);
S(`\n-- ============================== extensions ==============================\n`);
for (const e of exts) S(`create extension if not exists ${JSON.stringify(e.extname).replace(/"/g, '"')} with schema ${e.schema};`);

// --- enum types -------------------------------------------------------------
const enums = await q(`
  select t.typname,
         (select string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder)
          from pg_enum e where e.enumtypid = t.oid) as labels
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typtype = 'e'
  order by t.typname`);
if (enums.length) {
  S(`\n-- ================================ types =================================\n`);
  for (const e of enums) S(`create type public.${e.typname} as enum (${e.labels});`);
}

// --- tables -----------------------------------------------------------------
const tables = await q(`
  select c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public' and c.relkind='r'
    and not exists (select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')
  order by c.relname`);

const cols = await q(`
  select table_name, column_name, ordinal_position,
         case
           when data_type = 'USER-DEFINED' then 'public.' || udt_name
           when data_type = 'ARRAY' then
             (select format_type(a.atttypid, a.atttypmod)
              from pg_attribute a
              join pg_class pc on pc.oid = a.attrelid
              join pg_namespace pn on pn.oid = pc.relnamespace
              where pn.nspname='public' and pc.relname = c.table_name
                and a.attname = c.column_name)
           when character_maximum_length is not null then data_type || '(' || character_maximum_length || ')'
           when data_type = 'numeric' and numeric_precision is not null
             then 'numeric(' || numeric_precision || ',' || coalesce(numeric_scale,0) || ')'
           else data_type
         end as type,
         is_nullable, column_default, is_identity, identity_generation
  from information_schema.columns c
  where table_schema='public'
  order by table_name, ordinal_position`);

const byTable = new Map();
for (const c of cols) {
  if (!byTable.has(c.table_name)) byTable.set(c.table_name, []);
  byTable.get(c.table_name).push(c);
}

S(`\n-- =============================== tables ================================\n`);
for (const t of tables) {
  const tc = byTable.get(t.relname) || [];
  const lines = tc.map((c) => {
    let l = `  ${JSON.stringify(c.column_name).replace(/"/g, '"')} ${c.type}`;
    if (c.is_identity === "YES") l += ` generated ${c.identity_generation === "ALWAYS" ? "always" : "by default"} as identity`;
    else if (c.column_default !== null) l += ` default ${c.column_default}`;
    if (c.is_nullable === "NO") l += " not null";
    return l;
  });
  S(`create table if not exists public.${t.relname} (\n${lines.join(",\n")}\n);`);
}

// Order matters and is circular-ish, so it is resolved in three steps:
// tables (columns only) -> functions -> constraints.
//   * five functions return or declare table row types, so the tables must
//     exist first;
//   * nine CHECK constraints call project functions (looks_like_credential,
//     is_valid_timezone, is_valid_link_kind), so the functions must exist
//     before the constraints are added.
// Function bodies still reference tables in ways the parser would reject at
// create time, which is why `check_function_bodies = off` is set at the top
// of the generated file.
// --- functions --------------------------------------------------------------
const fns = await q(`
  select pg_get_functiondef(p.oid) as def, p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public'
    and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
  order by p.proname`);
S(`\n-- ============================== functions ==============================\n`);
for (const f of fns) S(`${f.def};\n`);

// --- constraints ------------------------------------------------------------
const cons = await q(`
  select rel.relname as tbl, con.conname, pg_get_constraintdef(con.oid) as def,
         case con.contype when 'p' then 1 when 'u' then 2 when 'x' then 3 when 'c' then 4 else 5 end as ord
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname='public' and con.contype in ('p','u','x','c','f')
  order by ord, rel.relname, con.conname`);
S(`\n-- ============================ constraints ==============================\n`);
for (const c of cons) S(`alter table public.${c.tbl} add constraint ${c.conname} ${c.def};`);

// --- indexes (skip those backing constraints) -------------------------------
const idx = await q(`
  select indexdef from pg_indexes i
  where schemaname='public'
    and not exists (
      select 1 from pg_constraint c
      join pg_class ic on ic.oid = c.conindid
      where ic.relname = i.indexname
    )
  order by tablename, indexname`);
S(`\n-- =============================== indexes ===============================\n`);
for (const i of idx) S(`${i.indexdef};`);

// --- triggers ---------------------------------------------------------------
const trg = await q(`
  select pg_get_triggerdef(t.oid) as def
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public' and not t.tgisinternal
  order by c.relname, t.tgname`);
S(`\n-- =============================== triggers ==============================\n`);
for (const t of trg) S(`${t.def};`);

// --- RLS + policies ---------------------------------------------------------
S(`\n-- ========================== row level security =========================\n`);
for (const t of tables) if (t.relrowsecurity) S(`alter table public.${t.relname} enable row level security;`);

const pol = await q(`
  select tablename, policyname, permissive, roles, cmd, qual, with_check
  from pg_policies where schemaname='public'
  order by tablename, policyname`);
S("");
for (const p of pol) {
  const roles = Array.isArray(p.roles) ? p.roles.join(", ") : String(p.roles).replace(/[{}]/g, "");
  let s = `create policy ${JSON.stringify(p.policyname)} on public.${p.tablename}\n  as ${p.permissive.toLowerCase()}\n  for ${p.cmd.toLowerCase()}\n  to ${roles}`;
  if (p.qual) s += `\n  using (${p.qual})`;
  if (p.with_check) s += `\n  with check (${p.with_check})`;
  S(s + ";\n");
}

// --- realtime publication ---------------------------------------------------
const pub = await q(`
  select tablename from pg_publication_tables
  where pubname='supabase_realtime' and schemaname='public' order by tablename`);
if (pub.length) {
  S(`\n-- ========================= realtime publication ========================\n`);
  for (const p of pub) S(`alter publication supabase_realtime add table public.${p.tablename};`);
}

// --- replica identity (non-default) ----------------------------------------
const ri = await q(`
  select c.relname, c.relreplident
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and c.relreplident <> 'd'
  order by c.relname`);
if (ri.length) {
  S(`\n-- ============================ replica identity =========================\n`);
  const map = { f: "full", n: "nothing", i: "index" };
  for (const r of ri) S(`alter table public.${r.relname} replica identity ${map[r.relreplident] || "default"};`);
}

const target = process.argv[2];
writeFileSync(target, out.join("\n") + "\n");
console.log(`wrote ${target}`);
console.log(`extensions=${exts.length} enums=${enums.length} tables=${tables.length} constraints=${cons.length} indexes=${idx.length} functions=${fns.length} triggers=${trg.length} policies=${pol.length} realtime=${pub.length}`);
