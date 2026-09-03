// Regression test for F006h (missions/20260903-portal,
// missions/20260903-portal/milestones/M1-scrutiny-2.md BX-1 — deploy
// blocker).
//
// Reproduces the EXACT colliding data shape that breaks
// 20260915020000_task_type_system_key_backfill_widen.sql's backfill: a
// workspace that already holds a `system_key = 'page'` row (seeded by
// `create_workspace_with_owner`, 20260912010000) PLUS a separate,
// untagged row named "Sida" (the Swedish-agency shape the widen
// migration itself was written for). Every workspace created since
// 20260912010000 shipped is seeded with the first row, so this is the
// ordinary case, not an exotic one.
//
// What this proves, against a real, throwaway local Postgres 16
// database (not a mock):
//   1. The historical defect is real: replaying the actual, unmodified
//      20260915020000 file against the colliding shape raises 23505 on
//      task_types_workspace_id_system_key_idx, exactly as
//      M1-scrutiny-2.md's BX-1 describes.
//   2. The decision this feature made — a NEW, forward-only corrective
//      migration (20260917010000_task_type_system_key_backfill_collision_fix.sql)
//      rather than editing 20260915020000 in place (see that file's own
//      header comment, and this feature's handoff, for the full
//      reasoning) — converges any database holding this shape to the
//      correct end state with no error: the pre-existing tagged row is
//      untouched, and the untagged "Sida" row is deliberately left
//      untagged (an admin has to pick it by hand — the migration cannot
//      know which of two candidate names is the team's real page type).
//   3. The corrective migration is idempotent (a second run is a no-op)
//      and does not regress the original migration's actual purpose: a
//      workspace with NO pre-existing tagged row still gets its lone
//      untagged "Sida" row tagged.
//
// Why this is a real Postgres process, not a mock: the bug is a
// partial-unique-index collision that only exists in Postgres's own
// constraint enforcement — no in-memory mock of `task_types` can
// reproduce a 23505 in a way that means anything. M1-scrutiny-2.md's own
// point stands: CI's `supabase start` replay (.github/workflows/ci.yml)
// starts from an EMPTY task_types table and never sees this shape, which
// is exactly why the original defect shipped.
//
// CI cannot run this test today: `supabase status -o env`
// (.github/workflows/ci.yml) exports only the REST API URL and JWT keys,
// not a raw Postgres connection string, so there is nothing to hand a
// bare `psql`. This test therefore requires a local Postgres server
// reachable via `psql -d postgres` with CREATE DATABASE privileges (a
// developer machine with Homebrew/native Postgres, as this one has) and
// skips gracefully everywhere else, via the same
// "skip when the infra isn't there" convention
// tests/integration/f005b-task-type-system-key.test.ts uses for missing
// Supabase credentials. See this feature's handoff, "Out-of-scope work
// needed", for wiring a raw DSN into CI so this can run there too.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

function migrationPath(name: string): string {
  const path = join(MIGRATIONS_DIR, name);
  if (!existsSync(path)) {
    throw new Error(`Expected migration file not found: ${path}`);
  }
  return path;
}

