// F016f (missions/20260903-portal, M3-scrutiny-2 remediation): F016e
// silently reverted send_change_request_quote_atomic off client_gate one
// migration after F016d put it there, and separately dropped the sweep's
// `t.project_id = cd.project_id` join predicate while F016c's comment
// still claimed it. Both were restored by F016f
// (20261005010000_f016f_insert_hole_and_reverts.sql). This test does not
// assert behaviour through a live database — it reads the migration
// history statically so that a FUTURE silent revert (a later migration
// that replaces either function again and drops the predicate) fails
// this suite immediately, without needing Supabase credentials, rather
// than being discovered by the next scrutiny pass.
//
// "Silent" is the defect class: each prior revert compiled, ran, and
// passed every existing test. A grep over the whole migration history is
// the one check that cannot be fooled by "this individual migration file
// looks correct in isolation."

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

// Returns the full text of the LAST `create or replace function
// public.<name>(...)` statement for the given function name across every
// migration file, in migration order — i.e. the body that is actually
// applied to the database today, matching how Postgres itself resolves
// repeated `create or replace function` calls.
function latestFunctionBody(functionName: string): { file: string; body: string } {
  const marker = `create or replace function public.${functionName}(`;
  let found: { file: string; body: string } | null = null;

  for (const file of migrationFiles()) {
    const contents = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const idx = contents.indexOf(marker);
    if (idx === -1) continue;
    // Body runs from the marker to the closing `$$;` that ends the
    // `as $$ ... $$;` block — every function definition in this schema
    // uses that exact delimiter.
    const end = contents.indexOf("$$;", contents.indexOf("as $$", idx));
    if (end === -1) continue;
    found = { file, body: contents.slice(idx, end + 3) };
  }

  if (!found) {
    throw new Error(`no "create or replace function public.${functionName}(" found in any migration`);
  }
  return found;
}

describe("F016f: reverts stay reverted-back (client_gate routing, sweep join predicate)", () => {
  it("test_AS_047_send_change_request_quote_atomic_calls_client_gate_in_its_applied_body", () => {
    const { file, body } = latestFunctionBody("send_change_request_quote_atomic");
    expect(body).toMatch(/public\.client_gate\(/);
    // Regression guard on the file itself, not just the pattern: fails
    // loudly (naming the migration) if a later migration reverts this
    // again without updating this test's expectation.
    expect(file >= "20261005010000_f016f_insert_hole_and_reverts.sql").toBe(true);
  });

  it("test_AS_047_send_change_request_quote_atomic_wraps_its_update_in_the_triage_guard_bypass", () => {
    const { body } = latestFunctionBody("send_change_request_quote_atomic");
    expect(body).toMatch(/app\.client_requests_triage_guard_bypass/);
  });

  it("the sweep's applied join carries the same-project predicate F016c added", () => {
    const { body } = latestFunctionBody("sweep_overdue_blocking_deliverables");
    expect(body).toMatch(/join tasks t on t\.id = cd\.task_id and t\.project_id = cd\.project_id/);
  });
});
