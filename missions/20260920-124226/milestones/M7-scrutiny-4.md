# M7 — The stacked layout — Scrutiny pass 4

**Verdict: REJECT.** 4 blockers, 8 majors, 2 minors.

F100 and F101 did not close pass 3's blockers. Both workers responded to the
critique "this assertion is guarded only by a source-text regex" by **adding
another source-text regex**. F100 appended
`expect(source).not.toMatch(/buildBlockUserIds\([^)]*\)\s*\.concat\(/)` —
which forbids the literal string pass 3 happened to use, and nothing else.
F101 appended a regex asserting `{...listeners}` appears inside some JSX tag —
which forbids deleting the token, and nothing else. Both named mutations are
now dead; both assertions are still unmet, killed this pass by one-line
variants that the new regexes match verbatim.

## Mutations applied and run this pass

All run in a detached git worktree at `HEAD` (`56e8ac3d`) against the 14-file
M7 gate (120 tests, green at baseline). Worktree removed; working tree clean.

| # | Mutation | Result |
|---|---|---|
| 1 | `page.tsx:139` insert `selectedUserIds.push(...activeMemberIds);` above the `buildBlockUserIds` call | **SURVIVES 14/14.** Defeats F100. |
| 2 | `week-view.tsx` `week.days` → `week.days.slice(0, 5)` (all 4 sites) | **SURVIVES 14/14** |
| 3 | `stacked-window.ts:112` `<` → `<=` | **SURVIVES 14/14** |
| 4 | `page.tsx:134` insert `selectedUserIds.sort();` | **SURVIVES 14/14** |
| 5 | `stacked-planner.tsx:159` drop `max-h-[…] overflow-y-auto`, keep the tokens in a trailing `/* comment */` | **SURVIVES 14/14** |
| 6 | `planner-header.tsx:48` render `{rangeLabel} — 37 h · 92% load` | **SURVIVES 14/14** |
| 7 | `page.tsx:246` `if (layout === "stacked" \|\| _sp["vi"+"ew"] === "stacked")` | **SURVIVES 14/14** |
| 7a | (control) renaming the branch variable to `forcedLayout` | KILLED — proves the AS-023/AS-015 guards match the identifier, not the behaviour |
| 8 | `stacked-planner.tsx:74` add `disabled` to the drag handle button | **SURVIVES** (reviewer-verified, 16/16). Defeats F101: `{...attributes}` and `{...listeners}` both still present; every row permanently undraggable. |
| 9 | `stacked-planner.tsx:156` `items={selectedUserIds}` → `items={[]}` | **SURVIVES** |
| 10 | `stacked-planner.tsx:146-148` delete the `if (weekParam) params.set("week", …)` block | **SURVIVES** |

Mutation 7a is the most telling result of the pass: the AS-023 guard is
sensitive to *renaming a local variable* and insensitive to *inverting the
layout decision*. That is the definition of a test that mirrors the
implementation.

## Assertion results

