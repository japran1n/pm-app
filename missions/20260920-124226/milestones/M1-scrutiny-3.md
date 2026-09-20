# M1 scrutiny — pass 3

Mission: 20260920-124226 · Milestone M1 (F002–F007, re-verified after F045/F046)
Date: 2026-09-20 · Reviewer: scrutiny validator (adversarial, read-only). No files modified.

## Verdict: RED

Pass 2's two named FAILs were addressed, but only one of them actually landed:

- **AS-004 is genuinely fixed.** `ALL`, `all,,`, `" all "` all resolve to the
  full roster now, and each has a test that fails if the normalisation
  regresses. Confirmed by direct execution.
- **AS-058 is not fixed.** The `undefined` guard and the explicit `"en"` locale
  landed, but the new `Öl`/`Pa` fixture is still non-discriminating in the way
  that matters. Mutation-tested: replacing the whole comparator with
  `a.id.localeCompare(b.id)` — ignoring `name` entirely — leaves **all five**
  AS-058 tests green, because every fixture's ids happen to be co-ordered with
  its names. The suite cannot tell sort-by-name from sort-by-id.
- **F046 introduced a new blocker that is worse than the bug it fixed.** The
  offset-less/TZ problem is solved, but `toUtcMs` now silently destroys the one
  timestamp format the database actually returns.

Two independent reviewers, given only the code and the assertion text, reached
the `+00:00` finding separately.

## The new blocker (F046 regression)

`lib/calendar/stacked-window.ts:26`

```ts
const normalised = /[Z+\-]\d*$/.test(s) ? s : s.replace(" ", "T") + "Z";
```

A canonical ISO offset ends in `:00`, so `\d*$` cannot reach the `+`/`-`. The
guard misses, `"Z"` is appended to a string that already carries an offset, the
result is unparseable, `Number.isNaN` fires, and the function returns `[]` —
no throw, no log. Executed against the real module:

```
2026-09-23T09:00:00+00:00  ->  []      (was correct before F046)
2026-09-23T11:00:00+02:00  ->  []
2026-09-23T05:00:00-05:00  ->  []
2026-09-23T09:00:00.000Z   ->  [ ... ] (ok)
2026-09-23T09:00:00        ->  [ ... ] (ok — this is what F046 set out to fix)
2026-09-23 09:00:00        ->  [ ... ] (ok)
```

`+00:00` is exactly what PostgREST emits for a `timestamptz`, and this repo
already proves it: `tests/integration/calendar-blocks-crud.test.ts:288` asserts
`expect(updated.data.startsAt).toBe("2026-04-03T09:00:00+00:00")`. So every
block loaded from Supabase would vanish from the stacked layout. The unit suite
cannot see it because all 17 fixtures are hand-written with `Z`.

Note the near-miss that hides it on a read-through: the compact forms `+0200`
and `+00` *do* match the regex and work. Only the colon-bearing canonical
offset fails.

Three distinct conditions — unparseable input, reversed interval, and genuine
non-overlap — all collapse to the same unobservable `[]`. That is what lets
this hide.

## Assertion table

