# M7 — The stacked layout — Scrutiny pass 3

**Verdict: REJECT.** 4 blockers, 7 majors, 2 minors.

Real progress since pass 2. Five of the six pass-2 blockers are genuinely
closed, verified by applying the pass-2 mutations to a scratch copy and
watching the suite go red: `top: "0%"` is now killed (AS-022), the
zero-block-person early return is killed (AS-024), dropping `userLabel` is
killed (AS-062), `HOURS length: 24 → 9` is killed (AS-002, `f098`), and the
AS-063 ordering fixture still holds.

**The AS-001/AS-059 scoping leak is still open**, now for a different reason
than in pass 2, and AS-066 remains blocked on a contract-vs-schema conflict
that has survived three passes without an orchestrator decision.

## Headline: F096 hardened the signature, not the argument

F096 made `userIds` a required fourth parameter of `getCalendarBlocks`, so
*omitting* it is now a compile error. That closes exactly one mutation. It
does nothing about the argument's *contents*, which is where the assertion
lives.

Surviving mutation, applied and run — 44 calendar suites green:

```
app/(workspace)/w/[workspaceSlug]/calendar/page.tsx:139
const blockUserIds = buildBlockUserIds(selectedUserIds).concat(activeMemberIds);
```

Every source regex in `tests/unit/f031-page-layout-derivation.test.tsx:202-211`
still matches — `buildBlockUserIds(selectedUserIds)` is present verbatim, and
so is `blockUserIds={blockUserIds}`. A no-parameter Planner load now fetches
every workspace member's blocks. `buildBlockUserIds` remains a literal
identity function (`lib/calendar/workspace-members.ts:41-43`), so the AS-059
scoping test at `f031:195-200` is still a tautology.

The root cause is unchanged across all three passes: **nothing in the repo
renders `CalendarPage`.** Which ids reach the query, which layout is chosen,
how the selection is ordered, and how many day columns are emitted are all
guarded only by regexes over `page.tsx` read as a string.

## Assertion results

