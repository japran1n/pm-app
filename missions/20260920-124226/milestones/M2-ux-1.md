# M2 — UX validation (DB-layer)

M2 is a pure database milestone (two SQL migrations, no UI). No browser flow
exists to exercise; validation was performed at the DB/RLS layer by executing
the real integration suite against the live Supabase project
(`ALLOW_HOSTED_TESTS=1`, required because Docker is unavailable on this host
so `supabase start` could not provide a local stack).

Result: **PASS — M2 UX validation GREEN.**

## Assertions

| ID | Verdict | Evidence | Reproduction |
|----|---------|----------|--------------|
| AS-025 | PASS | `missions/20260920-124226/milestones/M2-evidence/rls-test-run.txt` (`test_AS_028_active_workspace_member_can_read_another_members_block`) | `set -a && . ./.env && set +a && ALLOW_HOSTED_TESTS=1 npx vitest run tests/integration/planner-block-rls.test.ts --reporter=verbose` |
| AS-026 | PASS | same file, `test_AS_026_member_can_read_block_attached_to_project_they_cannot_see` — seeds project with `visibility: "private"` via adminClient, other member reads it | as above |
| AS-027 | PASS (DB layer) | same file — AS-026 test asserts `data[0].title === "Block on private project"`, i.e. the real title is returned verbatim to a non-owner, no "Busy" substitution | as above |
| AS-028 | PASS | same file, `test_AS_028_non_member_cannot_read_any_workspace_blocks` and `..._unauthenticated_anon_client_reads_zero_rows_for_the_workspace` (both return `[]`) | as above |
| AS-032 | PASS | same file, four `test_AS_032_*` cases: update/delete/insert-for-another-owner all rejected, plus an admin-bypass case proving the row exists so RLS — not a missing row — blocked the write | as above |

8/8 tests passed.

## Pre-flight checks (all green)

1. `npm run migrations:check` → `✓ No migration drift — all migrations present on remote.` (`M2-evidence/db-checks.txt`)
2. `lib/supabase/database.types.ts` — zero `task_id` occurrences inside the `calendar_blocks` type.
3. `supabase/migrations/20261128010001_calendar_blocks_workspace_wide_select.sql` exists and references `is_active_workspace_member`.
4. `supabase/migrations/20261128010002_calendar_blocks_drop_task_id.sql` exists and contains `drop column if exists task_id;`.
5. `tests/integration/planner-block-rls.test.ts` exists; AS-026 case seeds via `adminClient` with `visibility: "private"`.

## Notes for the orchestrator (no code changed)

- Test-name drift: the AS-025 case is named `test_AS_028_active_workspace_member_can_read_another_members_block`, and the file header comments only list AS-028 and AS-032. The assertion is genuinely covered; only the label is wrong. Cosmetic.
- AS-027 has no dedicated test; it is proven incidentally by the AS-026 title assertion. A one-line title assertion in the AS-025 case would make it explicit.
- AS-027's UI half ("displays its real title" in the planner) is out of scope for M2 (no UI change) and should be re-validated in the milestone that ships the planner rendering.
- The suite silently **skips** rather than fails when pointed at a hosted project without `ALLOW_HOSTED_TESTS=1`: `tests/setup/testing-library.ts` throws, and the raw `npx vitest run ...` invocation reported "8 skipped / 1 passed file", which reads as green. Worth a guard so a skipped RLS suite cannot be mistaken for a passing one.

## Suggested fixes

- Rename the AS-025 test and update the file header comment to list AS-025/AS-026/AS-027.
- Add `expect(data?.[0]?.title).toBe(<seeded title>)` to the AS-025 case for an explicit AS-027 proof.
