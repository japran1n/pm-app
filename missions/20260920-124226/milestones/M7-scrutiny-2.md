# M7 — The stacked layout — Scrutiny pass 2

**Verdict: REJECT.** 6 blockers, 11 majors, 1 minor.

Pass 1 raised 5 blockers and 10 majors. Only the 5 blockers got follow-up
features (F090–F094); the 10 majors were never addressed and all of them
reproduce this pass. Of the 5 blocker fixes, **one is genuinely fixed
(F092/AS-063)**, two are partial (F093/AS-064, F091/AS-015 — both downgrade
from blocker to major), one fixed a *different* thing than the assertion it
was filed under (F094 hardened the F088 header-lift regression test, but
AS-023 itself is still vacuous), and **one did not fix its blocker at all
(F090/AS-001+AS-059)**.

## The headline finding: F090 did not close the AS-001/AS-059 leak

F090's stated purpose was to replace a source regex with a data-flow test so a
dropped 4th argument to `getCalendarBlocks` could not silently leak every
member's blocks. It did not do that. What shipped:

- `lib/calendar/workspace-members.ts:41` — `buildBlockUserIds` is
  `return [...selectedUserIds];`, a pure identity function.
- `tests/unit/f031-page-layout-derivation.test.tsx:163` — asserts
  `buildBlockUserIds(["u1","u2"])` equals `["u1","u2"]`. This is a tautology;
  it can only fail if someone edits the helper body, which is not the failure
  mode.
- `tests/unit/f031-page-layout-derivation.test.tsx:170` — still two source
  regexes: `/buildBlockUserIds\(selectedUserIds\)/` and
  `/blockUserIds=\{blockUserIds\}/`. The second pins the prop handed to
  `WeekGridSection` (`page.tsx:173`), **not** the query call.

The surviving mutation is the original one, verbatim: delete the 4th argument
at `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx:241`. Both regexes
still match, the helper unit test still passes, and
`lib/queries/calendar-blocks.ts:84` treats `userIds === undefined` as
"no restriction" — so the Planner fetches every workspace member's blocks.

Verified independently: `grep -n getCalendarBlocks tests/unit/f031-page-layout-derivation.test.tsx`
returns exactly one hit, on line 160 — inside a comment. No test in the repo
asserts anything about the arguments `page.tsx` passes to `getCalendarBlocks`.

The comment F090 added at `workspace-members.ts:35-40` asserts the leak "can't
happen again". Nothing enforces it.

## Assertion results

