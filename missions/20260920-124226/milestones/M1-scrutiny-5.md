# M1 scrutiny — pass 5

Mission: 20260920-124226 · Milestone M1 (F002–F007, re-verified after F042–F052)
Date: 2026-09-20 · Reviewer: scrutiny validator (adversarial, read-only).
No project file was modified — all mutants were written to the session scratchpad and run
against the **real, unmodified** test files via a scratchpad vitest config that aliases
`@/lib/calendar/*` to the mutant copy. `git status --porcelain lib tests` clean.

## Verdict: GREEN

Zero FAILs among non-deferred assertions. Both pass-4 blockers are killed by mutation, not
by reading. Six rendering assertions remain INCONCLUSIVE by design and are gated at F031/F033.

---

## 1. AS-003 — fixed, verified by mutation

`tests/unit/planner-people-selection.test.ts:167-201` (F052) adds four fixtures with
`selfId: "member-c"`, `activeMemberIds: ["member-a","member-b","member-c"]` — self is now
**last**, so "the signed-in member" and "roster[0]" are distinguishable.

Mutants run against the real suite (baseline 35/35 green):

| Mutant | Result |
|---|---|
| `"me"` branch → `return [activeMemberIds[0] ?? selfId]` | **1 failed** / 34 passed — killed |
| no-param/empty branch → `return [activeMemberIds[0] ?? selfId]` | **2 failed** / 33 passed — killed |
| all three self-returning paths mutated at once | **4 failed** / 31 passed — killed |

Pass 4's exact mutant (31/31 green) no longer survives. The parallel reviewer reached the
same conclusion independently.

## 2. AS-008 — fixed, verified by mutation

| Mutant | Result |
|---|---|
| all-invalid fallback → `return [activeMemberIds[0] ?? selfId]` | **1 failed** / 34 passed — killed |
| fallback → `return []` | 5 failed — killed |

The fallback is now pinned to *self*, not to an index.

## 3. AS-022 — no regression

Direct execution of `toUtcMs` / `clipBlockToStackedWindow` (Wed 2026-09-23):

```
…T09:00:00+00:00  -> 09:00Z   …T09:00:00+02:00 -> 07:00Z   …T09:00:00-05:00 -> 14:00Z
…T09:00:00Z       -> 09:00Z   …T09:00:00       -> 09:00Z   2026-09-23 09:00:00 -> 09:00Z
…T09:00:00+0000   -> 09:00Z   …T09:00:00.123456+00:00 -> 09:00:00.123Z
…T09:00:00+00     -> NaN -> []   <-- residual gap, unchanged, still `major` not blocker
```

Mutant "always append `Z`" (the original F046 bug) kills 16 tests. Clipping mutants (no start
clip / no end clip) kill 5 each. No regression.

## 4. AS-058 — no regression

Comparator mutants all killed: no-self-first (8), self-last (8), sort-by-id (3), no-sort (5),
nulls-first (3), codepoint-instead-of-locale (2), descending (4). The id-inverted fixtures
from F050 are still present and still have teeth.

## Assertion table

| ID | Result | Reason |
|---|---|---|
| AS-003 | **PASS** | F052 fixtures with `selfId="member-c"`; `"me"` → `[roster[0]]` mutant now kills 1 test. Pass-4 blocker resolved. |
| AS-004 | PASS | `all` → full roster; sorted / `[selfId]` / minus-self / case-sensitive mutants each killed. |
| AS-005 | PASS | Prepend-self (7 kills) and keep-invalid (5 kills). |
| AS-006 | PASS | Same, plus `.sort()` mutant (3 kills). |
| AS-007 | PASS | keep-invalid kills 5; any-invalid→self-only kills 1. |
| AS-008 | **PASS** | Fallback → `[roster[0]]` mutant kills 1; → `[]` kills 5. Pass-4 blocker resolved. |
| AS-009 | PASS | `result.sort()` kills 3; test asserts `not.toEqual` the sorted form. |
| AS-010 | PASS | dedupe-keep-last kills 1; adjacent and non-adjacent duplicates covered. |
| AS-015 | DEFERRED | Re-homed to F031 by F044 per AUTONOMOUS_DECISION (run-log.md:54). Not counted. Must be a hard gate at F031. |
| AS-016 | INCONCLUSIVE | `resolvePlannerLayout` is mutation-covered (`<=1`→`<=2` kills 1; always-"stacked" kills 2) but has zero production callers. Rendering claim; settle at F031. |
| AS-017 | INCONCLUSIVE | Same. Settle at F031. |
| AS-018 | INCONCLUSIVE | Hour constants mutation-covered (8→7 and 16→17 kill 5 each), but nothing renders eight hour rows. Settle at F033. |
| AS-019 | INCONCLUSIVE | `STACKED_DAYS += 6` kills 3; removing the weekday filter kills 3. No five-column renderer. Settle at F033. |
| AS-020 | INCONCLUSIVE | Overlap guard mutation-covered (2 kills), but `toEqual([])` still cannot distinguish "correctly excluded" from "failed to parse". No renderer. Settle at F033. |
| AS-021 | INCONCLUSIVE | Weekend exclusion verified and mutation-covered; same `[]` ambiguity, no renderer. Settle at F033. |
| AS-022 | INCONCLUSIVE | Clipping correct and strongly mutation-covered; `±HH:MM` offsets verified by execution. Held INCONCLUSIVE only for consistency with AS-020/021 — nothing renders a stacked layout. Settle at F033. |
| AS-058 | PASS | Seven distinct comparator mutants killed; output order-stable under input permutation. |
| AS-072 | PASS | Three pure-helper unit files, 61 tests, all green; discrimination proven by the mutation campaign above rather than by green status. |

