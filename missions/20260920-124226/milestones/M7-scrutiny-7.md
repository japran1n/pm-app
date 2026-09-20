# M7 — Scrutiny pass 7

Mission: 20260920-124226 · Milestone: M7 (the stacked layout)
Date: 2026-09-20 · Validator: scrutiny (adversarial, read-only)
Scope: all M7 assertions except AS-001 and AS-066 (both DEFERRED).

Method: four independent reviewers, each given only the assertion text and
the touched files (no handoff, no worker reasoning). Each performed real
mutation testing — edit source, run vitest, revert. Plus a full
lint / typecheck / test run by this validator.

## Verdict: MILESTONE NOT PASSED — 4 blockers

Pass 6's three named fixes (F106/AS-069, F107/AS-067, F108/AS-019) were each
verified to exist in the tree and to do what was claimed. But widening the
mutation set beyond the three the worker itself chose exposed four assertions
that are not defended, three of them never examined in earlier passes.

## Assertion table

| ID | Status | Reason |
|---|---|---|
| AS-002 | FAIL | "24 hours" is really covered; "7 days" and "no query parameters" are not — `f098` renders a single-element `days={[DAY]}` fixture. |
| AS-014 | FAIL | The "same week" half has zero coverage; deleting `?week=` handling in `page.tsx:102` is caught by nothing. Implementation also derives the default week from the *viewer's* timezone. |
| AS-018 | PASS | `f033:37` asserts rendered `stacked-hour-*` testids; decoupled `HOURS` mutation (06:00–13:00) caught with 3 failures. |
| AS-019 | PASS (major) | F108's rendered Mon–Fri label test is real. But labels are a hardcoded map decoupled from `weekKey`, and the 5-column grid track count is unasserted. |
| AS-020 | PASS | Removing `clipBlockToStackedWindow` from `stacked-person-row.tsx:55` caught. |
| AS-021 | PASS (major) | Defended only by the pure-logic tests in `planner-stacked-window.test.ts:64`. The component-level test at `f033:110` is tautological and survived two weekend-rendering mutations. |
| AS-022 | PASS | Strongest of the set. Clipping removal, window widening, top/height swap, and `getUTCHours`→`getHours` all caught, including under `TZ=America/Los_Angeles`. |
| AS-023 | FAIL | Inverting the layout branch at `page.tsx:245` (`"stacked"` → `"week-grid"`) — the exact regression the assertion names — passes 167 tests. Only the two-line pure helper is tested. |
| AS-024 | PASS | Filtering out block-less users caught; the Mo fixture genuinely has no map entry. |
| AS-062 | PASS | Both the label-source mutation and deleting the label node caught. |
| AS-063 | PASS | `f032:76` fixture is deliberately anti-sorted; `.sort()`, `.reverse()`, and alphabetical-by-name all caught. |
| AS-064 | PASS (major) | `f035` drives a real unmocked dnd-kit `KeyboardSensor`. But `PointerSensor` deletion passes 6/6, and removing `SortableContext` is caught only by a source regex. |
| AS-065 | PASS (major) | Asserts the real URL string passed to `router.replace`. Only one drag scenario (index 0→1, downward, self) is exercised. |
| AS-067 | PASS (minor) | Person-palette override at both the planner and row level caught. Fixture colours `#ef4444`/`#22c55e` are the app's own swatches 4 and 7 — a palette whose first two entries were red-then-green would slip through. |
| AS-068 | FAIL | Guarded only by two `readFileSync` regexes. Replacing the real class with `overflow-hidden` while leaving a dead constant elsewhere in the file passes 8/8; making rows compressible (`min-h-0 shrink`) passes 15/15. |
| AS-069 | FAIL | A runtime-computed capacity figure goes UNCAUGHT in 4 of the 7 planner files. The pattern list is also too narrow to catch `"12 hours"` or `"8 / 40 hrs"` anywhere. |
| AS-001 | DEFERRED | Loop guard; documented in run-deferred.md as a known privacy defect. |
| AS-066 | DEFERRED | No status column in schema. |

## Failures, with severity

