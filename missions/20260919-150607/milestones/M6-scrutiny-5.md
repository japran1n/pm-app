# M6 Scrutiny — Pass 5

Verdict: **GREEN**

Scope of this pass: re-verification after commit `a240f8da`
(`let remainder` → `const remainder` in `tests/unit/m6-action-barrel-guard.test.ts`),
the single lint error that made pass 4 RED.

## Fix review

`a240f8da` is a one-token change. `remainder` is referenced at lines 172
(declaration) and 183 (read) only, never reassigned — which is why
`prefer-const` fired in the first place. The change is semantically inert;
no guard behaviour is altered. Verified by reading the full
`parseBarrelExports` body, not by trusting the diff stat.

## Assertion results

| ID | Result | Severity | Reason |
|---|---|---|---|
| AS-126 | PASS | — | Both guard files appear in the default suite: `npx vitest list --filesOnly` enumerates 856 files and includes `tests/unit/m6-check-value-guard.test.ts` and `tests/unit/m6-action-barrel-guard.test.ts`. Neither matches any `exclude` entry in `vitest.config.ts`. |
| AS-127 | PASS | — | Parser genuinely reads SQL. Mutation M6a/M6b (below) changed only migration files and the guard tracked the change bidirectionally, including honouring the *latest* redefinition — `20261121010000` omits `cms_template`, `20261124010000` re-adds it, and the guard reflects the later file. A hardcoded map cannot produce this. Confirms pass-4 closure. |
| AS-128 | PASS | — | Fails from both directions: dropping `"utility"` from the Zod enum and adding a bogus value each produce a concrete drift assertion naming `onlyInDb`/`onlyInZod`. |
| AS-129 | PASS | — | Same, via `SECTION_KINDS`: adding `"zzz"` produces `onlyInZod=["zzz"]` and a FAIL. |
| AS-130 | PASS | — | Whole-source export check holds after the lint fix. `export *` and `export default` each trip the "disallowed export the guard cannot enumerate" path with the correct message; an unreferenced export (`neverUsedGhostAction`) trips both the count check (24 vs 23) and the reference check. Confirms pass-4 closure. |
| AS-131 | PASS | — | CI gates on these files: `.github/workflows/ci.yml:64` runs `npx vitest run tests/unit`, which covers both guards. Every unparseable SQL shape throws rather than falling back; no silent-pass path. |
| AS-132 | PASS | minor | Guard behaviour verified live by mutation this pass rather than relying on the recorded evidence. The only outstanding item is cosmetic: `F040-handoff.md` still depicts the pre-F108 test file (FU-19, carried). Non-blocking per mission direction. |
| AS-133 | PASS | — | Stale-comment scenario re-confirmed: the M5 mutation (unreferenced export with the barrel comment left intact) fails the reference check, so comments cannot satisfy the guard. |
| AS-134 | PASS | — | Full grep of both guard files for `allowlist`, `guard-ignore`, `.skip`/`.todo`/`.only`/`skipIf`, `eslint-disable`, `ts-expect-error`/`ts-ignore`, and `try`/`catch`: no matches. No escape hatch, nothing exempted by name. |

No blockers. No majors.

## Independent mutation testing

Rather than accept the passing suite, I built a detached git worktree at
HEAD, applied seven mutations, and confirmed each one turns the suite red.
Two early mutation attempts (`M6`, a first AS-129 attempt) silently matched
zero lines — the suite stayed green for the wrong reason. Both were
re-run against the real source text; the green results from the no-op
attempts are discarded and not counted as evidence.

| # | Mutation | Expected | Observed |
|---|---|---|---|
| M1 | Drop `"utility"` from `pageKindEnum` | AS-128 FAIL | FAIL, `onlyInDb=["utility"]` |
| M2 | Add `"bogus"` to `pageKindEnum` | AS-128 FAIL | FAIL, `onlyInZod=["bogus"]` |
| M3 | Append `export *` to the barrel | AS-130 FAIL | FAIL, "disallowed export" |
| M4 | Append `export default` to the barrel | AS-130 FAIL | FAIL |
| M5 | Add unreferenced `neverUsedGhostAction` export | AS-130 FAIL | 2 FAIL (count + reference) |
| M6a | Add `'sqlonly'` to the latest migration CHECK | AS-128 FAIL | FAIL, `onlyInDb=["sqlonly"]` |
| M6b | Remove `'cms_template'` from the latest migration CHECK | AS-128 FAIL | FAIL, `onlyInZod=["cms_template"]` |

Worktree removed; `git status` on the main checkout shows no code, test, or
contract file modified by this review.

## Carried non-blocking items

Per mission direction these do not affect the verdict:

- **FU-19 (minor).** `F040-handoff.md`'s AS-132 output depicts the pre-F108
  test file. Evidence hygiene only; the assertion itself is satisfied by the
  shipping code, which I verified directly by mutation.
- **AS-006 baseline** was measured under multi-worker contention. Out of M6
  scope.
- **Exotic specifier aliasing** (non-idiomatic TS re-export forms) and **SQL
  comment stripping / compound-column** edge cases remain theoretical and are
  inert against today's migrations.

## Observation for the orchestrator (not a milestone blocker)

`missions/20260919-150607/validation-contract.md` does not exist. Assertion
text for AS-126…AS-134 had to be recovered from `plan.md` and from the
previous scrutiny reports rather than from an immutable contract. Hard rule 5
assumes a contract file; five passes of M6 have now been adjudicated without
one. Recommend a follow-up feature that transcribes AS-126…AS-134 verbatim
from the `features/F037…F040` files into a proper
`validation-contract.md` for this mission, so future passes grade against a
fixed source rather than against the previous reviewer's paraphrase. This
repeats FU-11/FU-20 from earlier passes and is the one systemic issue left in
M6.

## Gate output

### `npx tsc --noEmit`
Clean. No output, exit 0.

### `npx eslint <both guard files> --max-warnings 0`
Clean. No output, exit 0. (Pass 4's `prefer-const` error is resolved.)

### `npx vitest run <both guard files> --reporter=verbose`

```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 ✓ m6-check-value-guard.test.ts > AS-127: parser reads SQL files — unknown constraint throws even with real migrations 11ms
 ✓ m6-check-value-guard.test.ts > AS-128: pageKindEnum matches tasks_page_kind_check 9ms
 ✓ m6-check-value-guard.test.ts > AS-129: sectionKindEnum matches tasks_section_kind_check 8ms
 ✓ parser fixtures — runtime generated (AS-127) > parses IN(...) form from a single file 1ms
 ✓ parser fixtures — runtime generated (AS-127) > picks latest migration when redefined (widen via IN) 1ms
 ✓ parser fixtures — runtime generated (AS-127) > parses = ANY (ARRAY[...]) form 1ms
 ✓ parser fixtures — runtime generated (AS-127) > throws when last mention is a drop (drop without re-add) 1ms
 ✓ parser fixtures — runtime generated (AS-127) > throws on unknown constraint name against real migrations dir 11ms
 ✓ m6-action-barrel-guard.test.ts > AS-130 > parses the expected number of exported actions from the barrel 1ms
 ✓ m6-action-barrel-guard.test.ts > AS-130 > every exported architecture action has at least one real import/call reference outside the barrel, leaf modules, and tests 376ms

 Test Files  2 passed (2)
      Tests  10 passed (10)
   Duration  532ms
```

Pre-existing, unrelated to M6: a Vite `configLoader: 'native'` deprecation
warning about ESM-in-CJS in `vitest.config.ts` and
`tests/realtime-live-delivery-tests.ts`.
