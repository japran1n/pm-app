// F016i (missions/20260903-portal, M3 remediation — blocker for starting
// M4): the real deliverable of this feature. F016g's own test
// (tests/integration/f016g-default-acl-hardening.test.ts) checks two
// hard-coded function names; nothing would have caught
// `clear_client_deliverable_swept_at()` becoming anon-executable, or any
// function M4 adds becoming anon-executable, because the default-ACL
// revoke F016g relied on is a no-op (see this feature's migration,
// 20261007010000, for the proof and the fix).
//
// This suite instead derives its expectation from the catalog itself:
// every function in `public` is queried for
// `has_function_privilege('anon', …, 'EXECUTE')` directly against the
// live linked project, and any hit that is not on an explicit,
// hand-reviewed allow-list fails the test. Adding a new function that is
// (accidentally or deliberately) anon-executable, without adding it to
// the allow-list below, fails this suite — that is the mechanism turning
// "someone must remember" into "CI says no."
//
// Uses the Supabase Management API's `database/query` endpoint directly
// (same pattern as tests/integration/overdue-notification-sweep.test.ts
// and tests/integration/f016g-default-acl-hardening.test.ts's siblings),
// because this test is about `pg_proc`/`has_function_privilege`, which is
// not reachable through PostgREST/`.rpc()` at all.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

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
const haveMgmtCreds = Boolean(PROJECT_REF && ACCESS_TOKEN);
if (process.env.CI && !haveMgmtCreds) {
  throw new Error(
    "F016i: missing Supabase Management API credentials (SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN) required to run this suite in CI.",
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
      `F016i SQL query failed (${res.status}): ${JSON.stringify(body)}\nQuery: ${query}`,
    );
  }
  return body as T[];
}

// Every function in `public` this project's own migration history
// deliberately grants `anon` EXECUTE on (RLS-predicate helpers that must
// stay reachable so an `anon` query against an RLS-protected table does
// not itself get "permission denied for function", plus the two data
// helpers F016g's own audit found were already anon-granted) — the exact
// `anon_fns` array restored by name in
// supabase/migrations/20261004010000_f016g_default_acl_and_unguarded_functions.sql.
// Anything anon-executable that is NOT in this list is a defect, whether
// it is a pre-existing function or one M4 adds.
const ANON_ALLOW_LIST = new Set([
  "can_modify_comment",
  "derive_project_key_base",
  "generate_unique_project_key",
  "get_blocked_count",
  "get_completed_count",
  "get_due_soon_count",
  "get_overdue_count",
  "is_active_workspace_member",
  "is_done_status",
  "is_project_lead_or_workspace_admin",
  "is_project_visible_to",
  "is_project_visible_to_row",
  "is_project_workspace_admin",
  "is_project_workspace_member",
  "is_project_workspace_writer",
  "is_task_visible_to",
  "is_task_workspace_member",
  "is_task_workspace_writer",
  "is_workspace_admin",
  "shares_workspace_with",
  "is_project_client",
  "is_task_client",
  "is_workspace_client",
  "shares_non_client_workspace_with",
  "is_project_portal_enabled",
  // Pre-existing anon grant, discovered live by this test rather than by
  // grep — `is_valid_timezone` (20260818225500_profiles_timezone_check.sql)
  // backs the `profiles_timezone_valid` CHECK constraint (evaluated as
  // the QUERYING role, per F016g's own migration comment) and carries an
  // explicit `anon=X/postgres` grant in the live catalog that predates
  // F016g's audit — F016g's migration only restored it to
  // `authenticated_fns`, never `anon_fns`, so this grant was not added by
  // F016g and is out of this feature's scope to remove blind (revoking
  // it without first proving no anon-role write path to `profiles.timezone`
  // exists risks the exact "quietly broke two things" regression this
  // feature's own Definition of Done warns against). Left allow-listed
  // here rather than silently revoked; flagged in this feature's handoff
  // as an out-of-scope finding for a follow-up to investigate and either
  // justify or close.
  "is_valid_timezone",
]);

