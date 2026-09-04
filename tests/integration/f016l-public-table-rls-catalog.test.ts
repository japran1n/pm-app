// F016l (missions/20260903-portal, M3 remediation — blocker): the table
// that guards the guard has no guard.
//
// public.f016i_gated_function_oids (F016i, 20261007010000) was the
// only RLS-less table in `public`, with anon SELECT/INSERT/UPDATE/
// DELETE live over PostgREST — proven by the M3 fourth-gate reviewer
// with a real anon-key POST that returned 201 and a real anon-key
// DELETE that removed the probe row again. Anon INSERT of a plausible
// future oid pre-poisons the event trigger's bookkeeping so a future
// function's first CREATE is treated as a replace and never gated
// (anon-executable forever); anon DELETE of an existing row makes the
// next CREATE OR REPLACE of that function look like a first sighting
// and strips its live grants. Both undo the exact feature that created
// the table.
//
// This suite has two parts, matching F016i's own shape
// (tests/integration/f016i-anon-execute-catalog.test.ts):
//
//   1. A catalog-derived test, not a hard-coded name: every ordinary
//      table in `public` is queried via `pg_class`/`pg_policy`
//      (`relrowsecurity`) directly against the live linked project, and
//      the suite fails if ANY of them has RLS disabled — so a future
//      migration that forgets `enable row level security` on a new
//      table fails CI the same way an anon-executable function does for
//      F016i, not just this one named table.
//
//   2. The primary success test, proven the same way the reviewer
//      proved the hole: real anon-key PostgREST requests (insert,
//      update, delete, select) against
//      `f016i_gated_function_oids`, asserted rejected over the wire.
//
// Uses the Supabase Management API's `database/query` endpoint for the
// catalog query (same pattern as f016i's suite, because `pg_class`/
// `pg_policy` are not reachable through PostgREST) and a plain
// anon-key `fetch` against `/rest/v1/...` for the wire-level proof
// (same pattern as tests/integration/f006k-projects-column-role-gate.
// test.ts's own convention for anon-key REST calls).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 20000 });

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const haveMgmtCreds = Boolean(PROJECT_REF && ACCESS_TOKEN);
const haveRestCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY);

if (process.env.CI && !haveMgmtCreds) {
  throw new Error(
    "F016l: missing Supabase Management API credentials (SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN) required to run this suite in CI.",
  );
}
if (process.env.CI && !haveRestCreds) {
  throw new Error(
    "F016l: missing Supabase REST credentials (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) required to run this suite in CI.",
  );
}

async function sql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      `F016l SQL query failed (${res.status}): ${JSON.stringify(body)}\nQuery: ${query}`,
    );
  }
  return body as T[];
}