| ID | Result | Reason |
|---|---|---|
| AS-001 | FAIL (blocker) | `page.tsx:139` `.concat(activeMemberIds)` survives all 44 calendar suites; every member's blocks leak. F096 fixed omission, not contents. |
| AS-002 | FAIL (major, was blocker) | 24-hour half now genuinely enforced — `f098-week-grid-24h.test.tsx` dies on `length: 9`. The **7-day half is not**: `components/calendar/week-view.tsx:89,97` → `days={week.days.slice(0, 5)}` survives. `calendar-week-grid.test.ts:25` only proves `buildCalendarWeek` returns 7; nothing connects that to the render. |
| AS-014 | FAIL (major) | `page.tsx:126-129` reordering the parsed selection self-first (`[user.id, ...parsed.filter(id => id !== user.id)]`) survives. Two members open the same URL and get different row orders. The only test exercises `parsePeopleParam` in isolation, which the mutation does not touch. |
| AS-015 | FAIL (major) | All five guards (`f031:127-186`) are source regexes on `searchParams.view`, the destructure line, and `resolvePlannerLayout`'s arg list, plus one `@ts-expect-error`. Defeated by `const sp = await searchParams as Record<string,string\|undefined>; const forced = sp["vi"+"ew"];` — `?view=stacked` overrides the layout, suite green. |
| AS-018 | PASS | `stacked-hour-1-{8..15}` present, 0–7/16–23 absent; `STACKED_START_HOUR = 7` and `STACKED_END_HOUR = 17` both die. |
| AS-019 | PASS | `stacked-day-1..5` present, 6/7 absent; `STACKED_DAYS = [1..7]` dies. |
| AS-020 | FAIL (major) | `lib/calendar/stacked-window.ts:112` `<` → `<=` survives (31/31 green, verified). Every fixture is *strictly* outside. Probe confirms the mutant emits a real `stacked-block-<id>-1` chip at height 0% for `16:00→17:00` and `06:00→08:00` — blocks AS-020 says must not render. In the DOM: hit-testable and screen-reader-visible. |
| AS-021 | PASS (minor) | `STACKED_DAYS` and the weekday filter both die under mutation. The AS-021 test itself only probes `stacked-block-<id>-{1..5}` and would miss a weekend block rendered into a 6th column; it survives only because the AS-019 test independently asserts columns 6/7 are absent. Not self-sufficient. |
| AS-022 | **PASS** | Pass-2 blocker closed. `top: "0%"` at `stacked-person-row.tsx:211` is now killed by `test_AS_022_block_top_position_nonzero`. |
| AS-023 | FAIL (major) | `resolvePlannerLayout` is genuinely tested in isolation (`<= 1` → `< 1` dies). The page's *use* of it is regex-pinned only: `page.tsx:245` → `if (layout === "stacked" \|\| selectedUserIds.length >= 1)` keeps the literal the regex demands and never returns to the week grid. Contrived, but nothing catches it, and no test asserts the single→stacked→single round trip on rendered output. |
| AS-024 | **PASS** | Pass-2 blocker closed. The zero-block early-return kills four tests. Noted: the "AS-024 mutation guard" at `f032:120-145` is still vacuous — it builds its own filtered array and asserts a fixture; it passed under *every* mutation applied this pass. Real coverage comes from `f032:60`. |
| AS-062 | **PASS** | Pass-2 major closed. Dropping the `userLabel` div (`stacked-person-row.tsx:130-132`) and substituting `userId` for the name (`stacked-planner.tsx:167`) both die. |
| AS-063 | PASS | Holds. `[...selectedUserIds].sort()` dies on the `carol/alice/bob` fixture. |
| AS-064 | FAIL (blocker) | Three killer mutations survive 5/5. (1) Deleting `{...listeners}` at `stacked-planner.tsx:76` — the row becomes completely undraggable; the guard at `f035:128-134` asserts `aria-roledescription`/`tabIndex`, which come from `attributes` (line 75), aimed at the wrong spread. (2) Deleting `sensors={sensors}` at `:155` — the suite mocks `DndContext` away entirely (`f035:19-34`), so no prop on it is ever observed. (3) The behavioural tests invoke a captured `onDragEnd` synthetically. **No test asserts a gesture moves a row.** |
| AS-065 | FAIL (major) | Deleting the `if (weekParam) params.set("week", weekParam)` block at `stacked-planner.tsx:146-148` survives 5/5: `renderPlanner` (`f035:56-67`) never passes `weekParam`, so the branch is dead in every test. A reorder silently drops the user out of the week they were viewing — the order survives the reload, the week does not. |
| AS-066 | FAIL (blocker — spec conflict, third pass) | `time_off_entries` has **no approval or status column**: `supabase/migrations/20261114010000_time_off_entries.sql:16-28` is `id, workspace_id, user_id, start_date, end_date, note, created_at`; `lib/queries/time-off.ts:54` selects none. "Approved" has no referent and is unfalsifiable. The word survives only in comments (`stacked-planner.tsx:97`, `stacked-person-row.tsx:106`) where it misdescribes the data model. Two further survivors: deleting `timeOffEntries={timeOffByUser?.get(userId) ?? []}` (`stacked-planner.tsx:178`) keeps 24/24 green because **no test passes `timeOffByUser` to `StackedPlanner`** — the planner→row wiring is entirely unguarded; and `entries={timeOffByDate[dateKey]}` → `entries={timeOffEntries}` (PTO in all five columns) keeps 4/4 green because `f034:51` asserts text on the whole strip container, not a column. |
| AS-067 | PASS (minor) | `f036:65-92` renders two differently-coloured blocks in one row and asserts distinct computed `borderColor`; a per-person substitution inside the row dies. Narrow: the suite never varies `userId`, so a `userId`-keyed override survives. |
| AS-068 | FAIL (major) | Both checks (`f036:94-104`) are `readFileSync` + regex. Verified: replacing `max-h-[calc(100vh-200px)] overflow-y-auto` at `stacked-planner.tsx:159` with a plain `flex flex-col gap-3` plus a `/* was: ... */` comment passes 5/5. The container then compresses exactly as the assertion forbids. No test renders many members or inspects a computed style. |
| AS-069 | FAIL (major) | Negative source scan over two files with five patterns. Verified: rendering `` `${blocks.length * 8} h booked · 100% load` `` in `stacked-person-row.tsx` passes 5/5 — an hours total and a utilisation percentage on screen, dodging the wordlist. `planner-header.tsx`, `week-view.tsx`, `time-off-day-strip.tsx` and `page.tsx` are not scanned at all, so "anywhere" is uncovered. |
| AS-059 | SPLIT: PASS (fallback) / FAIL (blocker, scoping) | Fallback is real: `f029-switcher-url-wiring.test.tsx:145` drives the live switcher and the `parsePeopleParam` empty-fallback mutation dies. Scoping is the AS-001 blocker; `f031:195-200` asserts an identity function against itself. |

## Suite health

`tsc --noEmit` clean. `eslint` clean. The eight M7 suites are **62/62 green in
1.75s**.