### AS-069 — blocker
The F106 fix closed the hole for `planner-header.tsx` and
`stacked-person-row.tsx` only (and, incidentally, `people-switcher.tsx`,
because the header renders it). A runtime-computed `{...}h total` span
injected into `stacked-planner.tsx`, `week-view.tsx`, `week-time-grid.tsx`,
or `calendar/page.tsx` is caught by nothing — 47/47 other calendar unit tests
stayed green with two of those mutations live. Those four files are guarded
only by the F105 static regex sweep, which is structurally blind to template
literals; F106's own comment at `f036-stacked-scroll-colour.test.tsx:161`
identifies exactly this hole and then fixes it for two files out of seven.

Separately, the pattern list at `f036-stacked-scroll-colour.test.tsx:137-144`
requires `total`, `·` or `/` immediately after the `h`. So `"12 hours"`,
`"8 / 40 hrs"`, `"32h"`, `"Booked 32h"` and `"6.5 h"` all pass the sweep —
i.e. the plainest capacity UI anyone would actually ship. The static list and
the rendered list also disagree on `booked`.

### AS-023 — blocker
`app/(workspace)/w/[workspaceSlug]/calendar/page.tsx:245` chooses
`StackedPlanner` vs `WeekView`. Inverting that condition so one person gets
the stacked layout and a team gets the week grid was not caught by any test.
All AS-023 coverage is either `resolvePlannerLayout(n)` (a two-line pure
helper, tested three times over) or `readFileSync` + `indexOf` greps over
`page.tsx` that check where `<PlannerHeader>` sits, not which branch renders
what. Nothing binds the derived layout value to the component rendered.

### AS-068 — blocker
Both halves of the assertion are undefended. `f036:114` and `:121` only check
that `/overflow-y-auto/` and `/max-h-\[/` appear *somewhere* in the file's
text — a comment or a dead constant satisfies them. And the "rather than
compressing the rows" half has no assertion at all: changing
`stacked-person-row.tsx:137` from `min-h-[6rem] shrink-0` to `min-h-0 shrink`
— precisely the compression the assertion forbids — passes 15/15.

### AS-014 — blocker
The "same week" clause is untested: making `page.tsx:102` ignore `?week=`
entirely is caught by nothing. Worse, this reviewer found a probable
*implementation* defect, not just a coverage gap — the default week is
resolved from `getCurrentUserTimezone(supabase)` (`page.tsx:88`), so two
members with identical rights opening the same bare `/calendar` URL from
different timezones can land on different weeks.

### AS-002 — major
The 24-hour clause has genuine rendered-DOM coverage (`length: 24` → 9 caught).
The "7 days" clause does not: `f098` hands the component `days={[DAY]}`, and
the component renders whatever array it is given, so a page-level regression
producing 5 days is invisible.

### AS-021, AS-019, AS-064, AS-065, AS-067 — major/minor, not blocking
- AS-021 (major): `f033:110-127` loops `for (const isoWeekday of [1..5])`, so
  it can only ever query testids the component already chose to render. It
  stayed green both when the window was widened to 7 days (with the Saturday
  block visibly rendered into `stacked-day-6`) and when the weekend filter was
  deleted. Should query `-6`/`-7`, or assert zero block nodes.
- AS-019 (major): `DAY_LABELS` (`stacked-person-row.tsx:19-25`) is a hardcoded
  map keyed by ISO weekday, entirely decoupled from `weekKey`. Shifting the
  week by one day so the columns show Tue–Sat while still labelled Mon–Fri
  passed both AS-019 tests; it was caught only incidentally by AS-022's
  position assertions. `data-date` is never asserted. Separately,
  `repeat(5, minmax(0,1fr))` → `repeat(7, …)` survives the whole suite.
- AS-064 (major): deleting `PointerSensor` passes 6/6. Mouse and touch drag —
  how essentially every real user reorders these rows — is asserted by
  nothing. Removing `SortableContext` is caught only by the regex at
  `f035:246`, which would also pass on `{false && <SortableContext>}`.
- AS-065 (major): only one drag scenario exists (index 0→1, downward, always
  self). An off-by-one in the `splice`/`splice` pair at
  `stacked-planner.tsx:141-143` that happens to be right for adjacent-downward
  survives. No serialize→parse round trip ties the write side to the read side.
- AS-067 (minor): add a third row reusing person 1's colour — no per-person
  palette can reproduce that, and no reordering of a palette defeats it.