| ID | Result | Reason |
|---|---|---|
| AS-003 | PASS | `"me"` → `[selfId]`, falsifiable test. Minor hole: `"me,member-a"` drops `me`. |
| AS-004 | PASS | **Pass-2 FAIL resolved.** `.trim().replace(/[,\s]+$/g,"").toLowerCase()` handles `ALL`, `all,,`, `" all "`, `"ALL,"`; each has its own test. Caveat: the roster fixture is already alphabetical, so the test cannot distinguish "roster order" from "sorted" — order is not part of the assertion text, so this is noted, not counted. |
| AS-005 | PASS | Single valid id returns exactly that id, distinct from selfId. |
| AS-006 | PASS | Comma list returns exactly the listed valid ids in order. |
| AS-007 | PASS | Unknown ids dropped via `activeSet.has`; survivors kept; no throw. |
| AS-008 | PASS (major caveat) | Fallback works for all-invalid, `",,,"`, and empty roster. Unchanged defect: `selfId` is still never validated against `activeMemberIds` — `parsePeopleParam("bogus", {selfId:"ghost", activeMemberIds:["a"]})` → `["ghost"]`, emitting a non-active id and contradicting AS-007. Untested. |
| AS-009 | PASS | `z,a,b` stays `z,a,b`; test asserts `not.toEqual(["a","b","z"])`. Strongest test in the file. |
| AS-010 | PASS | Adjacent and non-adjacent duplicates both collapse, first occurrence wins. Hole: the `all` path does not dedupe — a duplicated roster returns duplicates. |
| AS-015 | DEFERRED | Per AUTONOMOUS_DECISION in run-log.md line 54, re-homed to F031. No Planner route exists, so the assertion cannot be stated at the pure-logic layer. Not counted against this pass. Must be a hard gate at F031. |
| AS-016 | INCONCLUSIVE | `resolvePlannerLayout(1) === "week-grid"` mirrors a one-line ternary. Repo-wide grep finds no consumer: nothing renders a week grid, and no code reads `?people=`. Downgraded from pass 2's "PASS (fragile)" — with a third pass on the books, asserting a rendering claim against a bare integer is not evidence. `NaN` → `"stacked"`, negatives → `"week-grid"`, both untested. |
| AS-017 | INCONCLUSIVE | Same as AS-016 for `>= 2`. |
| AS-018 | INCONCLUSIVE | `STACKED_START_HOUR === 8` / `=== 16` restates the constants' own literals. Nothing renders eight hour rows. Settle at F033. |
| AS-019 | INCONCLUSIVE | `STACKED_DAYS === [1,2,3,4,5]` restates the literal. Nothing renders five day columns. Settle at F033. |
| AS-020 | INCONCLUSIVE | Correct for `Z`-suffixed input, but on real `+00:00` data the helper returns `[]` for *every* block — the assertion would pass for entirely the wrong reason. A regression making the helper return `[]` unconditionally keeps every AS-020 test green. |
| AS-021 | INCONCLUSIVE | Same vacuous-pass hazard: both weekend tests survive an unconditional-`[]` mutant. The Mon–Fri derivation itself is correct (verified: Sun 22:00Z→Mon 10:00Z, Fri 15:00Z→Sat 09:00Z, Sat, Sun). |
| AS-022 | **FAIL (blocker)** | Clipping arithmetic is correct, but the new `toUtcMs` returns `[]` for `+00:00`/`±HH:MM` offsets — the format the database returns. Nothing partly overlapping the window is rendered clipped; nothing is rendered at all. Net regression against pass 2, where these inputs worked. |
| AS-058 | **FAIL (major)** | Mutation-tested 0/5 kill rate: swapping the comparator for `a.id.localeCompare(b.id)` leaves all five tests green, because `{b:"Bob",a:"Alice",c:"Charlie"}`, `{n:null,a:"Alice"}` and `{pa:"Pa",oel:"Öl"}` are all id-alphabetical too. The locale fix and the `== null` guard are correct in the code, but nothing pins them. Separately, `sensitivity:"base"` returns `0` for case/accent ties, so ordering still depends on input row order: `[{x,"bob"},{y,"Bob"}]` → `["x","y"]`, reversed input → `["y","x"]`; `Arla`/`Ärla` → `["ae","ar"]` (input order). For a DB query with no `ORDER BY` that is not a deterministic order. Duplicate self rows still emit a duplicate id. |
| AS-072 | PASS (caveat) | The three helper groups are unit-tested and green (48 tests, up from 42). Labels remain accurate. Caveat: "covered by unit tests" is satisfied literally, but this pass shows three of those covers (AS-058, AS-020/021, AS-018/019) are non-falsifiable, and AS-015 has no test. |

Summary: 9 PASS · 2 FAIL · 6 INCONCLUSIVE · 1 DEFERRED.

GREEN requires all non-deferred assertions to PASS. **RED.**

## Failures by severity

**Blocker**
- **AS-022 — `toUtcMs` destroys `±HH:MM` offsets.** Silent `[]` on the exact
  format Supabase returns. A regression introduced by F046 that did not exist in
  pass 2. Nothing in the suite can see it.

**Major**
- **AS-058 — the tests cannot fail.** 0/5 mutation kill rate against an
  id-sorting comparator. Case/accent ties remain input-order-dependent.
  Duplicate self rows unhandled.
- **AS-008 — `selfId` never validated** against `activeMemberIds`; the fallback
  can emit a non-member.
- **AS-016/017/018/019/020/021 remain unrenderable.** Six of eighteen assertions
  have now gone three passes without a consumer. `grep -rn` for
  `clipBlockToStackedWindow|parsePeopleParam|orderPeopleForWholeTeam|resolvePlannerLayout|STACKED_`
  across `app components lib hooks` returns only `lib/calendar/` and the tests.
  Deferring them to F031/F033 is defensible once; at pass 3 it is a milestone
  structure problem — M1 as scoped cannot be validated.
