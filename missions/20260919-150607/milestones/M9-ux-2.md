# M9 — UX validation report #2

Mission: 20260919-150607
Validator: ux-validator (pass 2)
Date: 2026-09-20
HEAD: `6ba2c793` — `fix(F135): add AS-179 test block + AS-182 traceability labels [AS-179, AS-182]`
Scrutiny at entry: GREEN (`missions/20260919-150607/milestones/M9-scrutiny-3.md`)
Prior UX pass: `missions/20260919-150607/milestones/M9-ux-1.md`

Deferred and excluded from the verdict per orchestrator instruction:
**AS-170, AS-171, AS-174** (Docker/CI infrastructure).

## Scope note (carried from pass 1)

M9 ships no new UI. Every assertion except AS-006 is a source-level or
file-content invariant that scrutiny owns. This pass re-verifies the gate,
confirms the two F135 fixes actually landed, and re-runs the app-boot smoke
check.

## Verdict on the two F135 fixes

**Both fixes are real, not cosmetic.**

- **AS-179** — `tests/unit/m9-regression.test.ts:138` now holds a genuine
  `it()` block, not just a `describe` title. It asserts (a) `resolveClientBucket`
  is still `export`ed from `components/portal/status-label.ts`, and (b)
  `tsconfig.json`'s `exclude` array does not contain `components/portal`.
  Runs green in isolation.
- **AS-182** — `tests/unit/m6-action-barrel-guard.test.ts:274` and `:278` now
  carry the `AS-182` label on both `it()`s. `grep "AS-182"` finds them.

Corroborating count: the full unit suite went **3340 → 3341 passing tests**,
exactly +1 — the new AS-179 block, and nothing else moved.

## Assertion table

| ID | Verdict | Evidence | Reproduction |
|---|---|---|---|
| AS-006 | **PASS** | `evidence/M9-2-tsc.txt`, `M9-2-eslint.txt`, `M9-2-migrations-check.txt`, `M9-2-vitest-unit-full.txt` | All four gate commands from repo root; each exits 0. Breakdown below. |
| AS-168 | PASS (code-level, not UX-observable) | `evidence/M9-2-vitest-m9-verbose.txt` | `npx vitest run tests/unit/m9-migration-headers.test.ts --reporter=verbose` → green. |
| AS-169 | PASS (code-level, not UX-observable) | `evidence/M9-2-vitest-m9-verbose.txt` | Same file, second `it()`. |
| AS-170 | *deferred — excluded* | — | Docker/CI. Not scored. |
| AS-171 | *deferred — excluded* | — | Docker/CI. Not scored. |
| AS-172 | PASS (code-level, not UX-observable) | `evidence/M9-2-vitest-m9-verbose.txt` | `npx vitest run tests/unit/m9-migration-check.test.ts` → green. |
| AS-173 | PASS (code-level, not UX-observable) | `evidence/M9-2-vitest-m9-verbose.txt` | Same file, second `it()`. |
| AS-174 | *deferred — excluded* | — | Types-regeneration freshness is a CI concern. Not scored. See "Residual risk". |
| AS-178 | PASS (code-level) | `evidence/M9-2-vitest-m9-verbose.txt` | `AS-178` byte-identity hash + `AS-178b` 16-case behaviour table, both green. |
| AS-179 | **PASS** (upgraded from INCONCLUSIVE) | `evidence/M9-2-as179-isolated.txt`, `evidence/M9-2-tsc.txt` | `npx vitest run tests/unit/m9-regression.test.ts --reporter=verbose` → the AS-179 `it()` is present and green. Independently, `npx tsc --noEmit` exits 0. |
| AS-180 | PASS (code-level, not UX-observable) | `evidence/M9-2-vitest-m9-verbose.txt` | Same file; AS-180 `it()` green. |
| AS-181 | PASS (code-level, not UX-observable) | `evidence/M9-2-vitest-m9-verbose.txt` | Same file; tree-wide scan `it()` green (190ms — it really walks the tree). |
| AS-182 | **PASS** (traceability gap closed) | `evidence/M9-2-vitest-m9-verbose.txt` | `grep "AS-182" tests/unit/m6-action-barrel-guard.test.ts` → 2 hits; both `it()`s green. |
| — (app boot) | **PASS** | `evidence/M9-2-app-boot.png` | Load `http://localhost:3000/` → 200, renders the "Project management, kept simple." landing with a working Sign in control. **0 console errors** (79 messages, 0 errors, 0 warnings). |