describe.skipIf(!haveMgmtCreds)(
  "F016i: no function in public is anon-executable without an explicit allow-list entry",
  () => {
    afterAll(async () => {
      // Best-effort cleanup in case an earlier run of this file's
      // "manual verification" test crashed before its own cleanup ran.
      await sql(
        `drop function if exists public.f016i_catalog_test_scratch_fn();`,
      ).catch(() => {});
    });

    it(
      "AS: every anon-executable function in public is on the explicit allow-list " +
        "(catalog-derived — fails on ANY unlisted function, not a hard-coded pair of names)",
      async () => {
        const rows = await sql<{ proname: string; args: string }>(`
          select p.proname, pg_get_function_identity_arguments(p.oid) as args
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and has_function_privilege('anon', p.oid, 'EXECUTE')
          order by p.proname;
        `);

        const unlisted = rows.filter((r) => !ANON_ALLOW_LIST.has(r.proname));

        expect(
          unlisted,
          `Function(s) anon-executable without an allow-list entry: ${JSON.stringify(unlisted)}. ` +
            `Either this is a genuine new defect (fix the function's grants / F016i's event trigger), ` +
            `or it is a deliberate new anon-callable RLS helper and belongs in ANON_ALLOW_LIST above.`,
        ).toEqual([]);
      },
    );

    it(
      "AS: clear_client_deliverable_swept_at (F016h) is retro-fixed — no longer anon-executable",
      async () => {
        const [row] = await sql<{ anon_exec: boolean }>(`
          select has_function_privilege(
            'anon', 'public.clear_client_deliverable_swept_at()', 'EXECUTE'
          ) as anon_exec;
        `);
        expect(row.anon_exec).toBe(false);
      },
    );

    it(
      "primary success test: a function created in a scratch migration is not " +
        "anon-executable without an explicit grant, proven by has_function_privilege",
      async () => {
        await sql(
          `create function public.f016i_catalog_test_scratch_fn() returns int language sql as $body$ select 1 $body$;`,
        );
        try {
          const [row] = await sql<{ anon_exec: boolean; auth_exec: boolean }>(`
            select
              has_function_privilege('anon', 'public.f016i_catalog_test_scratch_fn()', 'EXECUTE') as anon_exec,
              has_function_privilege('authenticated', 'public.f016i_catalog_test_scratch_fn()', 'EXECUTE') as auth_exec;
          `);
          expect(row.anon_exec).toBe(false);
          expect(row.auth_exec).toBe(false);
        } finally {
          await sql(`drop function public.f016i_catalog_test_scratch_fn();`);
        }
      },
    );

    it(
      "manual verification: the catalog-derived detection query DOES fail-positive " +
        "when a scratch function is deliberately granted anon EXECUTE",
      async () => {
        await sql(
          `create function public.f016i_catalog_test_scratch_fn() returns int language sql as $body$ select 1 $body$;`,
        );
        try {
          await sql(
            `grant execute on function public.f016i_catalog_test_scratch_fn() to anon;`,
          );

          const rows = await sql<{ proname: string }>(`
            select p.proname
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and has_function_privilege('anon', p.oid, 'EXECUTE')
              and p.proname = 'f016i_catalog_test_scratch_fn';
          `);

          // This is the exact detection query the first test in this
          // file runs against the whole schema. Proving it finds the
          // deliberately-granted scratch function here is the
          // Definition of Done's "manual verification" requirement:
          // the test genuinely fails when a function is anon-executable
          // without an allow-list entry, it is not vacuously green.
          expect(rows.map((r) => r.proname)).toContain(
            "f016i_catalog_test_scratch_fn",
          );
        } finally {
          await sql(`drop function public.f016i_catalog_test_scratch_fn();`);
        }
      },
    );
  },
);