| ID | Result | Reason |
|---|---|---|
| AS-001 | FAIL (blocker) | Dropping the 4th arg of `getCalendarBlocks` at `page.tsx:241` leaks all members' blocks; suite green. F090's helper test is an identity tautology. |
| AS-002 | FAIL (blocker) | The 24-hour half has **zero coverage repo-wide**. `week-time-grid.tsx:67` `length: 24` → `length: 9` survives the full suite. The named test only asserts `resolvePlannerLayout(1) === "week-grid"`. |
| AS-014 | FAIL (major) | Test uses `people=user-a,user-b`, a branch where `selfId` is provably unread (`people-selection.ts:55-72`) — structurally cannot vary by caller. `?people=all` self-first reordering survives. "Same week" untested; with no `?week=` the week derives from the *caller's* profile timezone (`page.tsx:103`), so two members can legitimately differ today. |
| AS-015 | FAIL (major, was blocker) | F091 added type/destructure/call-site regexes plus a `@ts-expect-error` on `resolvePlannerLayout`'s signature. All defeated by indirection: `const sp = await searchParams; const viewMode = (sp as Record<string,string\|undefined>)["view"]; const layout = viewMode === "stacked" ? "stacked" : derived;` — original destructure kept verbatim, no `view: string` type field, no `view` in the `resolvePlannerLayout(...)` args. `?view=stacked` overrides the layout with the suite green. |
| AS-018 | PASS | Eight `stacked-hour-1-{8..15}` testids asserted present, 0–7/16–23 absent (`f033:37-57`); constants pinned (`planner-stacked-window.test.ts:10-13`). Both boundary mutations die. Minor: only column 1 is probed. |
| AS-019 | PASS | `stacked-day-1..5` present, 6/7 absent (`f033:59-72`); `STACKED_DAYS` pinned. |
| AS-020 | FAIL (major) | `lib/calendar/stacked-window.ts:112` `<` → `<=` survives (verified: 31/31 green). Every "outside" fixture is *strictly* outside (04:00–06:00, 17:00–19:00, 17:00–18:00). The exact-boundary cases 07:00–08:00 and 16:00–17:00 — the only ones the mutation affects — are tested nowhere. Under the mutation `stacked-person-row.tsx:198-221` renders a real `height: 0%` chip on a day it must not appear on. |
| AS-021 | PASS (minor) | Deleting the weekday filter (`stacked-window.ts:82-84`) kills 3 tests in `planner-stacked-window.test.ts`. The assertion is protected. Noted: the render-level test (`f033:90-107`) is *redundant* not independent — the Saturday segment is dropped by the `STACKED_DAYS` render loop (`stacked-person-row.tsx:168`) regardless of the clip. |
| AS-022 | FAIL (blocker) | Two independent gaps, both verified green under mutation. (1) Hardcoding `top: "0%"` at `stacked-person-row.tsx:211` passes the whole suite — the one render assertion (`f033:124`) uses a 06:00–10:00 block whose correct `top` *is* `0%`. (2) End-edge clipping has no render coverage: `grep .style.top` over `tests/` returns one hit. The 14:00–18:00 → top 75% / height 25% case exists only as a pure-function check. |
| AS-023 | FAIL (blocker) | `f031:32` is byte-for-byte the AS-001 test: `expect(resolvePlannerLayout(1)).toBe("week-grid")`. No narrowing, no URL transition, and nothing asserts the page *uses* the derived value. Mutation `page.tsx:134` → `resolvePlannerLayout(selectedUserIds.length + 1)` breaks AS-001, AS-002 and AS-023 at once and every test passes. F094 hardened the F088 header-lift test (real work, genuinely stronger) but that guards reachability of the switcher, not AS-023's round trip. |
| AS-024 | FAIL (major) | `f032:71-73` asserts only that Mo's *name text* exists. Early-returning `<div>{userLabel}</div>` for zero-block people leaves Mo with no row wrapper and no grid; all tests pass. No test queries `stacked-person-row-<id>`. The "AS-024 mutation guard" at `f032:120-145` builds the filtered list itself and asserts Mo is absent — it exercises the fixture, not the component. |
| AS-062 | FAIL (major) | Label→row association is document-order-only (`getByText` + concatenated `textContent`). Rendering names as a sibling header list above the rows and dropping the `userLabel` prop (`stacked-planner.tsx:174`) keeps both tests green with no row labelled. |
| AS-063 | **PASS** | F092 is a real fix. `f032:84-117` uses `carol-id / alice-id / bob-id` so `[...selectedUserIds].sort()` reorders and the `>` index chain at `:115-117` fails. No plausible ordering mutation survives. |
| AS-064 | FAIL (major, was blocker) | F093 genuinely kills the plain-`<div>` mutation (`f035:122-136` requires the handle with `aria-roledescription="sortable"`). But dropping `{...listeners}` at `stacked-planner.tsx:76` while keeping `{...attributes}` survives: `aria-roledescription`, `tabIndex` and `role` all come from `attributes`; `listeners` carries the pointer/key handlers. The row becomes completely undraggable, suite green. Also survives: deleting `sensors={sensors}` (`:155`). No test simulates a drag gesture — `onDragEnd` is always invoked synthetically. |
| AS-065 | FAIL (major) | The reorder itself is pinned (`f035:99-112`). But **no test passes `weekParam` to `StackedPlanner` at all**, so deleting `if (weekParam) params.set("week", weekParam)` (`stacked-planner.tsx:146-148`) survives — after reload the user lands on the default week, i.e. the order does not survive reload as experienced. Corrupting the path (`/w/${slug}/calendar` → `/calendar`) also survives: tests only `toContain("?people=")` and parse the query relative to `http://localhost`. |
| AS-066 | FAIL (blocker — spec conflict) | **"Approved" has no referent in the schema.** `supabase/migrations/20261114010000_time_off_entries.sql:16-26` defines `id, workspace_id, user_id, start_date, end_date, note, created_at` — no `status`, `approved`, `state`. `lib/queries/time-off.ts:52` selects none. Every entry renders unconditionally; the word "Approved" is unfalsifiable. Additionally (major): wrong-column attribution survives — replacing `entries={timeOffByDate[dateKey] ?? []}` (`stacked-person-row.tsx:157`) with `Object.values(timeOffByDate).flat()` keeps all 4 tests green (PTO in all five columns); the only positive test asserts text content on the *whole strip container*, and the columns carry no per-day testid so column identity isn't addressable. Wrong-*member* attribution is entirely untested — `grep timeOffByUser tests/` returns nothing. |
| AS-067 | PASS (weak, minor) | `f036:47-92` asserts real computed `borderColor`/rgb per chip with two differently-coloured blocks in one row; a per-person substitution inside the row dies. Not defended one level up: injecting a colour override in `stacked-planner.tsx:177` or in `page.tsx:248-256`'s bucketing loop kills nothing. |
| AS-068 | FAIL (major) | Both checks (`f036:94-104`) are source-text regexes over `stacked-planner.tsx` read as a string. The file already carries a 19-line comment header, so deleting `overflow-y-auto max-h-[calc(100vh-200px)]` from `:159` and mentioning them in a comment is green. Separately, the "compressing" half is untested outright: `min-h-[6rem]` at `stacked-person-row.tsx:138` appears nowhere in `tests/`. |
| AS-069 | FAIL (major) | Assertion says "anywhere"; the test scans two files with five narrow patterns (`capacity`, `utili[sz]ation`, `total hours`, `hours total`, `%\s*(used\|utilised\|utilized\|capacity)`). An hours total added to `planner-header.tsx`, `week-view.tsx` or `page.tsx` is not scanned at all. Even inside the scanned files, `{sumHours}h`, `Load 87%` or `Util.` match nothing. |
| AS-054 | FAIL (major) | Multi-select accumulation is solid (`people-switcher-multiselect.test.tsx:56-127`, real clicks, growing arrays). Visibility is not: the only glyph is `components/ui/command.tsx:165`, and tests assert `data-checked="true"` plus "exactly one svg mounted". Deleting `group-data-[checked=true]/command-item:opacity-100` makes every tick permanently `opacity-0` — no visible selection indicator anywhere — with all tests green. The unselected-case test at `:428` explicitly asserts the icon stays mounted, ruling out conditional-mount detection. This is the F081 bug reintroducible at will. |
| AS-059 | SPLIT: PASS (fallback) / FAIL (blocker, scoping) | Fallback is genuinely exercised: `f029-switcher-url-wiring.test.tsx:145-168` renders the real `PeopleSwitcherUrlBound`, deselects the last member, asserts the pushed URL's `people` param is `me`; removing the guard at `people-switcher.tsx:299` fails it. Server-side `parsePeopleParam` empty→`[selfId]` is covered. The scoping half is the AS-001 blocker above — **the M6 caveat is still not closed.** |
| AS-011 | not re-reviewed (deferred pass 1) | |
| AS-055, AS-056 | not re-reviewed (deferred / out of M7 re-scope) | |

