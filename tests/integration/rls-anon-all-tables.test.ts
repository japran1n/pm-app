// Consolidated audit test for F079 (AS-137, AS-138, AS-139).
//
// Every prior RLS test (rls-workspaces, rls-projects, rls-tasks,
// rls-comments, rls-attachments) already asserts anon-zero-rows per table
// individually. This file is the single consolidated check required by
// F079: for EVERY workspace-scoped table in the schema, in one place, an
// anon-key-only (no session) SELECT must return zero rows, never an error.
//
// If a future migration adds a new workspace-scoped table without RLS (or
// with a policy that leaks rows to anon), this is the one file that catches
// it without having to remember to touch five different test files.
//
// Skips (rather than fails) when Supabase credentials aren't present in the
// environment, matching the pattern used by every other RLS integration
// test in this repo.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  const contents = readFileSync(path, "utf8");
  for (const line of contents.split("\n")) {
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const haveCoreCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY);
if (process.env.CI && !haveCoreCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveCoreCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

// Every workspace-scoped table currently defined in supabase/migrations/,
// cross-checked against every `create table` statement in the migration
// history as of F079 (AS-137 audit):
//   - workspaces              (20260817222532_create_workspaces.sql)
//   - workspace_members       (20260817222532_create_workspaces.sql)
//   - projects                (20260818004413_create_projects.sql)
//   - tasks                   (20260818013434_create_tasks.sql)
//   - comments                (20260818040214_create_comments.sql)
//   - attachments             (20260818050100_create_attachments.sql)
// All six have `alter table ... enable row level security;` in their
// respective migrations — see rls-workspaces.sql, rls_projects.sql,
// rls_tasks.sql, comments create migration, rls_comments, and
// create_attachments.sql.
const WORKSPACE_SCOPED_TABLES = [
  "workspaces",
  "workspace_members",
  "projects",
  "tasks",
  "comments",
  "attachments",
] as const;

describe.skipIf(!haveCoreCreds)(
  "AS-137/AS-138: RLS audit — anon key returns zero rows across every workspace-scoped table",
  () => {
    let anonClient: SupabaseClient;

    beforeAll(() => {
      anonClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
    });

    it.each(WORKSPACE_SCOPED_TABLES)(
      "AS-137/AS-138: anon/publishable key with no session reading `%s` returns zero rows, not an error",
      async (table) => {
        const { data, error } = await anonClient.from(table).select("*");
        expect(error).toBeNull();
        expect(data).toEqual([]);
      },
    );
  },
);
