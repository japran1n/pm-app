# M7 — Scrutiny pass 8

Mission: 20260920-124226
Milestone: M7 — The stacked layout
Date: 2026-09-20
Method: 3 parallel independent feature reviewers (code + assertion text only, no
handoffs passed) + orchestrator-level mutation reasoning + full tsc / eslint /
vitest.

## Verdict table

| Assertion | Verdict | Severity | Reason |
|---|---|---|---|
| AS-001 | DEFERRED | — | Carried from pass 7. Not re-reviewed. |
| AS-014 | FAIL | blocker | Page derives the week from the *viewer's* `profiles.timezone`; same URL without `?week=` renders a different week per viewer. Tests are tautological. |
| AS-019 | PASS | — | Render-level: `stacked-day-1..5` present, `6`/`7` absent, labels asserted as exactly `[Mon..Fri]`. UTC-derived, locale-immune. |
| AS-021 | PASS | — | A real Saturday block is fed through the component and asserted absent; helper tests cover the filter itself. |
| AS-022 | PASS | minor | Clipped geometry (`top`/`height` percentages) is asserted, not mere existence; helper covers both-ends, fully-outside, midnight-crossing, multi-day, offset parsing. |
| AS-023 | DEFERRED | — | Carried from pass 7 (5 attempts exhausted). |
| AS-063 | FAIL | major | Code is correct, but the fixture's `members` array is in the same order as `selectedUserIds`, so a members-driven render escapes the test. |
| AS-064 | FAIL | blocker | Only adjacent moves, only a *relative*-order URL check, no DOM order assertion. `[...selectedUserIds].reverse()` escapes. |
| AS-065 | FAIL | blocker | The written URL is never re-parsed ("survives a reload" untested); `?week=` fixture uses a format `parseWeekKey` rejects; absent-`?week=` case uncovered; the no-op-drag test performs no interaction. |
| AS-066 | DEFERRED | — | Carried from pass 7. |
| AS-067 | PASS | minor | Two distinct non-default colours rendered through the full `StackedPlanner`; per-person palette substitution fails both assertions. |
| AS-068 | PASS | major | Render-level `overflow-y-auto` + `min-h-[6rem]` + `shrink-0` assertions are mutation-sensitive; the real layout chain is viewport-bounded, so `overflow-y-auto` is not a no-op. But the height bound itself is only source-grepped. |
| AS-069 | FAIL | blocker | Regexes cannot match a bare `40h` or `80%`; the source scan is a hardcoded 7-file list; three planner surfaces are rendered and the week-grid branch, popovers and time-off strip never are. |

Non-deferred result: **6 PASS, 4 FAIL (3 blocker, 1 major)**.

## Blockers in detail

### AS-014 — the planner week is viewer-dependent (code defect, not just a test gap)

`app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`:

```
const weekKey = parseWeekKey(weekParam) ?? currentWeekKey(timezone);
const week = buildCalendarWeek(weekKey, timezone);
```

`timezone` comes from `getCurrentUserTimezone` → `profiles.timezone` per user
(`lib/queries/profile.ts:28-42`). Two members with the same access rights
opening `?people=a,b` with no `?week=` resolve **different** week keys whenever
their profile timezones straddle a week boundary. The assertion is false today
for that URL shape.

The tests do not touch this. `tests/unit/f031-page-layout-derivation.test.tsx:99-125`
calls `parsePeopleParam` twice with `selfId: "user-a"` vs `"user-b"` — but with
`peopleParam = "user-a,user-b"`, the one branch where `selfId` is provably dead
code (`lib/calendar/people-selection.ts:55-70` never reads it). It is a
tautology. `tests/unit/f102-calendar-page-composition.test.tsx:183` is worse: it
loops over user ids asserting `expect(weekKey).toBe("2026-09-14")` against a
literal, with no implementation in the loop body.

Escaping mutation (whole suite stays green): change `page.tsx:102` to
`currentWeekKey(user.id.charCodeAt(0) % 2 ? "Pacific/Kiritimati" : "Pacific/Niue")`.