function haveLocalPostgres(): boolean {
  try {
    execFileSync("psql", ["-d", "postgres", "-c", "select 1"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

const canRun = haveLocalPostgres();
if (!canRun) {
  console.warn(
    "f006h-migration-collision-regression: no local Postgres reachable via " +
      "`psql -d postgres` — skipping. Needs a local Postgres server with " +
      "CREATE DATABASE privileges; see this file's header comment.",
  );
}

const DB_NAME = `f006h_regress_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// Minimal Supabase-compatible scaffold: exactly what the task_types
// migration chain references (auth.uid(), the auth.users FK target, and
// the authenticated/anon/service_role roles used by GRANT/POLICY
// statements) and nothing else — no Docker is available in this
// environment to run the real `supabase start` stack.
const SCAFFOLD_SQL = `
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid()
);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end
$$;
`;

// The real migration files this bug's dependency closure needs, in
// chain order, verbatim from disk — task_types (20260903040000) is only
// ever created/altered by these four files (grep across
// supabase/migrations for "task_types" confirms no other file touches
// its structure), so this is a faithful replay of every statement that
// shapes task_types, not a rewritten stand-in.
const CHAIN_FILES = [
  "20260817222532_create_workspaces.sql",
  "20260817222822_rls_workspaces.sql",
  "20260818004413_create_projects.sql",
  "20260818013434_create_tasks.sql",
  "20260903040000_task_types.sql",
  "20260912010000_task_type_system_key.sql",
];

const DEFECTIVE_WIDEN_FILE = "20260915020000_task_type_system_key_backfill_widen.sql";
const CORRECTIVE_FILE = "20260917010000_task_type_system_key_backfill_collision_fix.sql";

function psqlRun(db: string, args: string[]): string {
  return execFileSync("psql", ["-d", db, "-v", "ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
  });
}

function psqlFile(db: string, filePath: string): string {
  return psqlRun(db, ["-f", filePath]);
}

function psqlExpectFailure(db: string, filePath: string): string {
  try {
    psqlFile(db, filePath);
  } catch (err) {
    const stderr = (err as { stderr?: Buffer | string }).stderr;
    return stderr ? String(stderr) : String((err as Error).message);
  }
  throw new Error(`Expected ${filePath} to fail against colliding data, but it succeeded.`);
}

function scalar(db: string, sql: string): string {
  // `-t -A` suppresses headers/formatting, but an INSERT/UPDATE ... still
  // prints its own "INSERT 0 1"-style command tag on the line after the
  // returned value — only the first line is the scalar result.
  const output = psqlRun(db, ["-t", "-A", "-c", sql]).trim();
  return output.split("\n")[0] ?? "";
}

describe.skipIf(!canRun)(
  "F006h — collision-safe system_key backfill (deploy blocker BX-1)",
  () => {
    beforeAll(() => {
      execFileSync("psql", ["-d", "postgres", "-c", `drop database if exists ${DB_NAME};`]);
      execFileSync("psql", ["-d", "postgres", "-c", `create database ${DB_NAME};`]);
      execFileSync("psql", ["-d", DB_NAME, "-v", "ON_ERROR_STOP=1", "-c", SCAFFOLD_SQL]);
      for (const file of CHAIN_FILES) {
        psqlFile(DB_NAME, migrationPath(file));
      }
    });

    afterAll(() => {
      execFileSync("psql", ["-d", "postgres", "-c", `drop database if exists ${DB_NAME};`]);
    });

    it("BX-1 regression: the colliding-shape database migrates cleanly to head via the corrective migration, with no error", () => {
      // Construct the colliding shape: a workspace whose creation seeded
      // a tagged 'page' row (create_workspace_with_owner,
      // 20260912010000) PLUS a separate, untagged "Sida" row — legal,
      // since task_types_workspace_id_name_idx is on (workspace_id,
      // name), not on any pattern.
      const userId = "00000000-0000-0000-0000-000000000001";
      execFileSync("psql", [
        "-d",
        DB_NAME,
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `insert into auth.users (id) values ('${userId}');
         select set_config('request.jwt.claim.sub', '${userId}', false);
         select public.create_workspace_with_owner('F006h Collision Workspace', 'f006h-collision-workspace');`,
      ]);

      const workspaceId = scalar(
        DB_NAME,
        "select id from workspaces where slug = 'f006h-collision-workspace';",
      );
      expect(workspaceId).toMatch(/^[0-9a-f-]{36}$/);

      execFileSync("psql", [
        "-d",
        DB_NAME,
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `insert into task_types (workspace_id, name, color, position) values ('${workspaceId}', 'Sida', '#111111', 1);`,
      ]);

      // Sanity: the colliding shape is exactly what BX-1 describes
      // before anything runs against it.
      expect(
        scalar(
          DB_NAME,
          `select system_key from task_types where workspace_id = '${workspaceId}' and name = 'Page';`,
        ),
      ).toBe("page");
      expect(
        scalar(
          DB_NAME,
          `select coalesce(system_key, '<null>') from task_types where workspace_id = '${workspaceId}' and name = 'Sida';`,
        ),
      ).toBe("<null>");

      // 1) The historical defect reproduces exactly, against the real,
      // unmodified file — proving BX-1 is a real bug, not a theoretical
      // one, and guarding against a future edit of that file silently
      // "fixing" it in place (this feature's decision was deliberately
      // NOT to do that — see the corrective migration's own header
      // comment).
      const failure = psqlExpectFailure(DB_NAME, migrationPath(DEFECTIVE_WIDEN_FILE));
      expect(failure).toMatch(/23505|duplicate key value/);
      expect(failure).toMatch(/task_types_workspace_id_system_key_idx/);

      // The whole file runs as one implicit transaction (matching
      // scripts/apply-migration.mjs's own "post the whole file as one
      // query" behaviour) — a failure must leave no partial state.
      expect(
        scalar(
          DB_NAME,
          `select system_key from task_types where workspace_id = '${workspaceId}' and name = 'Page';`,
        ),
      ).toBe("page");
      expect(
        scalar(
          DB_NAME,
          `select coalesce(system_key, '<null>') from task_types where workspace_id = '${workspaceId}' and name = 'Sida';`,
        ),
      ).toBe("<null>");

      // 2) The corrective migration converges this database to head with
      // no error: the pre-existing tagged row is untouched, and the
      // untagged "Sida" row is deliberately left untagged rather than
      // erroring.
      psqlFile(DB_NAME, migrationPath(CORRECTIVE_FILE));

      expect(
        scalar(
          DB_NAME,
          `select system_key from task_types where workspace_id = '${workspaceId}' and name = 'Page';`,
        ),
      ).toBe("page");
      expect(
        scalar(
          DB_NAME,
          `select coalesce(system_key, '<null>') from task_types where workspace_id = '${workspaceId}' and name = 'Sida';`,
        ),
      ).toBe("<null>");

      // 3) Idempotent: a second run is a no-op, not an error.
      psqlFile(DB_NAME, migrationPath(CORRECTIVE_FILE));
    });

    it("side-effect: a workspace with no pre-existing tagged row still gets its lone untagged candidate tagged", () => {
      // Proves the corrective migration doesn't regress the original
      // widen migration's actual purpose — it only skips workspaces that
      // ALREADY have a tagged row; a workspace with none still converges
      // to a tagged page type.
      const workspaceId = scalar(
        DB_NAME,
        `insert into workspaces (name, slug) values ('F006h No-Tag Workspace', 'f006h-no-tag-workspace') returning id;`,
      );
      execFileSync("psql", [
        "-d",
        DB_NAME,
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `insert into task_types (workspace_id, name, color, position) values ('${workspaceId}', 'Sida', '#222222', 0);`,
      ]);

      psqlFile(DB_NAME, migrationPath(CORRECTIVE_FILE));

      expect(
        scalar(
          DB_NAME,
          `select system_key from task_types where workspace_id = '${workspaceId}' and name = 'Sida';`,
        ),
      ).toBe("page");
    });
  },
);