## Contract-vs-schema conflict — unchanged from pass 1, still needs an orchestrator decision

AS-066's "**Approved** time off" remains unimplementable as written. Pass 1
raised this; no follow-up feature was spawned. The contract is immutable, so
this needs either a schema feature adding an approval status plus a query
filter, or a new assertion recording the resolved semantics. **Do not mark
AS-066 passed on the current implementation.**

## Notable unlocked behaviour

`stacked-planner.tsx:132-135` — `if (!workspaceSlug || !selfId) return;` is a
silent swallow with zero coverage, and nothing pins that the page supplies
them. The call site (`page.tsx:271-282`) does pass `workspaceSlug`, `selfId`
and `weekParam`, but the only source scan over it
(`f088-planner-header-lift.test.tsx:159-161`) asserts only the *absence* of
`peopleSwitcher=`. Delete all three props and every test stays green while
drag-to-reorder silently stops persisting in production. Likewise
`fromIndex/toIndex === -1` (`:139`) returns silently, uncovered.

## Systemic observation

Three passes in, the same failure mode keeps shipping: **source-text regex
scanning used as a substitute for behavioural assertion**, and now a second
variant — **extracting a trivial helper and unit-testing its identity** to
make a data-flow claim that the call site never has to honour. F090 is the
clearest instance: it produced a new file, a new export, a new test and a
reassuring comment, and the mutation it was written to catch still survives.

