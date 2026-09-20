# M1 scrutiny — pass 1

Mission: 20260920-124226 · Milestone M1 (F002–F007) · Date: 2026-09-20
Reviewer: scrutiny validator (adversarial, read-only). No files modified.

## Verdict: RED

Three blockers. The helpers are small and green, but two of them return
wrong answers for inputs the assertions explicitly describe, and one
assertion (AS-015) has a test that cannot fail for any implementation.

---

## Scope note

M1 ships pure helpers only; per `plan.md`, the Planner route, the people
switcher (F028) and the stacked renderer (F033) arrive later. Every
assertion in the contract is phrased about *rendered behaviour*
("the Planner renders…", "shows that member's blocks"). Nothing in the
repo imports `parsePeopleParam`, `serializePeopleParam`,
`orderPeopleForWholeTeam`, `resolvePlannerLayout`,
`clipBlockToStackedWindow`, `STACKED_*` — grep across `app/`,
`components/`, `lib/`, `hooks/` returns only the source and test files.

Rather than failing every row on that basis, rows below are judged at the
altitude M1 can deliver: **does the helper compute what the assertion
describes, and would the test fail if it stopped doing so?** Rows whose
truth cannot be established without the renderer are INCONCLUSIVE and must
be re-verified at the milestone that wires them.

---

## Assertion table

| ID | Result | Reason |
|---|---|---|
| AS-003 | PASS | `raw === "me"` → `[selfId]`; pinned by a test that would fail on any other return. |
| AS-004 | FAIL (blocker) | `" all "`, `"all,"` miss the un-trimmed `=== "all"` branch and silently degrade to `[selfId]`; and `activeMemberIds: []` returns `[]`, violating the never-empty invariant. Test asserts `toEqual(ACTIVE_MEMBER_IDS)` against the very array it passed in — it confirms a copy, not a resolution. |
| AS-005 | PASS | Single valid id returns exactly that id. Note: the `?people=<selfId>` case is untested (minor). |
| AS-006 | PASS | Comma list returns exactly the listed valid ids. |
| AS-007 | PASS | Unknown ids dropped via `activeSet.has`; remaining ids survive; test covers a bad id between two good ones. |
| AS-008 | FAIL (major) | Self-fallback works on the list path, but the `"all"` path returns before any length check, so an empty roster yields `[]`. `selfId` is also never checked against `activeMemberIds`, so the fallback can emit a non-active id — directly contradicting AS-007's rule. |
| AS-009 | PASS | Order carried in an array, never through a `Set`; the `z,a,b` regression test would fail on any sort. |
| AS-010 | PASS (fragile) | Dedupe keeps first occurrence. Test uses **adjacent** duplicates only, so a last-occurrence-wins implementation would still pass while breaking AS-009. Add `member-a,member-b,member-a`. |
| AS-015 | FAIL (blocker) | The test passes an extra `view: "week"` key on the **options object** and asserts nothing changed. No implementation of a function that destructures two named fields could fail this. AS-015 is about a URL parameter; this module never reads a URL. The assertion is untested. |
| AS-016 | PASS (fragile) | `resolvePlannerLayout(1) === "week-grid"`. Test mirrors a one-line ternary and is never fed the output of `parsePeopleParam`, so the pairing "one selected person → week grid" is asserted about a bare integer. |
| AS-017 | PASS (fragile) | Same as AS-016 for `>= 2`. |
| AS-018 | INCONCLUSIVE | Only `STACKED_START_HOUR === 8` / `=== 16` is asserted — a tautology against the literals. A renderer drawing 24 rows would still pass. Cannot be settled until F033. |
| AS-019 | INCONCLUSIVE | Same: `STACKED_DAYS === [1,2,3,4,5]` mirrors the literal. Nothing renders five columns yet. |
| AS-020 | PASS | Fully-outside blocks return `null` on both sides of the window (tests exist, though mislabelled as AS-022). |
| AS-021 | FAIL (blocker) | Weekday is derived from the **start instant only**. A Sunday 22:00Z → Monday 10:00Z block is dropped wholesale, when AS-021/AS-022 require Monday 08:00–10:00 to render. Symmetrically, Friday→Saturday truncation is correct only by accident of the same shortcut. Untested in either direction. |
| AS-022 | FAIL (blocker) | Single-day partial overlap clips correctly, but a block spanning several weekdays collapses to the first day's window: `Mon 09:00Z → Fri 15:00Z` returns only `Mon 09:00–16:00`; Tue–Fri vanish. The return type `StackedBlockClipped \| null` cannot express the multi-segment result, so this is a signature defect, not a branch bug. |
| AS-058 | PASS (fragile) | Self first, remainder sorted, nulls last — all three pinned. But bare `localeCompare()` uses the runtime default locale: `Ärla` sorts with `A` under en-US and after `Z` under `sv`, so server and browser can disagree for a Swedish team. Case-only ties return `0` and leak input order through sort stability. Fixture (`Alice/Bob/Charlie/Zed`) cannot detect any of this. |
| AS-072 | PASS (major caveat) | All three helper groups have unit tests and they pass. However the stacked-window test IDs are scrambled against the contract: the two tests titled AS-020/AS-021 actually exercise AS-022, the two titled AS-022 exercise AS-020, and AS-021's real content (Sat/Sun) carries no ID at all. A grep-based traceability check passes on a wrong mapping. |