Note the tension with AS-001: a no-parameter URL *must* be viewer-dependent.
The defensible reading of AS-014 is "a URL that carries `?people=`". Under that
reading the `?people=me` branch is fine, but the timezone-driven week divergence
is still a genuine violation.

### AS-064 — the drop target is never verified

`tests/unit/f035-stacked-reorder.test.tsx:149` does drive the real dnd-kit
`KeyboardSensor` with no `@dnd-kit/*` mock — a real improvement over the
callback-poking version. But it asserts only on `router.replace`'s URL
(`:157-168`), and only a *relative* pair ordering: `expect(aIndex).toBeLessThan(selfIndex)`.
`StackedPlanner` holds no local order state, so "a row moved" is inferred, never
observed in the DOM. With 3 rows and a one-slot move there is no non-adjacent
coverage of the splice at `stacked-planner.tsx:141-143`.

Escaping mutation: replace the splice with `const nextOrder = [...selectedUserIds].reverse();`.
`over.id` is then entirely ignored — no row is dragged to a *chosen* position —
yet `[Self,A,B] → [B,A,Self]` still satisfies `aIndex(1) < selfIndex(2)` and both
AS-064 and AS-065 tests stay green. The source-regex tests at `:222`/`:240`
(`{...listeners}` present, `SortableContext` imported) mirror the implementation
and contribute nothing.

### AS-065 — "survives a page reload" is not exercised at all

The produced `?people=` value is read back with `new URL(...).searchParams`
(`:182`) and never fed through `parsePeopleParam`, which *is* the content of
"survives a reload". Consequences:

- `serializePeopleParam` collapses a single-self selection to `"me"`
  (`lib/calendar/people-selection.ts:76-81`); no reorder test round-trips
  through the parser, so any serializer/parser divergence escapes.
- The week fixtures are `"2026-W38"` / `"2026-W39"` (`:150`, `:172`). The app's
  week key is Monday-anchored `YYYY-MM-DD` (`lib/calendar/week-grid.ts:35`), so
  `parseWeekKey("2026-W39")` returns `null` and the page falls back to
  `currentWeekKey(timezone)`. `expect(url).toContain("week=2026-W39")` (`:179`)
  asserts preservation of a string that would not survive a reload.
- The absent-`?week=` case is untested: `weekParam` is optional
  (`stacked-planner.tsx:113`) and when absent the reorder URL drops `week`
  entirely (`:146-148`), so reordering on a default-week page silently
  re-resolves the week per viewer — compounding AS-014.
- `:187` ("a drag that doesn't change position does NOT call `router.replace`")
  performs no interaction at all (`// No keyboard interaction at all`). It
  asserts that rendering doesn't navigate. Vacuous w.r.t. the
  `active.id === over.id` guard at `:128` it claims to cover.

Escaping mutation: `stacked-planner.tsx:146` →
`params.set("week", parseWeekKey(weekParam) ? "1970-01-01" : weekParam)`.
Every real-format week param is destroyed on reorder; all AS-065 tests stay green.

### AS-069 — the "no hours anywhere" net has holes an implementation would walk through

The code complies **today** — a sweep of `components/calendar/**` and the
calendar page finds no rendered hours/capacity/utilisation text. The tests would
not catch realistic reintroductions:

1. **The most obvious string matches nothing.** The source patterns
   (`tests/unit/f036-stacked-scroll-colour.test.tsx:138-145`) require a suffix
   (`total|·|/`) or the literal word "hours"; the render patterns (`:317`)
   require `total|·|/|booked|load` after the `h`. A bare `{hours}h` badge escapes
   every check. A bare `80%` pill escapes `/\d+%\s*(load|booked|capacity|utili)/i` (`:321`).
2. **The source scan is a hardcoded 7-file list** (`:127-135`). It misses
   `week-agenda.tsx`, `calendar-block-chip.tsx`, `time-off-day-strip.tsx`,
   `add-block-popover.tsx`, `calendar-block-popover-form.tsx`,
   `client-presentation-banner.tsx`.
3. **Render coverage is three surfaces** — `PlannerHeader`, `StackedPersonRow`,
   `StackedPlanner`. Never rendered: the entire week-grid branch
   (`week-view.tsx`, `week-time-grid.tsx`), block popovers (`CalendarBlockChip`'s
   `PopoverContent` never opens), and `TimeOffDayStrip` — `:280-322` passes no
   `timeOffByUser`, so `hasTimeOff` is false and the strip never mounts, despite
   being in the assertion's scope.