**Non-deferred FAILs: 0. Verdict GREEN.**

## Open findings (none blocking; no assertion currently owns them)

| Finding | Severity | Where |
|---|---|---|
| Both M1 modules are **orphaned** — `grep` finds no production importer of `parsePeopleParam`, `serializePeopleParam`, `orderPeopleForWholeTeam`, `resolvePlannerLayout`, `clipBlockToStackedWindow`, or the `STACKED_*` constants. Expected for a pure-logic milestone, but it means every M1 PASS is a *module-level* PASS. The URL/auth supply path where AS-003/AS-007 actually live is untested. This is the real gate at F031/F033. | major | repo-wide |
| `+00` / `-05` two-digit offsets → `NaN` → silent `[]`. `EXPLICIT_OFFSET_RE` requires four offset digits; its in-code rationale ("a bare `-05` date fragment") is wrong, since a date-only ISO string never ends in `[+-]dd`. Not on the PostgREST path. Carried from pass 4. | major | `stacked-window.ts:28` |
| Three conditions — unparseable timestamp, inverted interval, genuine non-overlap — all collapse to `[]` with no throw and no log. Mutating `if (end <= start) return []` → `if (false)` and the NaN guard → `if (false)` both **survive** 26/26: no test exercises malformed or inverted input at all. Carried from pass 4. | major | `stacked-window.ts:52-57` |
| Unbounded day loop: a corrupt `ends_at` in year 9999 produces ~2.9M iterations and ~2M segments synchronously on the render path. | major | `stacked-window.ts:68-72` |
| `selfId` is never validated against `activeMemberIds`; three paths can emit a non-active id from a stale session. Carried since pass 2. | major | `people-selection.ts:37,47,69` |
| Ids are matched case-sensitively but `me`/`all` are lowercased — two normalisation policies in one function. Mutating `raw.split(",")` → `normalized.split(",")` **survives** 35/35; every fixture id is lowercase. | minor | `people-selection.ts:41,58` |
| Removing `s.replace(" ", "T")` **survives** 26/26 — V8's fallback parser accepts the space form, so the two "space-separated" tests are tautological on Node. | minor | `stacked-window.ts:34` |
| Removing the `a.id` tiebreak in the null/null branch **survives** 35/35 — no fixture has two null-named members or two identical names. | minor | `people-selection.ts:96-98` |
| `orderPeopleForWholeTeam` does not dedupe, and silently drops the self-first rule when `selfId` is absent from `members`. | minor | `people-selection.ts:91-92` |
| `serializePeopleParam([], selfId)` → `""`, which round-trips back to `[selfId]`. No round-trip property test; no escaping for comma-bearing ids. | minor | `people-selection.ts:79-84` |
| `clipBlockToStackedWindow(null)` throws `Cannot read properties of null` despite a NaN guard two lines below. | minor | `stacked-window.ts:36` |
| A member whose id is literally `"me"` or `"all"` can never be selected alone. Harmless with UUIDs. | minor | `people-selection.ts:46-53` |
| AS-004's test pins `toEqual(ACTIVE_MEMBER_IDS)` (input order), which silently disagrees with AS-058's ordering rule. Nothing reconciles the two; since nothing calls either function, no code decides which wins. | minor | test:AS-004 |
| Microsecond precision truncated to ms without comment; the test encodes the lossy value as intended behaviour. | minor | `stacked-window.ts` / test |

## Recommended follow-up features