Summary: 9 PASS · 5 FAIL · 2 INCONCLUSIVE · 2 PASS-with-caveat counted as PASS.

## Failures by severity

**Blocker**
- AS-021, AS-022 — `clipBlockToStackedWindow` drops or truncates every block that crosses a UTC midnight. Weekend-to-Monday blocks disappear; Mon→Fri blocks lose four days.
- AS-015 — vacuous test; assertion has zero real coverage.
- AS-004 — whitespace/trailing-comma forms of `all` silently resolve to the wrong person.

**Major**
- AS-008 — `[]` returned for `all` with an empty roster; unvalidated `selfId` can be emitted as a non-active member.
- AS-058 — locale-dependent, case-folding sort with a fixture that cannot expose it.
- AS-072 — test-to-assertion mapping is wrong for three IDs.
- Timezone contract undefined. The doc comment claims "no timezone conversion", but an offset-less ISO string (`"2026-09-21T09:00:00"`) is parsed as *local* per spec and then read with `getUTC*`. In UTC+2 that turns a Monday 09:00 block into `08:00Z–09:00Z`, and a Monday 00:30 block into a dropped Sunday. All tests use `Z` suffixes and none sets `TZ`, so the suite is timezone-blind. If blocks render in the viewer's zone, the window clips the wrong eight hours for every non-UTC user and shifts across DST.

**Minor**
- A member whose id is literally `"me"` can never be selected; `"all"` is selectable in a list but not bare — inconsistent shadowing.
- `serializePeopleParam` does not round-trip: `(["me"], "other-self")` → `"me"` → parses back as a different person; `([], selfId)` → `""`.
- No test uses realistic UUIDs; id matching is exact-case and unpinned.
- Boundary-exact cases (`06:00→08:00`, `16:00→18:00`, `08:00→16:00`) depend on the `>=` at stacked-window.ts:73 and are unpinned.
- Zero-length and reversed blocks return `null` with no stated rule and no test.
- Malformed timestamps return `null`, indistinguishable from "outside the window" — a block silently vanishing with no log.

## Recommended follow-up features

**FU-1 — Per-day segmentation in `clipBlockToStackedWindow`.** Change the
helper to return an ordered list of per-day clipped segments rather than a
single interval or `null`. For each Mon–Fri day the block overlaps, emit
the intersection of the block with that day's 08:00–16:00 window; emit an
empty list when there is no overlap. Derive the weekday for each candidate
day covered, not from the start instant alone, so a Sunday-evening →
Monday-morning block yields Monday's visible portion and a Monday →
Friday block yields five segments. Cover with tests for: Sun→Mon,
Sat→Mon, Fri→Sat, Wed→Thu, Mon→Fri, and the existing single-day cases.