Escaping mutation: add `<span>{bookedHours}h</span>` to
`components/calendar/week-agenda.tsx`, or `80%` to `planner-header.tsx`. Suite green.

## Major

### AS-063 — the fixture cannot distinguish URL order from roster order

`tests/unit/f032-stacked-shell.test.tsx:76-118` correctly chooses ids that defeat
a `[...selectedUserIds].sort()` mutation. But `orderedMembers` (`:87-92`) is in
the **same order** as `orderedSelectedUserIds`, as is the module-level pair
(`:28` vs `:30-34`). So this mutation in `stacked-planner.tsx:163` escapes both:

```
members.filter((m) => selectedUserIds.includes(m.userId))
       .map((m) => { const userId = m.userId; ... })
```

That is precisely the bug AS-063 exists to prevent: in production `members` comes
from `buildSwitcherMembers` (roster order, typically name-sorted), so rendered
rows would silently ignore the URL order.
`tests/unit/f102-calendar-page-composition.test.tsx:52-60` only proves
`parsePeopleParam` preserves order — it never renders rows.

### AS-068 — the height bound is only source-grepped

Passing, but `:121-124` is a bare source grep for `/max-h-\[/` anywhere in the
file. Changing `max-h-[calc(100vh-200px)]` → `max-h-[100000px]`, or moving the
`max-h-[...]` onto an inner decorative div while the scroll container gets none,
keeps both AS-068 tests green while the container never scrolls. Also,
`SortableRow` (`stacked-planner.tsx:64-69`) carries no `shrink-0` of its own.

## Minor

- **AS-067**: a per-person tint applied as a row wrapper (`filter: hue-rotate`,
  a coloured `ring`, or row `opacity`) leaves chip inline styles untouched and
  escapes. No test asserts the row container carries no colour styling.
- **AS-022**: `percentOffset` in `components/calendar/stacked-person-row.tsx:89-94`
  — dropping the `+ d.getUTCMinutes() / 60` term escapes every test, because
  every fixture uses whole-hour boundaries and the function is component-local.
- **AS-022 (evidence hygiene)**: the `TZ=America/Los_Angeles` block at
  `tests/unit/planner-stacked-window.test.ts:267-294` is theatre — setting
  `process.env.TZ` in `beforeAll` after Node has initialised does not change the
  timezone, so that describe re-runs under the default TZ.
- **`planner-stacked-window.test.ts:15-17`** (`expect(STACKED_DAYS).toEqual([1,2,3,4,5])`)
  is a vacuous constant re-read. Not load-bearing (the f033 render tests carry
  AS-019) but it should not be counted as evidence.
- **Repo hygiene / lint gate**: `tests/unit/zz-dbg.test.tsx` is an untracked
  debug scratch file left behind by a worker. It is the *only* source of the
  eslint failure (3 errors, 1 warning). It also runs as part of the unit suite
  and `console.log`s. It must be deleted before the AS-074 final gate.

## Recommended follow-up features

**F112 — Make the planner week viewer-independent for shared URLs (AS-014, blocker).**
Today `page.tsx:102-103` resolves the week from the viewer's `profiles.timezone`,
so two members with identical access rights opening the same `?people=a,b` URL
without `?week=` can land on different weeks. Decide and implement a single
deterministic rule — the most defensible is: whenever `?people=` is present the
page must emit an explicit `?week=` (redirect or canonicalise on first render)
so the URL fully determines the week, leaving timezone to affect only intra-day
rendering, not week identity. Back it with a test that renders/derives the page
inputs twice with two different viewer identities *and* two different profile
timezones against the same URL, asserting an identical resolved `weekKey` and an
identical resolved `selectedUserIds`. Delete or rewrite the tautological
AS-014 tests at `f031-page-layout-derivation.test.tsx:99-125` and
`f102-calendar-page-composition.test.tsx:183`, which compare literals.