| ID | Result | Reason |
|---|---|---|
| AS-001 | FAIL (blocker) | Mutation 1. `selectedUserIds.push(...activeMemberIds)` leaks every workspace member's blocks on a no-parameter load; F100's `.concat(` regex matches nothing, `buildBlockUserIds(selectedUserIds)` and `blockUserIds={blockUserIds}` both still present. `buildBlockUserIds` is still an identity function (`lib/calendar/workspace-members.ts:41`) tested for identity. |
| AS-002 | FAIL (major) | 24-hour axis genuinely guarded by `f098`. The **7-day half is not**: mutation 2 makes the Planner Mon–Fri with the suite green. `f098` renders `WeekTimeGrid` with `days={[DAY]}` — a single day. `calendar-week-grid.test.ts:25` proves `buildCalendarWeek` returns 7 but nothing connects that to a render. |
| AS-014 | FAIL (major) | Only `parsePeopleParam` purity is tested. Mutation 4 (and the reviewer's self-first reorder at `page.tsx:272`) makes two members see different row orders from the same URL. Green. |
| AS-015 | FAIL (major) | Mutation 7. All guards are regexes over `searchParams.view`, the destructure line, and `resolvePlannerLayout`'s arg list, plus one `@ts-expect-error`. A dynamically-keyed read of the same param overrides the layout undetected. |
| AS-018 | PASS (minor) | `stacked-hour-1-{8..15}` present / 0–7,16–23 absent; both constants die under mutation. Structural only: the stacked layout renders no hour labels and no size guard — collapsing the column to `HOURS.length * 0.1rem` stays green. |
| AS-019 | PASS | `stacked-day-1..5` present, 6/7 absent; `STACKED_DAYS` pinned by `toEqual([1,2,3,4,5])`. No green mutation found. |
| AS-020 | FAIL (major) | Mutation 3. Every fixture is *strictly* outside the window (04:00–06:00, 17:00–19:00); nothing touches an edge. Under `<=`, a 16:00→17:00 or 07:00→08:00 block emits a zero-length segment and `stacked-person-row.tsx:198` renders a real chip for it — hit-testable, screen-reader-visible. AS-020 forbids exactly this. |
| AS-021 | PASS (minor) | Weekend exclusion dies under mutation at both the lib and render level, including Fri→Sat and Sun→Mon spans. The AS-021 test alone would miss a weekend block rendered into a 6th column; it is carried by AS-019's test. Not self-sufficient. |
| AS-022 | PASS | Holds. Exact clipped timestamps at both edges, both-ends, multi-day, and `+00:00`-offset regressions, plus rendered `top`/`height` percentages with a non-zero-top fixture. Genuinely behavioural. Noted, not a failure: `percentOffset` reads UTC hours while `week-view.tsx:51` buckets local — the two layouts disagree under a non-UTC `TZ`. |
| AS-023 | FAIL (major) | Mutations 7/7a. `resolvePlannerLayout` is honestly tested in isolation; the page's *use* of it is pinned by a structural regex sensitive to identifier names. No test asserts the single→stacked→single round trip on rendered output. |
| AS-024 | PASS (minor) | `f032:60-74` renders the real `StackedPlanner`; the `?? []` is the mechanism and the zero-block early return dies. The "AS-024 mutation guard" at `f032:120-145` remains self-theatre — it builds a buggy array locally and asserts the bug. Page-level wiring untested (`selectedUserIds.filter(id => blocksByUser.has(id))` at `page.tsx:272` stays green). |
| AS-059 | PASS | The fallback is real and independently verified: `planner-people-selection.test.ts:37-62,158,176-201` kills an `activeMemberIds[0]` shortcut, and `f029-switcher-url-wiring.test.tsx:145-168` drives the live switcher to `people=me`. No green mutation found in `people-selection.ts`. (Pass 3 folded the AS-001 scoping leak into this row; that leak is scored under AS-001 only.) |
| AS-062 | FAIL (major) | Component-level label render is real and dies under mutation. The page→planner `members` wiring is not: `members={[]}` at `page.tsx:276` makes every row fall back to a raw UUID (`stacked-planner.tsx:168`) with the suite green. |
| AS-063 | FAIL (major) | Component-level ordering fixture is well built and kills an in-component sort. Mutation 4 sorts the ids *before* they reach the component: rows render alphabetically by id, `?people=` order lost, green. |
| AS-064 | FAIL (blocker) | Mutations 8 and 9. F101's regex proves the *token* `{...listeners}` exists in a JSX tag; adding `disabled` to the same button keeps the token and makes every row undraggable. `items={[]}` on `SortableContext` likewise. `DndContext` is still mocked away (`f035:19-34`) so no prop on it is ever observed, and the behavioural tests still invoke a captured `onDragEnd` synthetically. **No test asserts that a gesture moves a row.** |
| AS-065 | FAIL (blocker) | Mutation 10. `renderPlanner` never passes `weekParam`, so the branch is dead in every test. A reorder silently teleports the viewer to the current week: the order survives the reload, the week does not. Also only a *backward* move (2→1) is tested; the forward splice path is uncovered (`splice(toIndex + (fromIndex < toIndex ? 1 : 0), 0, moved)` survives). Escalated from major — combined with AS-064 the entire reorder feature is unexercised. |
| AS-066 | DEFERRED | `time_off_entries` has no approval/status column (`supabase/migrations/20261114010000_time_off_entries.sql:16-28`). "Approved" has no referent; unimplementable as written. Not scored. Note the two wiring holes remain regardless: `timeOffByUser={…}` at `stacked-planner.tsx:178` is deletable green (no test supplies the prop), and `entries={timeOffByDate[dateKey]}` → `entries={timeOffEntries}` (PTO in all five columns) is green because `f034:51` asserts text on the strip container, not a column. |
| AS-067 | PASS (minor) | `f036:65-92` renders two differently-coloured blocks and asserts distinct computed `borderColor`; an in-row per-person substitution dies. Two holes: dropping `border` from the className at `stacked-person-row.tsx:209` keeps the inline style (test green) while `border-width: 0` makes the colours visually indistinguishable; and the suite never varies `userId`, so a `userId`-keyed override survives. |
| AS-068 | FAIL (major) | Mutation 5. Both checks are `readFileSync` + regex, and they match *anywhere in the file, on any element*. No test renders many members or inspects a computed style. The container compresses exactly as the assertion forbids. |
| AS-069 | FAIL (major) | Mutation 6. The scan covers two of roughly six Planner files; `planner-header.tsx`, `week-view.tsx`, `week-time-grid.tsx`, `week-agenda.tsx` and `page.tsx` are unscanned, and the week-grid layout is part of the Planner. The five patterns are also narrow enough that `40h total`, `8/40` or `78 %` passes inside the scanned files. |

## Gates

- `npx tsc --noEmit` — clean, exit 0.
- `npx eslint . --max-warnings=0` — clean, exit 0.
- M7 gate (14 files) — **120/120 green in 2.5s.**
- Full `npx vitest run` — **292 failed files / 310 failed tests of 6609**
  (586 files passed, 2 skipped; 173s). None are calendar or planner suites;
  the failures cluster in `f048`, `f060`, `f081`, `f083`–`f085`, `f096`,
  `f097`, `f104`, `f250`, `list-due-date-cell-*` and one Supabase-network
  integration test — other missions. Pre-existing, unchanged since pass 3,
  not blocking M7, but **AS-074/AS-075 in M8 cannot be satisfied until it is
  addressed.**

Naming hazard for future audits, repeated from pass 3: `tests/unit/f096-*`
and `f097-*` belong to an unrelated mission, and `f029-unlink-instance.test.ts`
matches an `AS-059` from a different contract.

## The pattern, stated plainly for the fourth pass

Two shapes account for every failure above, and they have not moved since
pass 2:

1. **A source-text regex standing in for a behavioural assertion.** AS-001,
   AS-002, AS-014, AS-015, AS-023, AS-062, AS-063, AS-064, AS-068, AS-069.
   A test that reads a file as a string can only prove that some characters
   are present. Every one of these was defeated this pass by a mutation that
   keeps the characters and changes the behaviour. Mutation 7a shows the
   inverse failure too: these guards break on harmless refactors.
2. **A prop no test ever supplies**, so the consuming path is dead in the
   suite. AS-065's `weekParam` and AS-066's `timeOffByUser`. Likewise the
   silent swallows at `stacked-planner.tsx:132` (`if (!workspaceSlug ||
   !selfId) return;`), `:139` (`fromIndex/toIndex === -1`) and the uncovered
   `!over` branch at `:128` — all zero coverage, all invisible to mutation.

**The root cause has been the same for three passes: nothing in the repo
renders `CalendarPage`, and nothing in the repo performs a drag gesture.**
Eleven follow-up features (F090, F095–F101) have been spent patching regexes
around those two holes. Filing a twelfth per-assertion regex patch will not
change the next pass's result. Two tests close ten assertions.

## Recommended follow-up features

**A. RSC-level Planner composition test — blocker (AS-001, AS-002, AS-014,
AS-015, AS-023, AS-062, AS-063).** Invoke `CalendarPage` as an async server
component with `getWorkspaceMembers`, `getCalendarBlocks` and the auth helper
mocked, and assert on *call arguments and the rendered tree*, never on
`page.tsx` read as a string. Cases: (i) no query parameters → `getCalendarBlocks`
receives a fourth argument deep-equal to `[selfId]`, and the output contains
7 day columns and 24 hour rows; (ii) `?people=a,b` → the query receives exactly
`["a","b"]`, `StackedPlanner` renders with rows labelled with the members'
*names* in the order `a, b`, and no 24-hour grid is present; (iii) the same
URL rendered under two different `selfId` values produces byte-identical
people order and week range; (iv) `?people=a,b&view=stacked` and
`?people=a&view=stacked` render exactly what the same URLs without `?view=`
render; (v) narrowing from `?people=a,b` to `?people=a` returns a 7-day,
24-hour grid. Delete the source-text guards at `f031:47-68`, `:127-186` and
`:202-214` in the same change — they are now liabilities, not coverage.

**B. Real drag-gesture test for the stacked reorder — blocker (AS-064,
AS-065).** Stop mocking `DndContext`. Render `StackedPlanner` with the real
dnd-kit context and a `KeyboardSensor`, focus the drag handle, and drive
`Space / ArrowDown / Space`, asserting that `router.replace` is called with a
`?people=` whose order actually changed. Include one forward move and one
backward move (the forward splice path is currently uncovered and off-by-one
mutable). Pass `weekParam` in at least one case and assert the resulting URL
still carries `week=`. Add coverage for the three silent early returns at
`stacked-planner.tsx:128,132,139` — each should be asserted to produce no
`router.replace`, so deleting or inverting the guard is visible.

**C. Stacked-window edge-case fixtures — major (AS-020).** Add fixtures that
*touch* the window boundary without overlapping it: 07:00→08:00 and
16:00→17:00 on a weekday. Assert `clipBlockToStackedWindow` returns an empty
array and that no `stacked-block-<id>-<day>` node is in the DOM. This kills
the `<` → `<=` mutant that has now survived two passes.

**D. Rendered-layout test for scrolling and for the absence of summaries —
major (AS-068, AS-069).** Replace both `readFileSync` guards. For AS-068,
render `StackedPlanner` with twelve members and assert the container's
computed `overflow-y` is `auto`/`scroll` and that a single row's height is at
or above a stated minimum — the property the assertion actually cares about is
that rows do not compress. For AS-069, walk the full rendered Planner text
content (both layouts, including `PlannerHeader`) and assert it matches no
`/\d+\s*%/` and no `/\b\d+(\.\d+)?\s*h(rs?|ours?)?\b/` — a content assertion
over the DOM, not a wordlist over two files.

**E. Colour visibility and unknown-swatch fallback — minor (AS-067).** Assert
the stacked block's computed `border-width` is non-zero alongside its
`borderColor`, and add a fixture with a colour outside the eight-swatch set to
pin `getCalendarBlockDisplayColor`'s silent `#3b82f6` substitution.

**F. Orchestrator decision required on AS-066.** Third pass carrying it, now
DEFERRED. Either add an approval/status column to `time_off_entries` and a
migration, or record a formal supersession noting the assertion is
unimplementable against the shipped schema. Leaving it deferred indefinitely
means M7 can never be closed cleanly. Independently of that decision, the
`timeOffByUser` and per-column `entries` wiring holes noted in the AS-066 row
should be closed as part of follow-up B.

---

## Appendix — full gate output

### `npx tsc --noEmit`

```
(no output)
exit 0
```

### `npx eslint . --max-warnings=0`

```
(no output)
exit 0
```

### M7 gate — 14 files

```
 Test Files  14 passed (14)
      Tests  120 passed (120)
   Start at  21:08:20
   Duration  2.51s (transform 456ms, setup 2.16s, import 2.44s, tests 565ms, environment 2.29s)
```

Files in the gate: `f031-page-layout-derivation`, `f032-stacked-shell`,
`f033-stacked-row-grid`, `f034-time-off-strip`, `f035-stacked-reorder`,
`f036-stacked-scroll-colour`, `f098-week-grid-24h`, `planner-layout`,
`planner-people-selection`, `planner-stacked-window`, `calendar-week-grid`,
`calendar-week-only-view`, `calendar-blocks-people-filter`,
`calendar-blocks-active-members`.

### Full `npx vitest run`

```
 Test Files  292 failed | 586 passed | 2 skipped (880)
      Tests  310 failed | 4617 passed | 1682 skipped (6609)
   Start at  21:11:42
   Duration  173.42s (transform 8.82s, setup 86.73s, import 118.55s, tests 319.30s, environment 88.66s)
```

Failure clusters (all outside M7): `f048`, `f060`, `f081`, `f083`–`f085`,
`f096`, `f097`, `f104`, `f250`, `list-due-date-cell-*`, and one
Supabase-network integration test. Representative tail:

```
       |                            ^
    164|     );
    165|
 ❯ runWithExpensiveErrorDiagnosticsDisabled node_modules/@testing-library/dom/dist/config.js:47:12
 ❯ checkCallback node_modules/@testing-library/dom/dist/wait-for.js:124:77
 ❯ Timeout.checkRealTimersCallback node_modules/@testing-library/dom/dist/wait-for.js:118:16
```

### Working-tree state after scrutiny

All mutation work was done in a detached git worktree, since removed.

```
$ git status --porcelain | grep -vE "^\?\?"
 M missions/20260920-124226/plan.md
```

`plan.md` was already modified before this pass began. No code, test, or
contract file was touched.