**FU-2 — Pin the timezone contract for the stacked window.** Decide
explicitly whether 08:00–16:00 means UTC or the viewer's local wall clock,
document it on the helper, and make the parsing match. Reject or normalise
offset-less ISO strings rather than letting the engine parse them as local
time while `getUTC*` reads them as UTC. Add tests that run under at least
two `TZ` values (`UTC` and `Europe/Stockholm`) and one that crosses the
2026-10-25 DST boundary, so the suite can no longer pass by being
timezone-blind.

**FU-3 — Harden `parsePeopleParam` input normalisation and invariants.**
Trim the raw value before the `me`/`all` literal comparisons so `" all "`
and `"all,"` behave as `all`. Guarantee a non-empty result on every path,
including `all` with an empty roster. Validate `selfId` against
`activeMemberIds` and define the behaviour when it is absent, so the
fallback can never emit a non-active id. Decide and document how ids
literally equal to `"me"` or `"all"` are handled. Add a
serialize→parse round-trip property test. Add a non-adjacent duplicate
case to the AS-010 test.

**FU-4 — Make AS-058 ordering deterministic.** Pass an explicit locale and
collation options to `localeCompare` (e.g. `localeCompare(b, "en", {
sensitivity: "base" })`, or the app's chosen locale if one exists) so the
same roster orders identically on server and client. Extend the fixture
with non-ASCII names (`Ärla`, `Öl`, `Zebra`) and a case-only pair
(`apple` / `Apple`) with a documented tie-break, so the test can actually
distinguish collations.

**FU-5 — Correct the test-to-assertion mapping and remove the vacuous
AS-015 test.** Renumber the stacked-window test titles so AS-020 names the
fully-outside cases, AS-021 names the Saturday/Sunday cases, and AS-022
names the partial-overlap clipping cases. Delete the AS-015 test in
`planner-people-selection.test.ts` — it asserts that an unused object key
is unused — and re-home AS-015 to the feature that parses the Planner
query string, where a stale `?view=` can actually be supplied.

**FU-6 — Re-verify AS-018, AS-019, AS-016, AS-017 at the render layer.**
When F033 lands the stacked renderer and F004's layout choice is wired to
a real selection, assert row/column counts from rendered output and assert
the layout switch from a `parsePeopleParam` result, not from a bare
integer. Until then these four assertions are asserted against literals
and a ternary and prove nothing about the Planner.

---

## Gate output

### `npx tsc --noEmit`
Clean — no errors, no output.

### `npx eslint <M1 files> --max-warnings=0`
```
(no output)
exit 0
```
Files linted: `lib/calendar/people-selection.ts`, `lib/calendar/planner-layout.ts`,
`lib/calendar/stacked-window.ts`, `tests/unit/planner-people-selection.test.ts`,
`tests/unit/planner-stacked-window.test.ts`, `tests/unit/planner-layout.test.ts`.

### M1 unit tests
```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app
 Test Files  3 passed (3)
      Tests  34 passed (34)
   Duration  179ms
```

### Full suite — `npx vitest run`
```
 Test Files  296 failed | 574 passed | 2 skipped (872)
      Tests  310 failed | 4530 passed | 1696 skipped (6536)
   Duration  206.31s
```
The failures are repo-wide and pre-existing — none of the M1 files has a
caller, so nothing in M1 can have caused them. Sampled calendar-adjacent
failures are integration tests requiring a live database
(`tests/integration/calendar-blocks-crud.test.ts`,
`f232-calendar-query`, `f233-calendar-task-interactions`,
`f234-calendar-drag-reschedule`, `f235-calendar-filters`), plus unrelated
DOM suites such as `tests/unit/list-due-date-cell-optimistic.test.tsx`.
AS-075 ("the unit test suite passes") is not an M1 assertion, but it is
currently **not** satisfiable and will need a dedicated triage feature
before the quality-gate milestone.
