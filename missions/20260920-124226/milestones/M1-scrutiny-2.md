# M1 scrutiny — pass 2

Mission: 20260920-124226 · Milestone M1 (F002–F007, re-verified after F042/F043/F044)
Date: 2026-09-20 · Reviewer: scrutiny validator (adversarial, read-only). No files modified.

## Verdict: RED

Two of the three pass-1 blockers are genuinely fixed (AS-021/AS-022 multi-day
segmentation; AS-004 whitespace/trailing-comma). The third (AS-015) was
"fixed" by deleting the vacuous test and putting nothing in its place, so the
assertion now has *zero* coverage anywhere in the repo. AS-058's locale fix
landed in the code but the test added to prove it cannot distinguish the new
collation from the old one. Two assertions remain structurally unverifiable
until a renderer exists.

## Scope note (unchanged from pass 1)

`grep -rnE "parsePeopleParam|clipBlockToStackedWindow|orderPeopleForWholeTeam|resolvePlannerLayout|STACKED_" app components lib hooks` returns
nothing outside `lib/calendar/`. There is still no `app/**/planner` route.
Every M1 assertion is phrased about rendered behaviour; all are judged here at
helper altitude only and must be re-verified at the milestone that wires them.

## Assertion table

| ID | Result | Reason |
|---|---|---|
| AS-003 | PASS | `trimmed === "me"` → `[selfId]`; pinned by a test that fails on any other return. |
| AS-004 | FAIL (major) | `" all "` and `"all,"` now work, but `.replace(/,$/,"")` strips exactly one comma: `"all,,"` and `"all,all"` return `[selfId]`, and `"ALL"` returns `[selfId]`. All three are silently indistinguishable from the AS-008 fallback. The new test covers precisely the single case the regex handles — it mirrors the implementation. |
| AS-005 | PASS | Single valid id returns exactly that id. |
| AS-006 | PASS | Comma list returns exactly the listed valid ids. |
| AS-007 | PASS | Unknown ids dropped via `activeSet.has`; test covers a bad id between two good ones. |
| AS-008 | PASS (major caveat) | Empty-roster `all` now falls back to `[selfId]` and is tested. `selfId` is still never validated against `activeMemberIds`: `parsePeopleParam("bogus", {selfId:"ghost", activeMemberIds:[…]})` → `["ghost"]`, emitting a non-active id and contradicting AS-007's rule. Untested. |
| AS-009 | PASS | Order carried in an array; `z,a,b` regression test fails on any sort. |
| AS-010 | PASS | Non-adjacent duplicate case (`a,b,a`) added; first-occurrence-wins is now genuinely pinned. |
| AS-015 | FAIL (blocker) | The vacuous test was deleted and nothing replaced it. There is now no test for AS-015 anywhere in the repo. The only evidence is a comment on line 10 of `people-selection.ts`. The assertion is currently true only because the Planner route does not exist; a future worker could add `?view=` handling and nothing would go red. |
| AS-016 | PASS (fragile) | `resolvePlannerLayout(1) === "week-grid"`. Mirrors a one-line ternary; never fed a `parsePeopleParam` result. `resolvePlannerLayout(NaN)` → `"stacked"`, untested. |
| AS-017 | PASS (fragile) | Same as AS-016 for `>= 2`. |
| AS-018 | INCONCLUSIVE | Still `STACKED_START_HOUR === 8` / `=== 16`, a tautology. Partially pinned indirectly by the clip tests (changing END to 17 breaks the 14:00→18:00 case), but nothing renders 8 hours. Settle at F033. |
| AS-019 | INCONCLUSIVE | `STACKED_DAYS === [1,2,3,4,5]` mirrors the literal; indirectly pinned by the Saturday test. Nothing renders five columns. Settle at F033. |
| AS-020 | PASS | Fully-outside blocks on both sides return `[]`; tests now correctly labelled AS-020. |
| AS-021 | PASS | **Pass-1 blocker resolved.** The day loop derives the ISO weekday per candidate UTC day, not from the start instant. Verified: Sun 22:00Z → Mon 10:00Z yields Monday 08:00–10:00; Fri 15:00Z → Sat 09:00Z yields Friday only; Sat and Sun blocks yield `[]`. Tests correctly labelled. |
| AS-022 | PASS | **Pass-1 blocker resolved.** Return type is now `StackedBlockClipped[]`; Mon 09:00Z → Fri 15:00Z yields five per-day segments with correct clipping at both ends, and the exact-boundary 08:00→16:00 case is pinned. Arithmetic is pure UTC epoch-ms, so it is DST- and process-TZ-independent (confirmed: suite green under `TZ=Europe/Stockholm`). |
| AS-058 | FAIL (major) | The code fix is right (`localeCompare(b,"en",{sensitivity:"base"})`), but the test added to prove it compares `Ärla` against `Zebra` — a pair that differs at the base letter and therefore orders identically under `sensitivity:"base"`, `"variant"`, the previous bare `localeCompare()`, or a plain `<`. The test cannot fail if the collation regresses. Worse, `sensitivity:"base"` returns `0` for case- and accent-only ties, so `[{x,"bob"},{y,"Bob"}]` and the reversed input produce different orders — "alphabetically by name" is still not deterministic for a DB query without `ORDER BY`. Also: `undefined` name is not caught by the `=== null` guards and sorts as the string `"undefined"` (before `Zed`, not last); duplicate self rows emit a duplicate id, which can flip AS-016/AS-017. |
| AS-072 | PASS | The three helper groups are unit-tested and green (42 tests). Test-to-assertion labels in `planner-stacked-window.test.ts` are now correct: AS-020 names the fully-outside cases, AS-021 the Sat/Sun cases, AS-022 the clipping cases. Grep-based traceability is no longer misleading. Caveat: AS-015 now has no labelled test. |