**Score (deferred excluded): 10/10 PASS + app-boot PASS. 0 FAIL, 0 INCONCLUSIVE.**

Pass 1's two INCONCLUSIVEs (AS-179, AS-182) are both resolved. No regressions.

## AS-006 — gate breakdown

Run from `/Users/sasajapranin/Desktop/pm-app` on HEAD `6ba2c793`:

| Command | Exit | Result |
|---|---|---|
| `npx tsc --noEmit` | **0** | No output. |
| `npx eslint . --max-warnings=0` | **0** | No output. |
| `npm run migrations:check` | **0** | `✓ No migration drift — all migrations present on remote.` (live remote Supabase check, not a stub.) |
| `npx vitest run tests/unit` | **0** | `504 passed \| 1 skipped (505)` files, `3341 passed \| 3 skipped (3344)` tests, 83.32s. |

## M9 suite in isolation

`npx vitest run tests/unit/m9-regression.test.ts tests/unit/m9-migration-headers.test.ts
tests/unit/m9-migration-check.test.ts tests/unit/m6-action-barrel-guard.test.ts
--reporter=verbose` → exit 0, **4 files / 11 tests passed** (was 10 in pass 1),
0 skipped, 0 todo. `grep "\.skip\|\.todo"` across the four files returns nothing,
so the green is not hollow.

## Residual risk (carried, unchanged)

1. **AS-179's test is a proxy, not a typecheck.** It verifies the *conditions*
   under which `components/portal` gets typechecked (exported symbol, not
   excluded in tsconfig) rather than typechecking it. That is a reasonable unit
   test, and the actual proof is `tsc --noEmit` exiting 0 in the same gate — so
   the assertion holds on combined evidence. Noting the mechanism so nobody
   later mistakes the unit test alone for full coverage.
2. **AS-172/AS-173 rest on the deferred AS-174.** Both assert a column is
   *absent* from `database.types.ts`. That is only meaningful if the file is
   regenerated from the live schema — which is AS-174, deferred. A stale file
   would pass both tests while the types diverged from the database.
   `migrations:check` passing against the real remote raises confidence that
   schema and migrations agree, but does not prove the types file is fresh.

## Suggested fixes (not applied — I do not modify code)

1. **FU-14 (carried, still open):** `package.json:13` is `"lint": "eslint"`
   while the gate runs `eslint . --max-warnings=0`. Both green today, so AS-006
   genuinely holds — but the loose local script will accept the next warning CI
   rejects.
2. **Missing validation contract (carried, still open):**
   `missions/20260919-150607/validation-contract.md` does not exist, so
   validators reconstruct assertion IDs from feature specs. This also means
   AS-numbers collide across missions — `grep -rn "AS-170\|AS-171\|AS-174" tests/`
   hits unrelated tests from a different mission's numbering.
3. **AS-174 needs a home** before AS-172/AS-173 can be considered fully sound.

## Cleanup

The dev server on port 3000 (PID 16493) predates this session; I did not start
it and have left it running, as in pass 1. Browser closed. No code, test,
migration or config file was modified — `git status --porcelain` shows only
mission markdown (`plan.md`, `CURRENT`) and untracked artefacts.

Evidence directory: `/Users/sasajapranin/Desktop/pm-app/missions/20260919-150607/milestones/evidence/`
