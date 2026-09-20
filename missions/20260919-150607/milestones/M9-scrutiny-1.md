# M9 — Scrutiny report #1 (final milestone)

Mission: 20260919-150607
Validator: scrutiny-validator (adversarial, read-only)
Date: 2026-09-20
HEAD: 16c0e0a3

Features reviewed: F049 (AS-168, AS-169), F050 (AS-170…174), F051 (AS-006, AS-178…182).

## Verdict: **FAIL — milestone not green**

6 of 13 assertions fail. Three more are true in fact but guarded by tests that
cannot detect a violation. The dominant failure mode in this milestone is
**tests that certify today's file contents instead of the assertion's rule**:
several M9 tests are string-literal comparisons or hardcoded file lists that
would survive the exact regression they exist to prevent.

Note: this mission has **no `validation-contract.md`**. Assertion text was
recovered from the feature files under `missions/20260919-150607/features/`.
That is itself a process gap — Hard rule 5 presumes an immutable contract file
exists.

## Assertion table

| ID | Verdict | Severity | Reason |
|---|---|---|---|
| AS-168 | FAIL | major | Test hardcodes 2 of the mission's **3** migrations (misses `20261127120000_discipline_estimates_nullable_minutes.sql`, added by F073) and only checks the file starts with `--`; a bare `--` passes. "Explains why it exists" is untested. |
| AS-169 | FAIL | blocker | Test compares two string literals baked into the test (`"20261127130000" < "20261127140000"`). It never reads the directory and never classifies SQL as additive/destructive. It cannot fail. Adding an ADD COLUMN migration after a DROP still passes. |
| AS-170 | FAIL | blocker | No automated coverage. `scripts/check-migration-drift.mjs` exists but is invoked nowhere in CI; only its pure parser is unit-tested with `spawnSync` mocked. The live check is a one-off manual run recorded in a handoff. (I ran it: clean today.) |
| AS-171 | FAIL | major | `supabase db diff --use-migra` was **never successfully executed** — the F050 handoff records `LegacyImagePrepullError` (no Docker) and substitutes a `db:gen-types` byte-identity proxy, then labels the assertion PASS. No test, no run. |
| AS-172 | PASS | — | Mutation-tested: re-adding `description` to `page_components` Row, Insert, or Update is caught; `expect(match).not.toBeNull()` runs before the negative check so a formatting change fails loudly rather than vacuously passing. |
| AS-173 | PASS | — | Same, for `architecture_node_meta.client_visible`. Caveat: both rest on the types file being fresh, which is exactly what AS-174 fails to guarantee. |
| AS-174 | FAIL | blocker | No automated freshness check at all. A single manual `db:gen-types` + `git status` in a handoff. Nothing stops the types file drifting tomorrow; AS-172/173 are load-bearing on this unverified premise. |
| AS-006 | FAIL | blocker | tsc 0 ✅, lint 0 errors ✅, `migrations:check` 0 ✅ — but the test leg is red. `npx vitest run` (the `npm test` script): **263 failed files / 206 failed tests**. Scoped to `tests/unit`: **9 failed files / 30 failed tests** — matching the M8 baseline, so pre-existing, but the assertion says the suite passes and it does not. Not all failures are environmental (see below). |
| AS-178 | FAIL | major | Test is `expect(content).toContain("resolveClientBucket")` — a spelling check. It passes if the entire body is rewritten, the `pendingClientApproval` guard deleted, or the identifier survives only in a comment. The substance is true (independently git-verified: `git diff 985e8cbe..HEAD -- components/portal/status-label.ts` is empty; last touched 2026-09-03), but nothing guards the CLAUDE.md "must never be changed" rule. |
| AS-179 | PASS | minor | `tsconfig.json` includes `components/portal/**`; `tsc --noEmit` exits 0. No `next build` in the gate, so Next-specific build-time typing is unverified. |
| AS-180 | FAIL | blocker | The **positive** half ("still returns `page_kind`, `page_slug`, `page_components`") is asserted nowhere. `f004-board-query.test.ts` mocks `from`/`select` without ever inspecting the column string — deleting `page_kind` from `TASK_COLUMNS` (`lib/queries/architecture.ts:75`) leaves every test green while the board silently loses page kind. The negative regex `/\.description\b.*page_component/i` requires `.description` before `page_component` **on the same line**; the most likely regression, re-adding `description` to `COMPONENT_COLUMNS` (line 91), does not match. No plausible regression it would catch was constructible. |
| AS-181 | FAIL | major | Substance true (tree-wide grep: `setNodeMetaClientVisibility` appears only in mission markdown and `f034-…test.ts`), but the guard checks one file — the barrel. A component importing from `@/lib/actions/architecture/node-meta` directly bypasses it. The dropped-column half of the assertion is unguarded entirely. `f034-remove-set-node-meta-client-visibility.test.ts` partially compensates by asserting the export is `undefined`. |
| AS-182 | PASS | — | `m6-action-barrel-guard.test.ts` passes. `EXPECTED_ACTION_COUNT = 25` hand-verified correct (8+7+1+1+7+1); `git log -S` shows it has never been bumped. The companion test (every exported action has a bound import + call site outside barrel/leaves/tests) is genuinely well-built. |