A test that reads a file as a string and regexes it can only ever prove that
some characters are present. Every such guard in M7 should be treated as
absent coverage until it is replaced by a render or a spy.

## Recommended follow-up features

**A. Pin the `getCalendarBlocks` call site (AS-001, AS-059 — blocker).**
Make the scoping impossible to drop rather than merely tested. Change
`getCalendarBlocks`'s fourth parameter from `userIds?: readonly string[]` to a
required `userIds: readonly string[]`, so omitting it is a compile error that
`tsc --noEmit` catches at the call site — the whole class of leak disappears
rather than being policed. Update the three existing callers. Then add a real
data-flow test that mocks `lib/queries/calendar-blocks` and invokes the page's
data-fetching path with no query parameters, asserting the mock was called
with a fourth argument deep-equal to `[selfId]`, and with `?people=a,b`
asserting it receives exactly `["a","b"]`. Delete the identity test on
`buildBlockUserIds` and the two source regexes at
`f031-page-layout-derivation.test.tsx:170` — they contribute nothing and
create false confidence.

**B. Behavioural coverage for the default week grid (AS-002, AS-023 — blocker).**
Render `WeekView`/`WeekTimeGrid` in jsdom for a one-person selection and
assert 24 distinct hour labels (`00:00` through `23:00`) and 7 day columns are
present. Separately, assert that a single-person selection renders the week
grid and *not* `StackedPlanner`, and that a two-person selection renders
`StackedPlanner` and not the 24-hour grid — asserting the page's rendered
output rather than `resolvePlannerLayout`'s return value in isolation. The
target mutation to kill is `resolvePlannerLayout(selectedUserIds.length + 1)`
in `page.tsx:134`, which today breaks three assertions with a green suite.

**C. Render-level chip geometry for the stacked window (AS-022, AS-020 — blocker).**
Add a render test asserting a 14:00–18:00 block produces a chip with
`style.top === "75%"` and `style.height === "25%"`, killing the hardcoded-zero
mutation. Add exact-boundary fixtures 07:00–08:00 and 16:00–17:00 to
`planner-stacked-window.test.ts` expecting `[]`, and a render assertion that
no chip element exists for them — killing the `<` → `<=` mutation at
`stacked-window.ts:112`.

**D. Resolve the AS-066 approval semantics (blocker — orchestrator decision first).**
Decide whether an approval workflow is in scope. If yes: a migration adding a
status column to `time_off_entries` with a default, a filter in
`lib/queries/time-off.ts`, and a test proving a non-approved entry does not
render. If no: a new assertion ID recording that all recorded time off is
treated as approved, leaving AS-066 formally unmet and documented as such.
Either way this cannot be closed by a test change alone.