- **Test-process TZ leak.** `afterAll(() => { process.env.TZ = originalTz })`
  assigns the *string* `"undefined"` when TZ was unset. Verified: Node treats it
  as an invalid zone and falls back to UTC, so every later test file in the same
  worker silently runs under UTC instead of local time. This masks TZ bugs
  elsewhere in the repo (e.g. `lib/calendar/block-datetime.ts`, which is
  entirely `getHours`/`getFullYear`-based).
- **UTC/local semantic split.** `block-datetime.ts` builds instants from local
  wall-clock; `stacked-window.ts` clips in UTC. A Stockholm 09:00 block is
  `07:00Z` in summer (clipped away) and `08:00Z` in winter (survives). The
  header comment pushes conversion onto "callers"; there are none.

**Minor**
- Unbounded day loop: a block spanning to year 9999 iterates millions of times
  on the render path. No segment cap.
- Date-only `"2026-09-23"` is accepted and silently becomes a full 08:00–16:00
  working day.
- Lowercase `z` suffix (`2026-09-23t09:00:00z`) → `[]`.
- `",all"` is not recognised while `"all,"` is — the strip is trailing-only.
- Ids are matched case-sensitively while literals are lowercased: `"MEMBER-B"`
  silently falls back to self.
- A member whose id is literally `"me"` or `"all"` is unselectable.
- `serializePeopleParam([], selfId)` → `""`; `(["me"], "other")` → `"me"` → a
  different person. No round-trip property test.
- The `describe("TZ invariance")` block cannot fail on its own terms — the
  function uses only `Date.UTC`/`getUTC*`/`toISOString`, so no `TZ` value can
  change its output. It does discriminate the F046 fix against the old plain
  `new Date` (confirmed: runtime `process.env.TZ` assignment takes effect in
  this Node), so it is not worthless, but it is narrower than its name claims.
- Uncovered clip case: Fri 09:00Z → following Mon 15:00Z (two segments,
  weekend skipped).

## Recommended follow-up features

**FU-12 — Parse timestamps properly instead of regex-patching them.** Replace
`toUtcMs` in `lib/calendar/stacked-window.ts` with a real parse that accepts
every form the system can produce: `Z`, lowercase `z`, `±HH:MM`, `±HHMM`, `±HH`,
fractional seconds of any precision, and the space-separated Postgres rendering
— treating an offset-less value as UTC as the current header comment promises.
The immediate defect is that a canonical `+00:00` offset returns `[]`, which is
the format PostgREST emits and which
`tests/integration/calendar-blocks-crud.test.ts:288` already pins, so every block
read from the database disappears. Separate the three failure modes that
currently all return `[]`: unparseable input must be distinguishable from a
reversed interval and from a legitimate non-overlap — return a tagged result or
log, but decide and document which. Tests must include a fixture in the exact
`2026-09-23T09:00:00+00:00` shape, one with `+02:00`, one with `-05:00`, one
lowercase `z`, one microsecond-precision value, plus a mutation check that the
suite goes red if `clipBlockToStackedWindow` is stubbed to return `[]`
unconditionally.

**FU-13 — Make AS-058 falsifiable and total.** The comparator is correct but
untested: substituting `a.id.localeCompare(b.id)` for the entire body leaves all
five tests green because every fixture's ids are alphabetically co-ordered with
its names. Rebuild the fixtures so id order and name order actively disagree —
e.g. `[{id:"zz",name:"Alice"},{id:"aa",name:"Bob"}]`, which must yield
`["zz","aa"]` — and apply the same inversion to the null-name and locale cases so
each rule is independently pinned. Then give the sort a total order: break
`localeCompare` ties with a code-unit compare on name and then on id, so
`bob`/`Bob` and `Arla`/`Ärla` produce the same output regardless of input row
order (assert both orders). Treat `null` and `undefined` identically and sort
both last. Deduplicate ids in the returned array so a duplicate self row cannot
inflate the selection count and flip AS-016/AS-017.

**FU-14 — Fix the TZ teardown leak across the whole test suite.** The pattern
`const o = process.env.TZ; ... afterAll(() => { process.env.TZ = o })` in
`tests/unit/planner-stacked-window.test.ts` assigns the string `"undefined"`
rather than deleting the key, which Node resolves to UTC. Every subsequent test
file sharing that worker then runs under UTC instead of the machine's local
zone, silently masking timezone bugs in local-time modules such as
`lib/calendar/block-datetime.ts`. Replace it with `delete process.env.TZ` when
the original was unset, audit the repo for the same idiom, and pin a project-wide
default `TZ` in `vitest.config.ts` so no test depends on the developer's machine
zone.