## Non-environmental test failures inside the "pre-existing 9"

The brief framed the 9 failing `tests/unit` files as background noise. At least
some are real, offline-deterministic defects, not missing infrastructure:

- `tests/unit/watching-feed-query.test.ts` — `TypeError: supabase.rpc is not a function` (mock missing `rpc`; 2 tests). The test, as written, never exercises `getWatchedTasksForUser` past line 112.
- `tests/unit/f042-no-approval-lock-comments.test.ts` — AS-172 guard (mission `20260910-182104`) fails on the literal string `comment` appearing inside a JSX comment.
- `f019`, `f022`, `f027`, `f039`, `f251`, `personal-todo-list-realtime-wiring`, `undo-toast` — realtime/hook suites failing on `supabase.auth` undefined.

Separately, the **full** suite is far worse than `tests/unit` suggests: 263 failed
files across `tests/integration/**` and `__tests__/**`, mostly `fetch failed`
against an unreachable Supabase. Since `npm test` is `vitest run` (unscoped),
AS-006's test leg is red by the project's own definition of the suite, and the
scope discrepancy (505 files vs 866) means prior milestones' "suite is green
except 9" claims were measured on a subset.

## Recommended follow-up features

**FU-1 — Real migration-header guard (AS-168).** Replace the hardcoded
`MISSION_MIGRATIONS` array in `tests/unit/m9-migration-headers.test.ts` with
discovery: glob `supabase/migrations/*.sql` and select the mission's files by
git (`git log --diff-filter=A` restricted to commits touching
`missions/20260919-150607/`), or at minimum by timestamp range, so no future
migration escapes. Then raise the content floor above "starts with `--`":
require at least two comment lines or N non-punctuation characters, and require
the header to name at least one SQL object the migration actually touches
(parse table/column identifiers out of the statements and assert one appears in
the comment). Include `20261127120000_discipline_estimates_nullable_minutes.sql`,
which the current test omits.

**FU-2 — Ordering rule as an actual rule (AS-169).** Rewrite the AS-169 test so
it reads the migrations directory rather than comparing two literals. Classify
each mission migration's SQL as additive (`ADD COLUMN`, `CREATE TABLE`,
`CREATE POLICY`), destructive (`DROP COLUMN`, `DROP TABLE`, `DROP POLICY`), or
mixed, then assert `max(timestamp of additive) < min(timestamp of destructive)`.
Add a self-check that the classifier found at least one migration of each class,
so the test fails loudly rather than passing vacuously on an empty set. Verify
by mutation: a synthetic ADD COLUMN migration dated after the drops must turn
the test red.

