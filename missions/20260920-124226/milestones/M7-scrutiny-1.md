# M7 — The stacked layout — Scrutiny pass 1

**Verdict: REJECT.** 5 blockers, 10 majors. Toolchain is clean (lint 0, tsc 0, no
regression in the suite), but the milestone's test coverage does not defend its
assertions. The dominant failure mode is **source-text regex scanning of
`page.tsx`** — and `page.tsx`'s own comment block mentions `<PlannerHeader>`,
`resolvePlannerLayout`, `?view=` and `?people=`, so several guards are satisfied
by prose rather than by code. Verified directly: `indexOf("<PlannerHeader")`
resolves to the comment at line 25, not the render site.

Second dominant failure mode: **fixtures rigged so the expected outcome
coincides with the wrong implementation's outcome** (AS-063's ids ascend in the
same order the test expects).

Mutations below were executed against aliased copies of the components in a
scratchpad; "survived" means the full M7 suite stayed green.

## Assertion results

| ID | Result | Reason |
|---|---|---|
| AS-001 | FAIL (blocker) | Page→query wiring is a regex only. Dropping the 4th arg of `getCalendarBlocks` leaks every member's blocks; suite green. |
| AS-002 | FAIL (major) | 24-hour coverage untested. `HOURS` length 24 → 9 in `week-time-grid.tsx` survives. Named test is a duplicate layout check. |
| AS-014 | FAIL (major) | Test is tautological (`selfId` unread on that branch). Same-week and divergent-fallback cases uncovered. |
| AS-015 | FAIL (blocker) | Guard `/\bview\s*:\s*string/` misses `view?: string`. A working `?view=stacked` override ships green. |
| AS-018 | PASS | Real DOM assertion over 8 hour rows + 16 negative hours; both boundary mutations (8→7, 16→17) killed. |
| AS-019 | PASS | Five columns asserted present, days 6/7 absent; 4-column mutant killed. |
| AS-020 | FAIL (major) | Clip guard `<` → `<=` survives: a 07:00–08:00 or 16:00–17:00 block yields a zero-length segment and renders a `height: 0%` chip. No exact-boundary-touching case anywhere. |
| AS-021 | FAIL (major) | Deleting the weekday filter from `clipBlockToStackedWindow` leaves all f033 tests green (the render loop iterates `STACKED_DAYS` regardless). No Sunday case; absence checked only across columns 1–5. |
| AS-022 | FAIL (major) | The only clipping test uses 06:00–10:00, whose correct `top` is `0%` — so hardcoding chip `top` to 0 survives. End-edge clipping (e.g. 14:00–18:00 → top 75%, height 25%) is untested at render level. |
| AS-023 | FAIL (major) | `resolvePlannerLayout` itself is well covered; the *reachability* guard (F088 header lift) is a comment-gameable `indexOf`. |
| AS-024 | PASS (weak) | Mo has zero blocks and renders; but only his name text is asserted, not his row/grid. |
| AS-062 | PASS (weak) | Real render, real names; label→row association only pinned by document order. |
| AS-063 | FAIL (blocker) | Fixture ids ascend in expected order. `[...selectedUserIds].sort()` mutation survives. |
| AS-064 | FAIL (blocker) | `DndContext` is mocked to a pass-through; the handler is called directly. Replacing `SortableRow` with a plain `<div>` (no `useSortable`, no handle) survives. Draggability is unexercised. |
| AS-065 | FAIL (major) | Only `toContain("?people=")`. Deleting the `week` param preservation survives. No `parsePeopleParam` round-trip, so "survives a reload" is unproven. |
| AS-066 | FAIL (major) | Schema has no approval concept (see below). Wrong-member attribution mutation (always first member's PTO) survives; wrong-column mutation survives. |
| AS-067 | PASS (narrow) | Two same-person different-colour blocks defeat a per-person tint at the chip. Not defended at `StackedPlanner` level. |
| AS-068 | FAIL (major) | Two source regexes over raw file text; a comment satisfies them. Removing `min-h-[6rem]` (the "compressing" half) is entirely untested. |
| AS-069 | FAIL (major) | Assertion says "anywhere"; test scans two files' source text. No bare `hours`/`%` pattern. (In fact no violation exists today — but nothing prevents one.) |
| AS-059 | SPLIT: PASS (fallback) / FAIL (blocker, scoping) | Empty-selection→self is genuinely covered via `PeopleSwitcherUrlBound`. The `blockUserIds` scoping F031 claimed to fix is guarded by the same AS-001 regex and is undefended. **The M6 caveat is not closed.** |
| AS-011 | DEFERRED (not re-raised) | |
| AS-055 | DEFERRED (not re-raised) | |
| AS-056 | not re-reviewed this pass | |
| AS-054 | FAIL (major) | F089 did remove the duplicate tick — one `CheckIcon` per row, from `components/ui/command.tsx:165`. But visibility is asserted via the `data-checked` proxy. Deleting `group-data-[checked=true]:opacity-100` makes the tick invisible on every row with the suite green — reintroducing the exact F081 bug. |

## Contract-vs-schema conflict (needs an orchestrator decision)

AS-066 says "**Approved** time off". `supabase/migrations/20261114010000_time_off_entries.sql`
has no `status`, `state` or `approved_at` column, and `lib/queries/time-off.ts`
selects none. Every entry renders unconditionally; pending/rejected/cancelled are
indistinguishable. The assertion is currently unimplementable as written. The
contract is immutable, so this needs either a schema/status feature or a new
assertion recording the resolved semantics. Do not silently mark AS-066 passed.

## Notable unlocked behaviour

`stacked-planner.tsx` `handleDragEnd` silently no-ops when `workspaceSlug` or
`selfId` are missing. The page passes them today; nothing locks that in. A caller
regression yields a drag that appears to work and snaps back on re-render, with
no test failing. Silent-failure path — recommend an explicit guard or a test.

`page.tsx` derives the week from `getCurrentUserTimezone(supabase)` when `?week=`
is absent. Two members with identical rights opening the same URL across a
timezone boundary can land on different weeks — a plausible AS-014 breach that
nothing pins either way.

## Recommended follow-up features

**FU-A (blocker, AS-001 + AS-059 scoping).** Replace the `readFileSync` regex
guards in `f031-page-layout-derivation.test.tsx` with a real render of the RSC:
mock `getCalendarBlocks`, `getCurrentUser`, `getWorkspaceMembers` and
`getTimeOffEntries`, then `await CalendarPage({params, searchParams})` and assert
on the **fourth argument actually received by the `getCalendarBlocks` mock**. The
test must fail when that argument is dropped and must fail when it is widened to
all active member ids. Cover three cases: no query params (arg === `[selfId]`),
`?people=a,b` (arg === `[a,b]`), and `?people=` empty (arg === `[selfId]`). Delete
the vacuous negative guard matching `workspaceMembers.active.map`, which names a
symbol that does not exist.

**FU-B (blocker, AS-015).** Prove the `?view=` param is inert behaviourally, not
textually. Using the same RSC render harness as FU-A, render with
`?people=a,b&view=week-grid` and assert the stacked layout still renders, and
`?people=a&view=stacked` and assert the week grid still renders. Delete the two
source regexes; they miss `view?: string` (the repo's own optional-param style)
and any renaming to `?mode=`/`?layout=`.

**FU-C (blocker, AS-063).** Re-fixture the stacked-shell ordering test so the
`?people=` order disagrees with every natural sort of the ids and of the names.
Assert row order by the DOM node order of `[data-testid^="stacked-person-row-"]`,
not by `textContent.indexOf`. The test must fail when `selectedUserIds` is passed
through `[...ids].sort()`.

**FU-D (blocker, AS-064).** Stop mocking `DndContext`. Either drive a real
keyboard drag through dnd-kit's `KeyboardSensor` (focus the handle, Space,
ArrowDown, Space) and assert the resulting order, or at minimum assert the drag
handle element exists per row and carries the `useSortable` wiring
(`aria-roledescription`, `aria-describedby`, `role="button"`). The test must fail
when `SortableRow` is replaced with a plain `div`.

**FU-E (blocker, AS-023 reachability / F088).** Replace the
`indexOf("<PlannerHeader")` ordering guard with a render assertion: render the
page (or the header-plus-branch composition) in both layouts and assert the
people-switcher trigger is present in each. Verified: the current guard matches
the comment at `page.tsx:25`, so moving the header back inside the week-grid
branch keeps the suite green.

**FU-F (major, AS-066).** Render `StackedPlanner` — not `StackedPersonRow` in
isolation — with a populated `timeOffByUser` covering at least two members with
different entries on different weekdays. Assert each strip is inside its own
member's row and its entry lands in the correct day column. Must fail against
"always render the first member's entries" and against "render the entry in every
column". Separately, resolve the approved-vs-any-status question flagged above.

**FU-G (major, AS-065).** Assert the exact URL string produced by a reorder,
including preservation of `?week=`, and add a round-trip test feeding the
serialized param back through `parsePeopleParam` to prove the order survives a
reload. Add direct unit coverage of `serializePeopleParam`, including the `me`
shorthand.

**FU-H (major, AS-068).** Delete the two source-text regexes. Render
`StackedPlanner` with ~12 selected members, query the scroll container as a DOM
node and assert its overflow/max-height classes, and assert each row carries its
`min-h-[6rem]`. Must fail when `min-h` is removed (rows compress) and when the
overflow class is moved to a non-constrained element.

**FU-I (major, AS-069).** Widen the check to every component under
`components/calendar/**` and assert over **rendered `textContent`** of both the
week grid and the stacked layout, using bare patterns
(`/\bhours?\b|\bcapacity\b|\butili[sz]/i` plus a percentage-total check), with
clock axis labels excluded by an explicit allowlist rather than by omission.

**FU-J (major, AS-054).** Assert the check icon's className contains the
`group-data-[checked=true]…opacity-100` pair, or move the test to a CSS-evaluating
runner, so deleting either opacity rule in `components/ui/command.tsx:165` fails.
Also reconsider `aria-selected={isSelected}` in `people-switcher.tsx:226`: in cmdk
`aria-selected` is the keyboard-highlight state the primitive owns; selection
semantics belong on `aria-checked` with `role="option"`/`menuitemcheckbox`.

**FU-M (major, AS-020 / AS-021 / AS-022).** Harden
`tests/unit/f033-stacked-row-grid.test.tsx` with five render-level cases:
(1) 07:00–08:00 and 16:00–17:00 blocks produce no chip — kills the `<` → `<=`
clip-guard mutation; (2) an 04:00–06:00 block produces no chip, covering the
before-window path at render level; (3) a Sunday block, asserted via a global
`[data-testid^="stacked-block-"]` count of 0 rather than a columns-1–5 loop;
(4) a 14:00–18:00 block asserted at `top: 75%`, `height: 25%` — kills the
hardcoded-`top` mutation and is the only end-edge clipping coverage;
(5) a same-weekday-different-week block (e.g. `2026-09-21T09:00Z` against
`weekKey=2026-09-14`) produces no chip — the `sameDay` week-scoping guard at
`stacked-person-row.tsx:70-75` is currently entirely untested, and removing it
bleeds other weeks' blocks into the view.

**FU-K (major, AS-002).** Add an assertion that the week grid renders 24 hour
rows (hour labels `00:00` through `23:00`, or a row count). Must fail when
`HOURS` in `week-time-grid.tsx` is narrowed to the stacked window.

**FU-L (major, AS-014).** Cover the two real risks: (1) the same URL with an
all-invalid `?people=` value resolving to a different selection for different
callers, and (2) week resolution depending on per-user timezone when `?week=` is
absent. Decide and pin the intended behaviour for both.

## Toolchain output

### Typecheck — `npx tsc --noEmit`
Clean. No output, exit 0.

### Lint — `npx eslint .`
Clean. No output, exit 0.

### Tests — `npx vitest run` (full suite)
```
 Test Files  292 failed | 585 passed | 2 skipped (879)
      Tests  310 failed | 4604 passed | 1682 skipped (6596)
   Duration  191.16s
```
Baseline recorded in `M6-scrutiny-9.md`:
```
 Test Files  292 failed | 578 passed | 2 skipped (872)
      Tests  310 failed | 4570 passed | 1682 skipped (6562)
```
Failing counts are **identical** (292 files / 310 tests) before and after M7; the
7 new files and 34 new passing tests are all additive. M7 introduces no
regression. The 292 pre-existing failures are a separate, long-standing debt
(sample: `tests/unit/list-due-date-cell-optimistic.test.tsx:163`, an
`editTaskMock` `waitFor` timeout) and are explicitly not re-raised here.

### Tests — M7 files only
```
npx vitest run tests/unit/f031-page-layout-derivation.test.tsx \
  tests/unit/f032-stacked-shell.test.tsx tests/unit/f033-stacked-row-grid.test.tsx \
  tests/unit/f034-time-off-strip.test.tsx tests/unit/f035-stacked-reorder.test.tsx \
  tests/unit/f036-stacked-scroll-colour.test.tsx \
  tests/unit/f088-planner-header-lift.test.tsx \
  tests/unit/people-switcher-multiselect.test.tsx

 Test Files  8 passed (8)
      Tests  49 passed (49)
   Duration  1.85s
```
All green — which is precisely why the mutation results above matter.