**FU-15 — Give M1's rendering assertions a renderer, or re-scope the
milestone.** AS-016, AS-017, AS-018, AS-019, AS-020 and AS-021 are all phrased as
claims about what the Planner renders, and after three scrutiny passes none has a
consumer — a repo-wide grep for the helpers returns only `lib/calendar/` and the
test files. They are currently asserted against a two-line ternary and against
constants restating their own literals. Either pull the Planner route and stacked
view forward so these can be asserted against rendered hour labels, five day
columns, and a layout switch driven by a real `parsePeopleParam` result, or move
all six assertions out of M1 into the milestone that owns the renderer so M1's
verdict reflects what M1 can actually prove. Also pin `resolvePlannerLayout` for
`NaN`, negative, and fractional counts while the function is being wired.

**FU-16 — Harden the `?people=` residue.** Validate `selfId` against
`activeMemberIds` on the AS-008 fallback path and define behaviour when it is
absent, so the parser cannot emit a non-member. Dedupe the `all` branch and
return a copy rather than the caller's array. Decide and document whether id
matching is case-sensitive (today literals are lowercased but ids are not, so
`"MEMBER-B"` silently falls back to self). Make the strip symmetric so `",all"`
behaves like `"all,"`. Add a serialize→parse round-trip property test covering
the empty selection and the `(["me"], "other-self")` case. Tests must distinguish
"correct answer" from "reached the AS-008 fallback" rather than asserting the
same `[selfId]` for both, and the AS-004 roster fixture must not be
already-alphabetical.

**Carried forward unchanged from pass 2:** FU-7 (AS-015 must be a hard gate at
F031, with a static guard test asserting no Planner file reads a `view` search
param until the route exists).

---

## Gate output

### `npx tsc --noEmit`
```
(no output)
exit 0
```

### `npx eslint <M1 files> --max-warnings=0`
```
(no output)
exit 0
```
Files linted: `lib/calendar/people-selection.ts`, `lib/calendar/planner-layout.ts`,
`lib/calendar/stacked-window.ts`, `tests/unit/planner-people-selection.test.ts`,
`tests/unit/planner-stacked-window.test.ts`, `tests/unit/planner-layout.test.ts`.

### M1 unit tests
`npx vitest run tests/unit/planner-people-selection.test.ts tests/unit/planner-stacked-window.test.ts tests/unit/planner-layout.test.ts`
```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  3 passed (3)
      Tests  48 passed (48)
   Start at  14:07:38
   Duration  173ms (transform 94ms, setup 171ms, import 49ms, tests 20ms, environment 0ms)
```
48 tests, up from 42 in pass 2. All green — and, per AS-022 and AS-058 above,
green is not informative here.

### Stacked window under non-UTC process timezones
```
TZ=America/Los_Angeles npx vitest run tests/unit/planner-stacked-window.test.ts
 Test Files  1 passed (1)      Tests  17 passed (17)      Duration  143ms

TZ=Europe/Stockholm     npx vitest run tests/unit/planner-stacked-window.test.ts
 Test Files  1 passed (1)      Tests  17 passed (17)      Duration  148ms
```
The pass-2 TZ counterexamples are genuinely fixed. The `+00:00` counterexample
replaces them and is invisible to every fixture in the file.

### Consumer grep
```
grep -rnE "clipBlockToStackedWindow|parsePeopleParam|orderPeopleForWholeTeam|resolvePlannerLayout" app components lib hooks | grep -v "^lib/calendar/"
(no output)
```
Still no caller anywhere. No `app/**/planner` route exists.

### Full suite — `npx vitest run`
```
 Test Files  297 failed | 574 passed | 2 skipped (873)
      Tests  310 failed | 4544 passed | 1703 skipped (6557)
   Duration  178.53s
```
Identical in character and count to pass 2 (297 files / 310 tests). Repo-wide and
pre-existing; no M1 file has a caller, so nothing in M1 can have caused them.
Passing-test count rose 4538 → 4544, matching the 6 tests added by F045/F046.
AS-075 ("the unit test suite passes") is not an M1 assertion but remains
unsatisfiable and still needs a dedicated triage feature before the quality-gate
milestone.