**FU-3 — Types freshness in CI (AS-174, subsumes AS-170/171/172/173).** Add a CI
step that runs the project's `db:gen-types` script into a temp file and diffs it
against the committed `lib/supabase/database.types.ts`, failing on any
difference. This is the single highest-value missing check: it catches a dropped
column being re-added, a new column missing from the types, and general schema
drift, and it removes the regex fragility in `m9-migration-check.test.ts` as a
concern. In the same step, wire the already-written `npm run migrations:check`
into `.github/workflows/ci.yml` (the `ci` job already has the Supabase
credentials it needs) so AS-170 is enforced rather than attested.

**FU-4 — Byte-identity guard for `resolveClientBucket` (AS-178).** CLAUDE.md says
this function must never change; the current test only greps its name. Extract
the function's source text (parse from `export function resolveClientBucket` to
its matching closing brace) and compare a SHA-256 of the normalised body against
a hash constant checked into the test with a comment explaining that changing it
requires a CLAUDE.md amendment. Verify by mutation: flipping the
`category !== "done"` condition must turn the test red.

**FU-5 — Positive column assertions for the architecture query (AS-180).** Follow
the pattern already used in `lib/queries/architecture-details.select.test.ts`:
capture the actual string passed to `.select(...)` and assert it contains
`page_kind`, `page_slug`, and the expected `page_components` column set. Delete
the unmatchable `/\.description\b.*page_component/i` regex and replace it with a
parse of the `page_components` select string asserting `description` is not
among its columns, plus a scan of the row mappers for `.description` access.
Verify by mutation: removing `page_kind` from `TASK_COLUMNS` must turn the test
red (today it does not).

**FU-6 — Widen the removed-action guard (AS-181).** Change the AS-181 test from
reading one barrel file to a tree-wide scan of `app/**`, `components/**`, and
`lib/**` (excluding tests and mission markdown) for `setNodeMetaClientVisibility`
and for reads of the dropped columns `page_components.description` and
`architecture_node_meta.client_visible`, so a direct deep import cannot slip
past. Fold in the existing `f034` export-is-undefined check as the runtime half.

**FU-7 — Make the test-suite leg of AS-006 meaningful.** Decide and encode what
"the test suite" means: either fix the environment so `tests/integration/**` can
run (Supabase test project or a recorded-fixture harness), or scope `npm test`
to the suites that are expected to pass offline and move the rest to an explicit
`test:integration` script. Then fix the genuinely broken unit tests — at minimum
add `rpc` to the Supabase mock in `watching-feed-query.test.ts`, fix the
`supabase.auth` mock shared by the six realtime/hook suites, and narrow the
`f042` comment-detection scan so a JSX comment does not trip it. AS-006 cannot
be honestly marked PASS while a red suite is reclassified as acceptable in a
handoff.

---

# Appendix — full gate output

## `npx tsc --noEmit`
Exit 0. No output.

## `npm run lint`
```
> pm-app@0.1.0 lint
> eslint

/Users/sasajapranin/Desktop/pm-app/components/code-editor/editor-pane.tsx
  152:5  warning  Unused eslint-disable directive (no problems were reported from 'react-hooks/exhaustive-deps')

/Users/sasajapranin/Desktop/pm-app/scripts/check-cron-health.mjs
  159:9  warning  'cutoffIso' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/th-completion-providers.test.ts
  323:21  warning  'registered' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/th-editor-lazy.test.tsx
  13:61  warning  'opts' is defined but never used. Allowed unused args must match /^_/u  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/th-link-interception.test.tsx
  34:3  warning  Unused eslint-disable directive (no problems were reported from 'no-new-func')

/Users/sasajapranin/Desktop/pm-app/tests/unit/th-monaco-editor.test.tsx
  157:7  warning  'configureMonacoCalledBeforeFirstMount' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/th-origin-guard.test.ts
  24:3  warning  Unused eslint-disable directive (no problems were reported from 'no-new-func')

✖ 7 problems (0 errors, 7 warnings)
  0 errors and 3 warnings potentially fixable with the `--fix` option.
```
Exit 0 (0 errors).

## `npm run migrations:check`
```
> pm-app@0.1.0 migrations:check
> node --env-file=.env scripts/check-migration-drift.mjs

✓ No migration drift — all migrations present on remote.
```
Exit 0.