**F053 — Accept two-digit UTC offsets in `toUtcMs`.** `EXPLICIT_OFFSET_RE` demands four offset
digits, so `2026-09-23T09:00:00+00` and PostgreSQL's default text form
`2026-09-23 09:00:00+00` fail the guard, get a spurious `Z` appended, become `Invalid Date`,
and are silently dropped as `[]`. Widen the minute group to optional —
`/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i` — correct the stale in-code rationale about "a bare `-05`
date fragment" (a date-only ISO string never ends in `[+-]dd`), and add regression cases for
`+00`, `-05`, and the space-separated `+00` form alongside the existing `+00:00` block.
Carried from pass 4, unimplemented. Hardens AS-020/021/022. Non-blocking.

**F054 — Stop `[]` from meaning four different things, and bound the day loop.**
`clipBlockToStackedWindow` returns the same empty array for unparseable timestamps, inverted
intervals, and genuine non-overlap, with no throw and no log — this is what let the F046
regression survive a whole scrutiny pass and what keeps AS-020/021 unsettleable by
`toEqual([])`. Two mutants prove the point: deleting the NaN guard and deleting the
`end <= start` guard each leave 26/26 green, i.e. no test exercises malformed input at all.
Make parse failure observable (throw, or return a discriminated result), add a runtime guard
for `null`/`undefined` input, add tests asserting a malformed timestamp is *not* silently
treated as out-of-window, and cap the per-day loop to the visible week so a corrupt far-future
`ends_at` cannot spin millions of synchronous iterations on the render path.

**F055 — Validate `selfId` against the active roster.** `parsePeopleParam` returns `[selfId]`
from three paths without ever checking that `selfId` names an active member, so a stale
session can produce a selection containing a non-active id — the precise outcome AS-007
forbids for ids arriving via the URL. Decide and encode the contract: either document that
`selfId` is a trusted caller invariant and assert it in the type/JSDoc, or filter it through
`activeMemberIds` and define what an empty result means. Add tests for `selfId` absent from
the roster across all three paths. Carried from pass 4, unimplemented.

**F056 — Close the surviving non-assertion mutants in the M1 suites.** Three mutants survive
today: (a) swapping `raw.split(",")` for `normalized.split(",")` — every fixture id is
lowercase, so a case-lowering regression on ids would ship silently; add a mixed-case id
fixture; (b) removing the `a.id` tiebreak in the null/null name branch of
`orderPeopleForWholeTeam` — add fixtures with two null-named members and with two identical
non-null names; (c) removing `s.replace(" ", "T")` — V8's lenient fallback parser makes the
two "space-separated" tests tautological, so pin the normalisation directly rather than
through `Date`. Test-only; no production code changes.

**F057 — Reconcile AS-004's ordering with AS-058's.** The AS-004 test asserts
`toEqual(ACTIVE_MEMBER_IDS)`, pinning the caller's array order, while AS-058 mandates
self-first-then-alphabetical for the whole team. Both are green because nothing calls either
function. Before F031 wires `?people=all` to a renderer, decide which ordering the "whole
team" selection carries, document it in both modules, and relax or re-pin whichever test is
over-specified.

---

## Gate output

### `npx tsc --noEmit`

```
(no output)
EXIT 0
```

### `npx eslint . --max-warnings=0`

```
(no output)
EXIT 0
```

### `npm run migrations:check`

```
> node --env-file=.env scripts/check-migration-drift.mjs
✓ No migration drift — all migrations present on remote.
EXIT 0
```

### `npx vitest run tests/unit`

```
 Test Files  41 failed | 466 passed | 1 skipped (508)
      Tests  133 failed | 3270 passed | 3 skipped (3406)
   Duration  104.01s
```

Baseline at F001 (run-log.md:19, HEAD 3b92c53e): **41 files failed, 133 tests failed**,
recorded as pre-existing noise by AUTONOMOUS_DECISION. Failure counts identical to baseline
and to pass 4; passing count is +4 over pass 4, exactly the four tests F052 added. The
mission has introduced no new unit-test failure.

### M1 helpers in isolation

```
npx vitest run tests/unit/planner-stacked-window.test.ts \
               tests/unit/planner-people-selection.test.ts \
               tests/unit/planner-layout.test.ts

 Test Files  3 passed (3)
      Tests  61 passed (61)
   Duration  177ms
```

(57 at pass 4, +4 from F052.)

### Mutation campaign summary

`people-selection.ts` — 14 mutants built, 12 killed, 2 survived (both outside the nine
assertions; see findings table).
`stacked-window.ts` + `planner-layout.ts` — 15 mutants built, 11 killed, 4 survived (all
outside the seven assertions; see findings table).
Every mutant targeting an M1 assertion was killed.