The full `vitest run` reports **292 failed files / 310 failed tests out of
6608**. None of them are calendar or planner suites — the failures cluster in
`f048`, `f060`, `f081`, `f083`–`f085`, `f096`, `f097`, `f104`, `f250`,
`list-due-date-cell-*` and one Supabase-network integration test, all
belonging to other missions. This is **pre-existing breakage outside M7's
scope**, but it means the repo has no green full-suite gate, and AS-074/AS-075
in M8 will not be satisfiable until it is addressed. Flagging, not blocking
M7 on it.

Note a naming hazard for future audits: `tests/unit/f096-*.test.tsx` and
`f097-*.test.tsx` belong to an unrelated mission, and `f029-unlink-instance.test.ts`
matches an `AS-059` from a different contract. Auditing by assertion id alone
will produce false positives here.

## Systemic observation, third pass running

Every remaining failure in this milestone is one of two shapes:

1. **A source-text regex standing in for a behavioural assertion.** AS-015,
   AS-068, AS-069, and the AS-001/AS-023 page guards. A test that reads a file
   as a string can only prove that some characters are present; all four were
   defeated this pass by mutations that keep the characters and change the
   behaviour.
2. **A prop that no test ever supplies**, so the code path consuming it is
   dead in the suite. AS-065's `weekParam` and AS-066's `timeOffByUser` are
   both deletable with a green suite for this reason. `stacked-planner.tsx:132-135`
   (`if (!workspaceSlug || !selfId) return;`) and `:139` (`fromIndex/toIndex === -1`)
   remain silent swallows with zero coverage.

Pass 2 recommended replacing every such guard with a render or a spy. F095–F099
did that for three assertions and those three now pass. The remaining ones were
not converted.

**Recommendation to the orchestrator: stop filing one follow-up per assertion.**
A single test that renders `CalendarPage` with stubbed queries closes AS-001,
AS-002, AS-014, AS-015, AS-023 and AS-059 at once, and is cheaper than six
more regex patches.

## Recommended follow-up features

**A. One RSC-level Planner composition test (AS-001, AS-002, AS-014, AS-015,
AS-023, AS-059 — blocker).** Invoke `CalendarPage` with `getWorkspaceMembers`
and `getCalendarBlocks` mocked, and assert on the call arguments and the
rendered tree rather than on `page.tsx`'s source text. Four assertions in one
test: with no query parameters, `getCalendarBlocks` is called with a fourth
argument deep-equal to `[selfId]` and the rendered output contains 7 day
columns and 24 hour rows; with `?people=a,b` it receives exactly `["a","b"]`
and renders `StackedPlanner` with no 24-hour grid; the same URL rendered under
two different `selfId` values produces identical people-order and week output;
and `?view=stacked` with a single person still renders the week grid. Then
delete the identity test on `buildBlockUserIds`, the five `?view=` regexes at
`f031:127-186`, and the two call-site regexes at `f031:202-211` — they
contribute nothing and create false confidence. Target mutations to kill:
`.concat(activeMemberIds)` at `page.tsx:139`, `days={week.days.slice(0, 5)}`
at `week-view.tsx:89,97`, the self-first reorder at `page.tsx:126-129`, and
`layout === "stacked" || selectedUserIds.length >= 1` at `page.tsx:245`.

**B. Make the drag gesture real (AS-064, AS-065 — blocker).** The current
suite mocks `DndContext` away and invokes `onDragEnd` by hand, so no prop on
the DnD tree is observed and no gesture is ever performed. Either drive a real
pointer sequence against the unmocked dnd-kit tree (a `PointerEvent` polyfill
plus `pointerdown`/`pointermove`/`pointerup` on the handle), or move AS-064 to
the Playwright e2e tier where the drag is genuine. Whichever tier is chosen,
the two mutations that must die are deleting `{...listeners}` at
`stacked-planner.tsx:76` and deleting `sensors={sensors}` at `:155`. For
AS-065, pass `weekParam` in `renderPlanner` and assert the rewritten URL keeps
both `people=` in the new order and the original `week=` value, and that the
path is the full `/w/<slug>/calendar` rather than a bare `/calendar`.

**C. Exact-boundary fixtures for the stacked window (AS-020 — major).** Add
unit cases to `planner-stacked-window.test.ts` asserting
`clipBlockToStackedWindow` returns `[]` for a weekday `07:00–08:00` and a
weekday `16:00–17:00`, plus a render assertion in `f033` that no
`stacked-block-*` element exists for either. This kills the `<` → `<=`
mutation at `stacked-window.ts:112`, which today puts a zero-height,
hit-testable chip in the DOM on a day the block must not appear.