## `npx vitest run` (full suite — what `npm test` runs)
```
 Test Files  263 failed | 601 passed | 2 skipped (866)
      Tests  206 failed | 4566 passed | 1696 skipped (6468)
   Duration  181.52s
```
Exit 1. Failing files outside `tests/unit` (truncated sample):
```
 FAIL  __tests__/api/webflow-css-route.test.ts
 FAIL  tests/integration/add-comment.test.ts
 FAIL  tests/integration/archive-project.test.ts
 FAIL  tests/integration/archive-view.test.ts
 FAIL  tests/integration/assign-task.test.ts
 FAIL  tests/integration/assignee-backfill.test.ts
 FAIL  tests/integration/assignee-ids-query-wiring.test.ts
 FAIL  tests/integration/audit-log-filters.test.ts
 FAIL  tests/integration/audit-log-writer.test.ts
 FAIL  tests/integration/board-columns-render.test.ts
 FAIL  tests/integration/board-reload-persistence.test.ts
 FAIL  tests/integration/board-tasks-completion.test.ts
 FAIL  tests/integration/bulk-delete-tasks.test.ts
 FAIL  tests/integration/bulk-restore-tasks.test.ts
 FAIL  tests/integration/bulk-update-tasks.test.ts
 FAIL  tests/integration/calendar-blocks-crud.test.ts
 FAIL  tests/integration/change-member-role.test.ts
 FAIL  tests/integration/change-workspace-slug.test.ts
 FAIL  tests/integration/checklist-actions.test.ts
 FAIL  tests/integration/client-comments-rls.test.ts
 FAIL  tests/integration/client-requests-rls.test.ts
 FAIL  tests/integration/client-role-rls.test.ts
 FAIL  tests/integration/comment-reactions-schema.test.ts
 FAIL  tests/integration/create-project.test.ts
 FAIL  tests/integration/create-task.test.ts
 FAIL  tests/integration/create-workspace-owner.test.ts
 FAIL  tests/integration/custom-fields-and-blocked-reason.test.ts
 FAIL  tests/integration/dashboard-list-tasks-rls-cross-workspace.test.ts
 FAIL  tests/integration/dashboard-rls-cross-workspace.test.ts
 FAIL  tests/integration/dashboard-task-table-filters.test.ts
 ... (233 more)
```
Predominant cause in this group: `fetch failed` — no reachable Supabase instance.

## `npx vitest run tests/unit` (the scope prior milestones measured)
```
 Test Files  9 failed | 495 passed | 1 skipped (505)
```
Failing files:
```
 FAIL  tests/unit/f019-my-tasks-realtime-hook-set-identity.test.tsx   (2 tests)
 FAIL  tests/unit/f022-board-realtime-guard-call-site.test.tsx        (4 tests)
 FAIL  tests/unit/f027-calendar-realtime-wiring.test.tsx              (7 tests)
 FAIL  tests/unit/f039-portal-guards.test.ts                          (3 tests)
 FAIL  tests/unit/f042-no-approval-lock-comments.test.ts              (1 test)
 FAIL  tests/unit/f251-list-table-realtime.test.tsx                   (2 tests)
 FAIL  tests/unit/personal-todo-list-realtime-wiring.test.tsx         (7 tests)
 FAIL  tests/unit/undo-toast.test.tsx                                 (1 test)
 FAIL  tests/unit/watching-feed-query.test.ts                         (2 tests)
```
Matches the M8-scrutiny-2 baseline (9 files / 30 tests) — pre-existing, but red.

## M9 feature tests in isolation
```
npx vitest run tests/unit/m9-migration-headers.test.ts \
  tests/unit/m9-migration-check.test.ts \
  tests/unit/m9-regression.test.ts \
  tests/unit/m6-action-barrel-guard.test.ts

 Test Files  4 passed (4)
      Tests  9 passed (9)
   Duration  613ms
```
All green — and, per the table above, several of them are green for the wrong reasons.