Summary: 12 PASS · 3 FAIL · 2 INCONCLUSIVE · 1 PASS counted with a major caveat.

## Failures by severity

**Blocker**
- AS-015 — no test exists. Deleting the vacuous test removed the false signal but left the assertion completely unverified.

**Major**
- AS-004 — `all,,`, `all,all`, `ALL` resolve to the wrong person, silently; the new test mirrors the exact regex rather than the assertion's intent.
- AS-058 — the collation fix is untestable by the test that was added; case/accent ties remain input-order-dependent; `undefined` names and duplicate self rows are unhandled.
- AS-008 — `selfId` is still never validated against `activeMemberIds`, so the fallback can emit a non-active id.
- Timezone contract is documented but unenforced. `new Date(block.starts_at)` accepts offset-less strings and parses them as local. Counterexamples produced against the real module: a Saturday block `2026-09-26T00:00:00` renders on Friday under `TZ=Asia/Tokyo`; `2026-09-23T06:00:00` (outside the window) renders 13:00–14:00Z under `TZ=America/Los_Angeles`; the Postgres `timestamp without time zone` rendering `"2026-09-23 09:00:00"` silently vanishes under that same TZ. Every test uses `Z` suffixes and no config pins `TZ`, so the suite cannot see any of this.

**Minor**
- Line 41 computes `trimmed` but line 56 splits `raw`; a future edit to the normalisation will not reach the list branch.
- `serializePeopleParam` still does not round-trip: `(["me"], "other-self")` → `"me"` → a different person; `([], selfId)` → `""`. No property test.
- A member whose id is literally `"me"` or `"all"` is unselectable.
- `resolvePlannerLayout(NaN)` → `"stacked"`; negative counts → `"week-grid"`. Unstated, untested.
- Malformed timestamps and reversed intervals both return `[]`, indistinguishable from "outside the window", with no log.
- A date-only input (`"2026-09-23"` → next day) silently becomes a full 08:00–16:00 working day. Untested; may or may not be the intended all-day rule.
- Uncovered clip case: Fri 09:00Z → following Mon 15:00Z (two segments, weekend skipped).

## Recommended follow-up features