**E. Row identity and attribution in the stacked layout (AS-024, AS-062, AS-066-attribution — major).**
Give each strip column an addressable `data-date` attribute. Then assert, for a
zero-block person, that `stacked-person-row-<id>` exists, contains that
person's name, and contains a `stacked-grid`. Assert label→row containment with
`within(getByTestId('stacked-person-row-' + id)).getByText(name)` rather than
document order. Add a `StackedPlanner`-level test with two members where only
the second has time off, asserting the strip appears on the second member's row
only and in the correct day column.

**F. Real drag affordance and URL fidelity (AS-064, AS-065 — major).**
Assert the drag handle carries actual listeners, not just dnd-kit's static
`attributes` — e.g. fire a `keyDown` on the handle and observe dnd-kit's
drag-start announcement, or spy `useSortable` and assert the returned
`listeners` object is spread onto the handle. Kill the `{...listeners}`-removal
mutation. For AS-065, render `StackedPlanner` with a `weekParam` and assert the
rewritten URL both preserves `week` and starts with `/w/<slug>/calendar`; add a
`parsePeopleParam` round-trip on the rewritten value. Add a source or render
guard pinning that `page.tsx` passes `workspaceSlug`, `selfId` and `weekParam`
to `<StackedPlanner>`, and replace the silent `return` at
`stacked-planner.tsx:132-135` with a development-time error so the no-op cannot
ship unnoticed.

**G. Replace the remaining source-regex guards with renders (AS-068, AS-069, AS-054, AS-015, AS-067 — major).**
For AS-068, render the planner and assert on the container's actual
`className`/computed overflow and on the row's min-height, instead of regexing
`stacked-planner.tsx` as a string. For AS-069, widen the scan to the whole
`components/calendar/` tree plus `page.tsx`, and add a render-level assertion
that no text node matching `/\d+\s*h\b/` or containing `%` appears in the
stacked layout. For AS-054, assert the checked-variant class on the `CheckIcon`
in `components/ui/command.tsx:165` (or snapshot its `className`) so deleting
`group-data-[checked=true]/command-item:opacity-100` fails. For AS-015, drive
the page with `searchParams` containing `view: "stacked"` for a one-person
selection and assert the rendered output is byte-identical to the same call
without it — behavioural, defeating the indirection bypass. For AS-067, move
the colour assertion up to `StackedPlanner` so an override injected at
`stacked-planner.tsx:177` is caught.

---

## Toolchain output

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

### `npx vitest run` (full suite)
```
 Test Files  292 failed | 585 passed | 2 skipped (879)
      Tests  310 failed | 4612 passed | 1682 skipped (6604)
   Duration  180.81s
```

Failure triage: of the 292 failing files, exactly **one** is calendar/planner
related — `tests/integration/calendar-blocks-crud.test.ts`, which fails with
`Error: Failed to create workspace: TypeError: fetch failed`, i.e. no reachable
Supabase instance in this environment, not a code defect. The remaining 291 are
pre-existing failures outside M7's scope (e.g.
`tests/unit/list-due-date-cell-optimistic.test.tsx`). They are not caused by
M7, but they do mean AS-074's "vitest green" gate cannot currently be met and
M8's F041 will be blocked until they are triaged.

### `npx vitest run` — M7 files only
```
 Test Files  8 passed (8)
      Tests  65 passed (65)
   Duration  1.83s
```
Files: `f031-page-layout-derivation`, `f032-stacked-shell`,
`f033-stacked-row-grid`, `f034-time-off-strip`, `f035-stacked-reorder`,
`f036-stacked-scroll-colour`, `f088-planner-header-lift`,
`planner-stacked-window`.

All M7 tests pass. That is precisely the problem: they also pass under every
mutation listed above.