### Vacuous tests found (minor)
- `f032-stacked-shell.test.tsx:120` — "AS-024 mutation guard" defines its own
  deliberately-buggy render inline and asserts the bug occurred. It exercises
  no production code and can never fail from a source change.
- `planner-stacked-window.test.ts:10,15` — `expect(STACKED_DAYS).toEqual([1..5])`
  and `STACKED_START_HOUR === 8` restate constants back at themselves. A
  component-only mutation (4 columns) sailed past both.
- `f035-stacked-reorder.test.tsx:187` — named "a drag that doesn't change
  position does NOT call router.replace" but performs no drag at all; its own
  comment admits it. The `active.id === over.id` guard is uncovered.

### Housekeeping (minor)
`tests/unit/zz-dbg.test.tsx` is untracked in the working tree — a hand-written
debug scratch file (`it("dbg", …)`, `console.log`, `expect(1).toBe(1)`) that
renders `StackedPlanner`. It runs as part of the suite. Delete it.

## The structural cause

Three of the four blockers share one root: the calendar page is a React Server
Component, and the project has normalised "assert on `page.tsx` source text"
as a substitute for behaviour — `f088-planner-header-lift.test.tsx`,
`f031-page-layout-derivation.test.tsx`, `f036-stacked-scroll-colour.test.tsx`.
Every assertion whose subject is the page's *composition* rather than a leaf
component is therefore effectively untested, and AS-001 was already deferred
for exactly this reason. Patching one assertion at a time will keep producing
passes like this one. The durable fix is to extract the page's data-and-layout
decision into a pure exported selector that returns which component to render
with which props, and assert on its return value.

## Recommended follow-up features

**F109 — Render-level AS-069 sweep across every planner surface.** The
render-level guard added by F106 covers two of seven planner files; extend it
to the remaining five. `StackedPlanner` is already rendered by the AS-067 test
in the same file, so it needs only four `document.body.textContent` assertions
added to that existing render. `WeekView` and `WeekTimeGrid` need new renders
with a realistic block fixture. The page itself cannot be rendered under the
current RSC constraint, so it should be covered by whatever selector F111
extracts. Simultaneously, widen the pattern list — it must catch `hrs`,
`hours?`, `mins?`, a bare `\d+\s*h\b`, `\d+\s*/\s*\d+`, `allocat`, `workload`,
`overbooked`, `availab`, `FTE`, and a progress bar's `aria-valuenow`, and the
static and rendered lists must be kept identical. Verify by injecting a
runtime-computed `"12 hours"` into each of the seven files in turn and
confirming each injection fails the suite.

**F110 — Make AS-068 behavioural.** Delete the two `readFileSync` regexes at
`f036:114-124` and replace them with assertions on the rendered DOM: the
scroll container element must carry both the overflow and max-height classes
on the element that actually wraps the rows (found by testid, not by grepping
the file), and each rendered `StackedPersonRow` must carry a non-zero minimum
height class that does not shrink. Verify with two mutations: replace the
container class with `overflow-hidden` while leaving a dead constant with the
old string elsewhere in the file (must fail), and change the row from
`min-h-[6rem] shrink-0` to `min-h-0 shrink` (must fail).

**F111 — Extract the planner layout decision into a testable selector, closing
AS-023 and AS-002's "7 days".** Introduce a pure exported function in
`lib/calendar/` that takes the resolved layout, selected user ids, blocks and
week, and returns a discriminated descriptor naming which component to render
and with what props — then have `page.tsx:245` do nothing but switch on that
descriptor. Test the selector directly: one person must yield the week-grid
descriptor covering seven days, two or more must yield the stacked descriptor.
Verify by inverting the branch (must fail) and by returning five days instead
of seven (must fail). This also gives F109 a seat to assert the page-level
absence of capacity figures, and is the same extraction that would eventually
un-defer AS-001.

**F112 — Cover AS-014's "same week", and decide the timezone question.** Two
parts. First, a test that the week rendered is derived from `?week=` and not
from the viewer: deleting the `parseWeekKey(weekParam) ??` prefix at
`page.tsx:102` must fail. Second, a decision on the genuine defect behind it —
with no `?week=`, the default is resolved from the *viewer's* timezone, so two
members with identical rights opening the same bare URL from different
timezones can see different weeks. If that is intended, AS-014 needs a new
assertion ID scoping it to URLs that carry `?week=` (the contract is immutable;
do not edit AS-014). If it is not intended, the default must be resolved from a
workspace-level timezone instead.