**F113 — De-vacuate the reorder tests (AS-064, AS-065, blocker).**
Rewrite `tests/unit/f035-stacked-reorder.test.tsx` so it proves the drop target
is honoured and the result is reload-durable. Use at least four rows and perform
a non-adjacent move; assert the resulting **DOM order** of
`[data-testid^="stacked-person-row-"]` nodes equals the exact expected
permutation (not a relative pair check), by re-rendering with the new
`selectedUserIds` parsed back out of the written URL. Feed the written
`?people=` value through `parsePeopleParam` and assert it yields exactly the
expected order — that is the actual content of "survives a page reload". Replace
the `"2026-W38"`/`"2026-W39"` week fixtures with real Monday-anchored
`YYYY-MM-DD` keys that `parseWeekKey` accepts, add a case where `?week=` is
absent (asserting the reorder does not silently drop the week), and make the
no-op-drag test actually perform a drag that lands on its origin. Verify the
suite fails under `const nextOrder = [...selectedUserIds].reverse()`.

**F114 — Turn the AS-069 sweep into a real net (AS-069, blocker).**
Replace the hardcoded 7-file list in `tests/unit/f036-stacked-scroll-colour.test.tsx:127-135`
with a glob over `components/calendar/**/*.tsx` plus the calendar page, so new
planner components are covered automatically. Loosen the patterns to
`/\b\d+\s*h(rs?|ours?)?\b/i` and `/\b\d+\s*%/` with a narrow, explicitly
justified allowlist for legitimate clock labels (`08:00`, weekday headers), so a
bare `40h` badge or `80%` pill is caught. Extend the render-level sweep to the
surfaces currently never mounted: the week-grid branch (`week-view.tsx` /
`week-time-grid.tsx`), an **opened** `CalendarBlockChip` popover, and a
`StackedPlanner` rendered with a populated `timeOffByUser` so `TimeOffDayStrip`
actually mounts. Verify by temporarily adding `<span>32h</span>` to
`week-agenda.tsx` and confirming a failure.

**F115 — Prove row order follows the URL, not the roster (AS-063, major).**
The AS-063 fixture in `tests/unit/f032-stacked-shell.test.tsx:76-118` uses a
`members` array in the same order as `selectedUserIds`, so it cannot tell the
two apart. Shuffle the fixture so `orderedMembers` is in a *different* order from
`orderedSelectedUserIds` (e.g. members `[Alice, Bob, Carol]` while selecting
`[Carol, Alice, Bob]`), and assert the DOM order of
`[data-testid^="stacked-person-row-"]` nodes rather than `textContent.indexOf`.
Confirm the test fails under a `members.filter(...).map(...)` render in
`stacked-planner.tsx:163`.

**F116 — Pin the scroll container's height bound and row incompressibility at render level (AS-068, major).**
`f036-stacked-scroll-colour.test.tsx:121-124` only greps the source for
`/max-h-\[/`, so moving the bound onto a sibling div or inflating it to
`max-h-[100000px]` goes undetected. Assert at render level that the element
carrying `overflow-y-auto` is the same element carrying a viewport-relative
`max-h-[calc(...)]`, and add `shrink-0` to `SortableRow`
(`stacked-planner.tsx:64-69`) with a matching assertion, so a `min-h-0` added
there is caught. Also add a small guard for AS-067 asserting the row container
and `SortableRow` carry no colour-bearing style (`filter`, `opacity`, coloured
`ring`/`bg-[#...]`), closing the per-person-wrapper-tint escape.

**F117 — Cover half-hour block geometry and delete the leftover debug test (AS-022, minor; AS-074 hygiene).**
Every stacked-window fixture uses whole-hour boundaries, so dropping the
`+ d.getUTCMinutes() / 60` term from `percentOffset`
(`components/calendar/stacked-person-row.tsx:89-94`) escapes the entire suite.
Add render-level cases for a 09:30–10:30 block, a multi-day block appearing in
two columns with the same block id, and a block clipped at the bottom edge
(`top + height === 100%`). In the same feature, delete the untracked scratch file
`tests/unit/zz-dbg.test.tsx` — it is the sole cause of the eslint failure (3
errors, 1 warning) and would block the AS-074 final gate — and remove or fix the
non-functional `process.env.TZ` block at `tests/unit/planner-stacked-window.test.ts:267-294`
plus the vacuous `expect(STACKED_DAYS).toEqual([1,2,3,4,5])` at `:15-17`.