describe.skipIf(!haveMgmtCreds)(
  "F016l: no ordinary table in public lacks row level security",
  () => {
    it(
      "catalog: every ordinary (non-partition, non-foreign) table in public has relrowsecurity = true " +
        "(derived from pg_class, not a hard-coded list of table names)",
      async () => {
        const rows = await sql<{ relname: string; relrowsecurity: boolean }>(`
          select c.relname, c.relrowsecurity
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relkind = 'r'
          order by c.relname;
        `);

        expect(
          rows.length,
          "F016l catalog query returned no tables at all — the query itself is broken, not a pass.",
        ).toBeGreaterThan(0);

        const withoutRls = rows.filter((r) => !r.relrowsecurity);

        expect(
          withoutRls,
          `Table(s) in public with RLS disabled: ${JSON.stringify(withoutRls)}. ` +
            `Every table this project creates must ` +
            "`alter table ... enable row level security`, even purely " +
            "internal bookkeeping tables (which should get RLS enabled " +
            "with zero policies for default-deny, per f016i_gated_function_oids).",
        ).toEqual([]);
      },
    );

    it(
      "f016i_gated_function_oids specifically: relrowsecurity is true and it has no anon/authenticated table grant",
      async () => {
        const [row] = await sql<{ relrowsecurity: boolean }>(`
          select c.relrowsecurity
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = 'f016i_gated_function_oids';
        `);
        expect(row.relrowsecurity).toBe(true);

        const grants = await sql<{ grantee: string; privilege_type: string }>(`
          select grantee, privilege_type
          from information_schema.role_table_grants
          where table_schema = 'public'
            and table_name = 'f016i_gated_function_oids'
            and grantee in ('anon', 'authenticated');
        `);
        expect(
          grants,
          `f016i_gated_function_oids still has a raw table grant for anon/authenticated: ${JSON.stringify(grants)}`,
        ).toEqual([]);
      },
    );

    it(
      "failure test: the event trigger still works after RLS is enabled — a scratch function " +
        "created in a rolled-back transaction is still revoked from anon/authenticated",
      async () => {
        // Rolled-back probe (same technique F016i's own migration header
        // used to verify premises live): if RLS on the bookkeeping table
        // somehow blocked the event trigger function's own INSERT (it
        // shouldn't — the trigger function runs as `postgres`, the table
        // owner, which bypasses RLS since FORCE ROW LEVEL SECURITY was
        // deliberately not set), the whole CREATE FUNCTION statement
        // would still succeed (the event trigger fires AFTER the DDL
        // command completes and does not abort it on error unless it
        // raises), but the resulting function would remain
        // anon-executable because the revoke would never happen. Proven
        // to actually revoke, not merely "not error", by checking
        // has_function_privilege for both roles.
        const result = await sql<{
          anon_exec: boolean;
          auth_exec: boolean;
        }>(`
          do $$
          declare
            r record;
          begin
            create function public.f016l_rls_still_works_probe() returns int language sql as $body$ select 1 $body$;
            select
              has_function_privilege('anon', 'public.f016l_rls_still_works_probe()', 'EXECUTE') as anon_exec,
              has_function_privilege('authenticated', 'public.f016l_rls_still_works_probe()', 'EXECUTE') as auth_exec
            into r;
            raise exception 'F016L_PROBE_RESULT anon_exec=% auth_exec=%', r.anon_exec, r.auth_exec;
          end $$;
        `).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          const match = message.match(
            /F016L_PROBE_RESULT anon_exec=(t|f|true|false) auth_exec=(t|f|true|false)/,
          );
          if (!match) {
            throw new Error(
              `F016l probe did not raise the expected result marker: ${message}`,
            );
          }
          const isTrue = (v: string) => v === "t" || v === "true";
          return [
            { anon_exec: isTrue(match[1]), auth_exec: isTrue(match[2]) },
          ];
        });

        expect(result[0].anon_exec).toBe(false);
        expect(result[0].auth_exec).toBe(false);
      },
    );
  },
);

describe.skipIf(!haveRestCreds)(
  "F016l: primary success test — anon-key PostgREST requests against f016i_gated_function_oids are rejected over the wire",
  () => {
    const REST_URL = `${SUPABASE_URL}/rest/v1/f016i_gated_function_oids`;
    const headers = {
      apikey: PUBLISHABLE_KEY!,
      Authorization: `Bearer ${PUBLISHABLE_KEY}`,
      "Content-Type": "application/json",
    };

    it("AS: anon SELECT returns zero rows (RLS default-deny, not merely 'table not found')", async () => {
      const res = await fetch(`${REST_URL}?select=oid&limit=1`, {
        headers,
      });
      expect(res.status).toBeLessThan(500);
      const body = await res.json();
      // Default-deny RLS with no policies means PostgREST returns 200
      // with an empty array (not a 401/403) for SELECT — the row simply
      // does not exist from anon's point of view. Assert exactly that
      // shape rather than a specific status code, since either an empty
      // 200 or an explicit 401/403 both satisfy "anon cannot read rows",
      // but a non-empty array would prove the hole is still open.
      expect(Array.isArray(body) ? body.length : 0).toBe(0);
    });

    it("AS: anon INSERT (the exact probe the reviewer used, {\"oid\": 999999}) is rejected, not 201", async () => {
      const res = await fetch(REST_URL, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({ oid: 999999 }),
      });
      expect(res.status).not.toBe(201);
      expect([401, 403]).toContain(res.status);
    });

    it("AS: anon UPDATE is rejected, not 2xx", async () => {
      const res = await fetch(`${REST_URL}?oid=eq.999999`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ gated_at: new Date().toISOString() }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it("AS: anon DELETE is rejected, not the 200/204 the reviewer proved live", async () => {
      const res = await fetch(`${REST_URL}?oid=eq.999999`, {
        method: "DELETE",
        headers,
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  },
);