**D. Resolve AS-066's approval semantics (blocker — orchestrator decision,
third time of asking).** The contract is immutable and "Approved time off" has
no referent in the schema, so this cannot be closed by a worker. Either add a
status column to `time_off_entries` with a default and a filter in
`lib/queries/time-off.ts`, or record the resolved semantics ("all recorded
time off is shown") as a *new* assertion id. Do not mark AS-066 passed on the
current implementation. Independently of that decision, two test gaps need
closing: a `StackedPlanner`-level test that actually passes `timeOffByUser`
and asserts the strip reaches the right member's row, and a per-day column
assertion so that attributing every entry to every column fails.

**E. Convert the two negative/structural source scans to render assertions
(AS-068, AS-069 — major).** For AS-068, render `StackedPlanner` with enough
members to overflow and assert on the actual scroll container element's class
list or computed `overflow-y`, and add coverage for the `min-h-[6rem]` floor
at `stacked-person-row.tsx:138`, which appears nowhere in `tests/`. For
AS-069, scan rendered `container.textContent` across the whole Planner tree
for `/\d+\s*h\b/` and `/%/` instead of grepping two files for five spellings —
the current wordlist misses `{sumHours}h`, `Load 87%` and `Util.`, and misses
`planner-header.tsx`, `week-view.tsx` and `page.tsx` entirely.

**F. Two cheap test-hygiene fixes (minor).** Delete or invert the vacuous
"AS-024 mutation guard" at `f032:120-145`, which asserts a fixture it builds
itself and passed under every mutation applied this pass. Tighten the AS-021
test at `f033:90` to also assert no `stacked-block-saturday-block-6` exists,
so it stops depending on the AS-019 test for its bite.

**G. Cover the silent swallows (minor).** `stacked-planner.tsx:132-135`
returns silently when `workspaceSlug` or `selfId` is missing, and `:139`
returns silently on `fromIndex/toIndex === -1`. Neither has coverage, and
nothing pins that `page.tsx:271-282` supplies those props — delete all three
and drag-to-reorder stops persisting in production with a green suite.

---

## Toolchain output

### `npx tsc --noEmit`

```
(no output — clean, exit 0)
```

### `npx eslint app components lib tests --ext .ts,.tsx`

```
(no output — clean, exit 0)
```

### `npx vitest run` (M7 suites only)

```
 Test Files  8 passed (8)
      Tests  62 passed (62)
   Duration  1.75s

tests/unit/f031-page-layout-derivation.test.tsx
tests/unit/f032-stacked-shell.test.tsx
tests/unit/f033-stacked-row-grid.test.tsx
tests/unit/f034-time-off-strip.test.tsx
tests/unit/f035-stacked-reorder.test.tsx
tests/unit/f036-stacked-scroll-colour.test.tsx
tests/unit/f098-week-grid-24h.test.tsx
tests/unit/planner-stacked-window.test.ts
```

### `npx vitest run` (full suite)

```
 Test Files  292 failed | 586 passed | 2 skipped (880)
      Tests  310 failed | 4616 passed | 1682 skipped (6608)
   Duration  279.13s
```

Failing files, deduplicated by suite (none in M7 scope):

```
tests/integration/f011-decide-approval-creates-task.test.ts   (AS-025, live Supabase)
tests/unit/list-due-date-cell-optimistic.test.tsx
tests/unit/list-due-date-cell-empty-state.test.tsx
tests/unit/f250-list-inline-edit.test.tsx
tests/unit/f104-page-column-chain.test.tsx
tests/unit/f097-page-column-header-icon-state.test.tsx
tests/unit/f096-invalidate-details-chain.test.tsx
tests/unit/f085-sortable-section-list-details-data.test.tsx
tests/unit/f084-keyboard-accessibility.test.tsx
tests/unit/f083-note-validation-ui.test.tsx
tests/unit/f081-board-performance.test.tsx
tests/unit/f060-discipline-estimate-schema.test.tsx
tests/unit/f048-component-panel-dnd.test.tsx
... (remainder follow the same pattern: board/list/page-column missions)
```

Representative failure (`list-due-date-cell-optimistic.test.tsx:163`):

```
 ❯ tests/unit/list-due-date-cell-optimistic.test.tsx:163:28
    161|
    162|     await waitFor(() =>
    163|       expect(editTaskMock).toHaveBeenCalledWith("task-1", { dueDate: n…
       |                            ^
    164|     );
 ❯ runWithExpensiveErrorDiagnosticsDisabled node_modules/@testing-library/dom/dist/config.js:47:12
 ❯ checkCallback node_modules/@testing-library/dom/dist/wait-for.js:124:77
```
