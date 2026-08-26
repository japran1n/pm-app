// Applies one migration file to the linked Supabase project and records it
// in the CLI's migration ledger, so a later `supabase db push` does not try
// to re-run it.
//
// Exists because this project is remote-only (no local Supabase stack, no
// `supabase link` state in the repo), so `supabase db push` has nothing to
// connect to without a database password. The Management API's query
// endpoint does, using SUPABASE_ACCESS_TOKEN, which is already in .env.
//
// Run:  npm run db:apply -- supabase/migrations/<file>.sql

import { readFileSync } from "node:fs";
import { basename } from "node:path";

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const file = process.argv[2];

if (!ACCESS_TOKEN || !PROJECT_REF) {
  console.error("Missing SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF in .env");
  process.exit(1);
}
if (!file) {
  console.error("Usage: npm run db:apply -- supabase/migrations/<file>.sql");
  process.exit(1);
}

const name = basename(file, ".sql");
const version = name.slice(0, 14);
const label = name.slice(15);

if (!/^\d{14}$/.test(version)) {
  console.error(`Migration filename must start with a 14-digit version: ${name}`);
  process.exit(1);
}

async function query(sql) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  const body = await response.text();
  if (!response.ok) throw new Error(body);
  return body;
}

const already = await query(
  `select 1 from supabase_migrations.schema_migrations where version = '${version}';`,
);
if (already !== "[]") {
  console.log(`• ${name} already applied — nothing to do.`);
  process.exit(0);
}

console.log(`→ Applying ${name}`);
await query(readFileSync(file, "utf8"));
await query(
  `insert into supabase_migrations.schema_migrations (version, name)
   values ('${version}', '${label.replace(/'/g, "''")}')
   on conflict (version) do nothing;`,
);
console.log(`✓ Applied and recorded ${name}`);