**F113 — De-vacuum the AS-021, AS-019 and AS-064/AS-065 tests.** Four small,
independent changes. AS-021: `f033:110` must query `stacked-block-${id}-6` and
`-7` directly, or assert that `querySelectorAll('[data-testid^="stacked-block-"]')`
is empty — verify by widening `STACKED_DAYS` to 1..7 (must now fail). AS-019:
assert each column's `data-date` against the date derived from `weekKey`, so
shifting the week by one day fails; and assert the grid's track count so
`repeat(7, …)` fails. AS-064: add a `PointerSensor` test driving real pointer
events, so deleting that sensor fails. AS-065: add an upward drag, a multi-slot
drag, and a non-self row, plus one round-trip test feeding
`serializePeopleParam`'s output back through `parsePeopleParam`. Also delete
the three vacuous tests named above (`f032:120`, `planner-stacked-window.test.ts:10,15`,
`f035:187` — replace the last with a real no-op drag) and remove the untracked
`tests/unit/zz-dbg.test.tsx`.

**F114 — Strengthen the AS-067 fixture (minor).** Change the two fixture
colours to ones a person-index palette is unlikely to produce (`#8b5cf6`,
`#64748b`) and add a third member whose block reuses person 1's colour — a
per-person palette cannot reproduce two rows sharing a colour, so no
reordering of a palette defeats the test.

---

# Appendix: full command output

## Typecheck — PASS

```
$ npx tsc --noEmit
TSC EXIT=0
```

## Lint — PASS

```
$ npx eslint . --max-warnings=0
(no output; exit code 0)
```

## M7-relevant test files — PASS (61/61)

```
$ npx vitest run tests/unit/f033-stacked-row-grid.test.tsx \
    tests/unit/f032-stacked-shell.test.tsx \
    tests/unit/f035-stacked-reorder.test.tsx \
    tests/unit/f036-stacked-scroll-colour.test.tsx \
    tests/unit/planner-stacked-window.test.ts \
    tests/unit/planner-layout.test.ts \
    tests/unit/f102-calendar-page-composition.test.tsx \
    tests/unit/f098-week-grid-24h.test.tsx

 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  8 passed (8)
      Tests  61 passed (61)
   Start at  22:10:12
   Duration  1.90s (transform 642ms, setup 1.88s, import 987ms, tests 536ms, environment 1.81s)
```

Every M7 test file is green. That is the point of this report: green is not
the same as defended.

## Full suite — RED, but not on M7

```
$ npx vitest run --reporter=dot

 Test Files  292 failed | 588 passed | 2 skipped (882)
      Tests  310 failed | 4632 passed | 1682 skipped (6624)
   Start at  22:07:06
   Duration  173.14s (transform 8.53s, setup 85.71s, import 117.59s,
             tests 323.27s, environment 87.59s)
```

None of the 310 failures are in the eight M7 files above. The failures are
integration tests requiring live Supabase credentials plus tests belonging to
other missions in this repo (`tests/unit/f011-slug-proposal.test.ts` fails 3
on a clean tree; `tests/unit/list-due-date-cell-optimistic.test.tsx:163`
fails on a `waitFor` timeout). This is a pre-existing condition and is not an
M7 regression — but a suite this red cannot function as a regression signal
for anything, and the orchestrator should treat restoring it as mission-level
work independent of M7.

## Working tree

Verified clean of all reviewer mutations after the pass; the only untracked
artefact in code paths is `tests/unit/zz-dbg.test.tsx`, flagged above. No code,
test, or contract file was modified by this validator.

## Note on method

The four reviewers ran concurrently and each mutated the shared working tree,
so they occasionally observed one another's in-flight edits. Two such
artefacts were identified and discarded: one reviewer's claim that
`handleDragEnd` is dead code (`router.replace` is called at
`stacked-planner.tsx:150`; the reviewer read the file during another's
mutation), and one full-suite failure count taken while a foreign mutation was
live. Every finding reported above was either produced by a reviewer whose own
revert was confirmed, or independently re-checked by this validator. The
AS-023 blocker in particular was confirmed statically: no test in the repo
renders or otherwise observes the `page.tsx:245` branch.