## Gate output

### Typecheck — PASS

```
$ npx tsc --noEmit
(no output, exit 0)
```

### Lint — FAIL (1 file, all from an untracked scratch file)

```
$ npx eslint . --ext .ts,.tsx

/Users/sasajapranin/Desktop/pm-app/tests/unit/zz-dbg.test.tsx
   3:10   warning  'describe' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
   7:109  error    Unexpected any. Specify a different type                                    @typescript-eslint/no-explicit-any
   9:194  error    Unexpected any. Specify a different type                                    @typescript-eslint/no-explicit-any
  10:178  error    Unexpected any. Specify a different type                                    @typescript-eslint/no-explicit-any

✖ 4 problems (3 errors, 1 warning)
exit=1
```

`tests/unit/zz-dbg.test.tsx` is untracked (`git status` → `?? tests/unit/zz-dbg.test.tsx`)
and is a leftover worker debug scratch file. No other file in the repo lints dirty.

### Tests — full suite

```
$ npx vitest run
 Test Files  292 failed | 588 passed | 2 skipped (882)
      Tests  310 failed | 4637 passed | 1682 skipped (6629)
exit=1
```

All 292 failing files are `tests/integration/**`. Cause is environmental — no
reachable Supabase instance:

```
 FAIL  tests/integration/add-comment.test.ts > addComment (F059: AS-094, AS-095)
Error: Failed to create test workspace: TypeError: fetch failed
 ❯ tests/integration/add-comment.test.ts:102:15
```

### Tests — unit only

```
$ npx vitest run tests/unit
 Test Files  41 failed | 478 passed | 1 skipped (520)
      Tests  133 failed | 3348 passed | 3 skipped (3484)
exit=1
```

The 41 failing unit files are **all from other missions** (sitemap / section-card
/ board / list features) and are pre-existing. Representative cause, unrelated to
M7:

```
$ npx vitest run tests/unit/f008-section-card.test.tsx
Error: useArchitectureActions must be used within an ArchitectureActionsProvider
```

Failing files: f003-page-client-visibility-toggle, f003-section-client-visibility-toggle,
f006-section-card-menu-kind-row, f007-cms-badge-section-card, f008-section-card,
f009-board-layout, f011-slug-proposal, f013-create-section, f014-rename-page,
f015-rename-section, f016-change-page-kind, f017-delete-section, f018-delete-page,
f020-reorder-sections, f022-reorder-columns, f023-keyboard-dnd, f024-drag-cancellation,
f024-section-card-details-data, f025-section-card-node-meta-icon, f026-component-picker,
f026-meta-bound-to-section, f027-instance-display, f032-visual-distinction,
f033-hover-highlighting, f034-component-panel, f035-component-detail,
f036-rename-delete-panel, f044-page-column-slug-editor, f045-create-page-dialog-page-kind,
f048-component-panel-dnd, f060-discipline-estimate-schema, f081-board-performance,
f083-note-validation-ui, f084-keyboard-accessibility, f085-sortable-section-list-details-data,
f096-invalidate-details-chain, f097-page-column-header-icon-state, f104-page-column-chain,
f250-list-inline-edit, list-due-date-cell-empty-state, list-due-date-cell-optimistic.

### Tests — M7 suites only

```
$ npx vitest run tests/unit/f031-page-layout-derivation.test.tsx \
    tests/unit/f032-stacked-shell.test.tsx tests/unit/f033-stacked-row-grid.test.tsx \
    tests/unit/f034-time-off-strip.test.tsx tests/unit/f035-stacked-reorder.test.tsx \
    tests/unit/f036-stacked-scroll-colour.test.tsx \
    tests/unit/f102-calendar-page-composition.test.tsx \
    tests/unit/planner-stacked-window.test.ts tests/unit/planner-layout.test.ts

 Test Files  9 passed (9)
      Tests  85 passed (85)
```

All M7 tests are green. That is precisely the problem: four of them are green for
reasons unrelated to the behaviour they claim to protect.