**FU-7 — Re-home AS-015 to a real test.** AS-015 states the Planner honours no
`?view=` parameter. It currently has no test at all. Add coverage at whatever
layer actually parses the Planner query string — when the Planner route lands,
a test that mounts the route with `?view=stacked` while one person is selected
and asserts the week grid still renders, and with `?view=week` while three are
selected and asserts the stacked layout still renders. Until the route exists,
at minimum add a static guard test asserting that no file under the Planner
route directory reads a `view` search param, so the assertion goes red the
moment someone introduces one. Do not restore the deleted options-object test.

**FU-8 — Harden `?people=` literal normalisation and prove it with intent-level
tests.** Replace the single-trailing-comma regex in `parsePeopleParam` with a
real tokenisation: split on commas first, trim and drop empty tokens, then
compare the resulting single token against the `me`/`all` literals, with a
documented decision on case sensitivity (`ALL` must either work or be an
explicit drop, not a silent fallback to self). Validate `selfId` against
`activeMemberIds` on the fallback path and define behaviour when it is absent.
Tests must cover `all,,`, `all,all`, ` all `, `ALL`, `Me`, a selfId outside the
roster, and a serialize→parse round-trip property, and must distinguish "correct
answer" from "reached the AS-008 fallback" rather than asserting the same
`[selfId]` for both.

**FU-9 — Make AS-058 ordering provably deterministic.** Keep the explicit
locale, but add a total order: break `localeCompare` ties with a stable
secondary comparison (code-unit compare on name, then on id) so equal-base
names cannot depend on input row order. Treat `undefined` and `null` names
identically and sort both last. Deduplicate ids in the returned array so a
duplicate self row cannot inflate `selectionCount` and flip the layout choice.
Replace the `Ärla`/`Zebra` fixture with pairs that actually discriminate
collations: `Arla`/`Ärla`, `apple`/`Apple`, each asserted in both input orders
so the test fails if the comparator regresses to a bare `<` or loses its options
argument.

**FU-10 — Enforce the stacked-window UTC contract at runtime.** The header
comment declares a Z-suffix-only contract that nothing checks. Validate both
timestamps against an explicit offset (`Z` or `±HH:MM`) and reject anything
else — return `[]` and log, or throw, but decide and document which — instead
of letting `new Date` silently reinterpret an offset-less or space-separated
value as local time. Add tests that run the same fixtures under `TZ=UTC`,
`TZ=Europe/Stockholm` and `TZ=America/Los_Angeles`, including the three
counterexamples in this report, a DST-crossing block, and the uncovered
Fri→following-Mon two-segment case.

**FU-11 — Re-verify AS-016, AS-017, AS-018, AS-019 at the render layer.** These
four are asserted today against a one-line ternary and against constants
equalling their own literals. When F033 lands the stacked renderer, assert eight
hour rows and five day columns from rendered output, and drive the layout switch
from a `parsePeopleParam` result rather than a bare integer. Also pin
`resolvePlannerLayout` for `NaN` and negative inputs.

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
      Tests  42 passed (42)
   Start at  13:59:14
   Duration  175ms (transform 92ms, setup 172ms, import 46ms, tests 18ms, environment 0ms)
```

### Stacked window under a non-UTC process timezone
`TZ=Europe/Stockholm npx vitest run tests/unit/planner-stacked-window.test.ts`
```
 Test Files  1 passed (1)
      Tests  14 passed (14)
   Duration  152ms
```
Green — but only because every fixture carries a `Z` suffix. See the AS-020/021/022
timezone counterexamples above, which the suite cannot reach.

### Full suite — `npx vitest run`
```
 Test Files  297 failed | 574 passed | 2 skipped (873)
      Tests  310 failed | 4538 passed | 1703 skipped (6551)
   Duration  191.63s
```
Failure count is unchanged in character from pass 1 (296→297 files, 310 tests) and
remains repo-wide and pre-existing; no M1 file has a caller, so nothing in M1 can
have caused them. AS-075 ("the unit test suite passes") is not an M1 assertion but
is still not satisfiable and needs a dedicated triage feature before the
quality-gate milestone.
