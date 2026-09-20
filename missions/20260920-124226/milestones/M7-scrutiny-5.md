# M7 — Scrutiny pass 5

_Mission 20260920-124226 · 2026-09-20 · adversarial, read-only_

**Verdict: FAIL.** 3 blockers, 6 majors, 2 minors.

Pass 4's four blockers were addressed by F102 and F103. F103 is a genuine fix:
the drag test really does drive an unmocked `DndContext` through the keyboard
sensor. **F102 is not.** It is a *replay*, not a composition test — it imports
the four helpers and calls them itself with hand-written inputs. Its own file
header claims "every assertion here fails if the underlying behaviour
regresses, regardless of how the page happens to be wired"; the exact opposite
is true. No test in the repository imports or invokes `CalendarPage`:

```
$ grep -rn "CalendarPage\|calendar/page" tests/ | grep -v readFileSync
tests/unit/f102-calendar-page-composition.test.tsx:3:  // ... (a comment)
```

Every other reference is `readFileSync` source-text regex. The page↔component
boundary — which props `page.tsx` actually hands to `WeekView` and
`StackedPlanner`, and which `userIds` it actually hands to `getCalendarBlocks`
— is unguarded. Four of the nine failures below are mutations in that one
boundary, each verified green against the full calendar test subset.

## Assertion table

| ID | Verdict | Severity | Reason |
|---|---|---|---|
| AS-001 | FAIL | blocker | Only source-regex + isolated-helper coverage. `parsePeopleParam(peopleParam ?? "all", …)` in page.tsx:126 fetches every member's blocks on a param-less URL — verified green. |
| AS-002 | FAIL | major | The 24-hour axis is really tested (f098 counts 24 labels); the 7-day half is not. `days={week.days.slice(0, 5)}` in week-view.tsx:89 ships a 5-day grid — verified green. |
| AS-014 | FAIL | major | Covered only by calling `parsePeopleParam` twice with different `selfId`s — that tests helper purity, not the page. Caller-dependent self-injection after page.tsx:126 escapes. Separately: with no `?week=`, the week derives from each caller's own profile timezone, so "the same week" can genuinely differ per viewer. Untested either way. |
| AS-018 | PASS | minor | `HOURS = 8..15` pinned by constants test + present/absent `data-hour` assertions. Gap: no hour-row geometry is asserted and no `08:00` label text exists anywhere, so compressing the 8 gridlines into two-thirds of the column height escapes. |
| AS-019 | PASS | — | Mon–Fri pinned by constant test plus present/absent column assertions; the off-by-one `dateForIsoWeekday` probe fails 4 tests. Column-to-date mapping genuinely covered. |
| AS-020 | FAIL | major | Interior cases covered, touching boundaries not. `stacked-window.ts` `if (segStart.getTime() < segEnd.getTime())` → `<=` passes all 53 stacked tests, yet a 07:00–08:00 and a 16:00–17:00 block each emit a degenerate segment and render a real chip element. Confirmed by DOM probe: `stacked-block-*-1` present under the mutant, absent on HEAD. |
| AS-021 | PASS | — | Double-guarded (clipper skips non-Mon–Fri UTC days; row re-filters by `isoWeekday`), with Sat, Sun, and both spanning cases tested. No mutation survived both layers. |
| AS-022 | PASS | — | Both clip directions, both-ends, multi-day segmentation, and full-window covered. Crucially the *component* is proven to call the clipper: the 06:00–10:00 → `top: 0%` / `height: 25%` assertion goes negative if `clipBlockToStackedWindow` is dropped from `buildSegments`. `toUtcMs` exercised across Z/±HH:MM/lowercase/microsecond/offsetless forms and re-run under `TZ=America/Los_Angeles`. |
| AS-023 | FAIL | blocker | Both "AS-023" tests are worthless. One is `expect(resolvePlannerLayout(1)).toBe("week-grid")` — byte-identical to the AS-001 test above it. The other is a source-*position* regex (`<PlannerHeader` index < `layout === "stacked"` index). Neither exercises narrowing. `if (layout === "stacked" \|\| selectedUserIds.length === 1)` in `WeekGridSection` leaves the planner stacked forever — the precise regression AS-023 exists to prevent — verified green. |
| AS-024 | FAIL | major | Component-level coverage is real (a filter inside `stacked-planner.tsx` fails 2 tests, and the negative-control test at line 120 is not a mirror). But moving the filter up to page.tsx:272 — `selectedUserIds={selectedUserIds.filter((id) => blocksByUser.has(id))}` — makes the empty person vanish with all 7 calendar test files green. |
| AS-059 | PASS | minor | Genuinely double-covered: server-side fallback to `[selfId]` for `undefined`/`""`/all-invalid, plus a real render test that deselects the last member and asserts the pushed URL carries `people=me` (`not.toBe("")`). Caveat: the page-level `selfId: user.id` binding is untested, so the AS-001 mutation silently breaks this leg too. |
| AS-062 | FAIL | major | `member?.name ?? member?.email ?? userId` is a silent-degradation chain. `members={[]}` at page.tsx:276 labels every row with a raw UUID and 9 calendar files / 62 tests stay green. The two f102 tests tagged AS-062 actually test pending-member exclusion (AS-052 territory) and contribute nothing. |
| AS-063 | PASS | minor | Non-vacuous fixture — `carol/alice/bob` ids and names both sort differently from render order; name-sort, reverse, and id-sort mutations all fail. Caveat: assertion uses `textContent.indexOf` on the container rather than element order. |
| AS-064 | PASS | minor | F103 is sound. `@dnd-kit` is genuinely unmocked (only `next/navigation` is), the real `KeyboardSensor` is driven focus→Space→ArrowDown→Space, and the handle is a real `<button aria-label="Drag to reorder">`. Deleting `{...listeners}` fails 3 tests; dropping `sensors={sensors}` fails 2. Gap: only the *relative* order of two ids is asserted, so `[...selectedUserIds].reverse()` at stacked-planner.tsx:141 — ignoring the drop target entirely — passes all 6 tests. |
| AS-065 | PASS | major | Persistence is genuinely reload-safe: `router.replace` writes the address bar and page.tsx:68,126 reads `people` back out of `searchParams`; there is **no** local `useState` order shadowing the URL. Tests parse the resulting `people` param rather than just asserting `replace` was called, and a no-drag render asserts `replace` was *not* called. Gap: `?week=` preservation is fixture-pinned — hardcoding `params.set("week", "2026-W39")` at stacked-planner.tsx:147 passes all 6 tests. |
| AS-066 | DEFERRED | — | No status column in `time_off_entries`; carried forward from pass 4. |
| AS-067 | PASS | minor | Non-vacuous: two blocks with different colours in one row, distinct `borderColor` asserted. A per-person palette hashed off `userId` fails both tests. Caveat: both fixtures use `projectId: null`, but colour is a per-block column so a project-level substitution would still collapse the two chips. |
| AS-068 | FAIL | major | Both tests are regex over `plannerSource` (`/overflow-y-auto/`, `/max-h-\[\|maxHeight/`). They render nothing and never test "many members". The only thing actually preventing compression — `min-h-[6rem]` at stacked-person-row.tsx:137 — lives in a file these tests never read. Changing it to `min-h-0 shrink` keeps 5/5 green while rows compress to nothing. |
| AS-069 | FAIL | blocker | Fails on both axes. **File coverage:** the sweep reads two files against an assertion scoped to "the Planner … anywhere"; `planner-header.tsx`, `week-view.tsx`, `week-time-grid.tsx`, `week-agenda.tsx`, `calendar-block-chip.tsx`, `people-switcher.tsx`, `time-off-day-strip.tsx` and the page are unscanned. **Term coverage:** the forbidden list is five narrow phrases, so even inside a scanned file `<div>32h / 40h (80%)</div>` matches nothing. Both mutations verified green together. |

## Recommended follow-up features

**F104 — Render the real `CalendarPage` (blocker; AS-001, AS-002, AS-014, AS-023).**
Add one React Server Component test that imports the default export from
`app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` and awaits it with real
`params`/`searchParams`, mocking only the I/O boundary: `getCurrentUser`,
`getWorkspaceMembers`, `getCalendarBlocks`, and the profile/timezone lookup.
Assert four things about the returned tree and the mock call log: (a) with no
query params, the `userIds` argument actually passed to `getCalendarBlocks`
deep-equals `[selfId]` and nothing wider; (b) that tree contains `WeekView`
and not `StackedPlanner`, with seven day columns counted in the rendered DOM;
(c) rendering the same `searchParams` under two different `getCurrentUser`
identities with equal access produces the identical people selection *and*
the identical week key; (d) rendering `?people=a,b` then `?people=a` returns
stacked and then week-grid respectively. Delete or rewrite the three
duplicate `resolvePlannerLayout(1)` tests and correct the false header
comment in `f102-calendar-page-composition.test.tsx`. This single feature
kills every mutation listed under AS-001, AS-002, AS-014 and AS-023.

**F105 — Assert the page→StackedPlanner prop wiring (major; AS-024, AS-062).**
Building on F104's harness, render the page with a selection of three
members where the middle one has zero blocks in the visible week, and assert
that three labelled rows appear, in `?people=` order, each carrying the
member's *name*. Additionally assert that the `members` prop handed to
`StackedPlanner` is non-empty, and add a negative control that a row label is
never a bare UUID — the `member?.name ?? member?.email ?? userId` chain must
not be allowed to degrade silently. Consider making that fallback throw or
log in development rather than silently rendering an id.

**F106 — Close the stacked-window boundary hole (major; AS-020, AS-018).**
Add boundary cases to `tests/unit/planner-stacked-window.test.ts`: a block
ending exactly at 08:00 and a block starting exactly at 16:00 must each yield
zero segments, and a companion component test must assert no
`stacked-block-*` element appears in the DOM for either. That kills the
`<` → `<=` mutant. In the same feature, assert one hour row's geometry (the
12:00 row resolving to `top: 50%`) so the gridline scale cannot drift from
the block-positioning scale, and consider rendering visible `08:00`…`16:00`
label text, which today exists nowhere in the stacked layout.

**F107 — Replace the AS-068 and AS-069 regex checks with behaviour (blocker; AS-068, AS-069).**
For AS-068, render `StackedPlanner` with roughly twelve members in jsdom and
assert each `stacked-person-row-*` resolves a real minimum height and that
the scroll container has a bounded height — not that a class string appears
in a file. For AS-069, glob every file under `components/calendar/` plus the
calendar page and match a numeric-unit pattern such as
`/\b\d+(\.\d+)?\s*(h|hrs|hours)\b/i` and `/\b\d+\s*%/` alongside the existing
keyword list, and pair it with a rendered-DOM sweep of the full planner at
both layouts asserting no such text node exists. The current check would not
notice `32h total · 80% utilisation · capacity 40h` added to the header.

**F108 — Tighten the drag assertions (minor; AS-064, AS-065).**
Two one-line changes to `tests/unit/f035-stacked-reorder.test.tsx`: assert
the full resulting id array deep-equals `[PERSON_A, SELF_ID, PERSON_B]`
rather than the relative position of two ids, which kills the
`.reverse()`-ignores-the-drop-target mutant; and assert `week=2026-W38` in
the AS-064 test as well as `2026-W39` in the other, so a hardcoded week
literal cannot pass.

## Environmental note (not an M7 defect)

The full suite is red for an environmental reason, not a code reason:
**local Supabase is not running.** The failure histogram is dominated by
connection errors to the Postgres/API port:

```
 138  Failed to create test workspace: TypeError: fetch failed
  57  Failed to create workspace: TypeError: fetch failed
  51  owner: fetch failed
  36  Failed to create test user: fetch failed
  25  connect ECONNREFUSED 127.0.0.1:54321
  24  connect ECONNREFUSED 127.0.0.1:54321 (ECONNREFUSED)
  24  Failed to seed workspace: TypeError: fetch failed
  15  Failed to create workspace A: TypeError: fetch failed
```

That is **292 test files failing, 310 tests** out of 881 files / 6617 tests,
and essentially all of it is integration suites that cannot reach
`127.0.0.1:54321`. Only two residues are genuine code failures worth a
follow-up glance, and neither belongs to M7:
`useArchitectureActions must be used within an ArchitectureActionsProvider`
(16 occurrences) and `expected { …(4) } to be null` (24 occurrences).

No failure is in an M7-owned file. The only calendar-adjacent entries are
`tests/integration/calendar-blocks-crud.test.ts` (one of the ECONNREFUSED
casualties) and a set of `f032`-`f036` files belonging to the
*Figma->Webflow* mission, whose feature numbering collides with this
mission's. The seven M7 files pass cleanly in isolation (48/48).

**Action for the orchestrator:** start local Supabase and re-run before
treating any red as signal. Until then the mission has no usable green
baseline, and in particular the RLS and visibility assertions in M2/M3
are currently unverified rather than passing.

---

# Appended tool output

## `npx tsc --noEmit`

```
(no output — clean, exit 0)
```

## `npx eslint .`

```
(no output — clean, exit 0)
```

## `npx vitest run` — full suite

```
 Test Files  292 failed | 587 passed | 2 skipped (881)
      Tests  310 failed | 4625 passed | 1682 skipped (6617)
   Duration  296.81s (transform 29.65s, setup 193.01s, import 282.95s,
                      tests 402.19s, environment 178.44s)
```

Failure-cause histogram (`grep -oE "Error: .*" | sort | uniq -c | sort -rn`):

```
 138 Error: Failed to create test workspace: TypeError: fetch failed
  57 Error: Failed to create workspace: TypeError: fetch failed
  51 Error: owner: fetch failed
  36 Error: Failed to create test user: fetch failed
  25 Error: fetch failed
  25 Error: connect ECONNREFUSED 127.0.0.1:54321
  24 Error: fetch failed",
  24 Error: expected { …(4) } to be null
  24 Error: connect ECONNREFUSED 127.0.0.1:54321 (ECONNREFUSED)
  24 Error: Failed to seed workspace: TypeError: fetch failed
  16 Error: useArchitectureActions must be used within an ArchitectureActionsProvider
  15 Error: Failed to create workspace A: TypeError: fetch failed
   8 Error: F126 auth pool: failed to create pooled identity 0: fetch failed
   3 Error: Failed to create owner user: fetch failed
   3 Error: Failed to create member user: fetch failed
```

Local Supabase (`127.0.0.1:54321`) is down; the overwhelming majority of the
red is integration suites failing to seed. Representative non-database
failure (unrelated to M7 — Tasks list, optimistic due date):

```
 ❯ tests/unit/list-due-date-cell-optimistic.test.tsx:163:28
    161|
    162|     await waitFor(() =>
    163|       expect(editTaskMock).toHaveBeenCalledWith("task-1", { dueDate: n…
       |                            ^
    164|     );
 ❯ runWithExpensiveErrorDiagnosticsDisabled node_modules/@testing-library/dom/dist/config.js:47:12
 ❯ checkCallback node_modules/@testing-library/dom/dist/wait-for.js:124:77
 ❯ Timeout.checkRealTimersCallback node_modules/@testing-library/dom/dist/wait-for.js:118:16
```

Calendar-adjacent failing files (8 of 290; none are M7-owned):

```
tests/integration/calendar-blocks-crud.test.ts
tests/integration/f033-drop-node-meta-client-visible.test.ts
tests/unit/f032-visual-distinction.test.tsx
tests/unit/f033-hover-highlighting.test.tsx
tests/unit/f034-component-panel.test.tsx
tests/unit/f035-component-detail.test.tsx
tests/unit/f036-rename-delete-panel.test.tsx
tests/unit/f104-page-column-chain.test.tsx
```

## `npx vitest run` — M7 files in isolation

```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  7 passed (7)
      Tests  48 passed (48)
   Duration  4.85s (transform 1.93s, setup 4.03s, import 3.47s,
                    tests 1.34s, environment 4.78s)
```

Files: `f031-page-layout-derivation`, `f032-stacked-shell`,
`f033-stacked-row-grid`, `f034-time-off-strip`, `f035-stacked-reorder`,
`f036-stacked-scroll-colour`, `f102-calendar-page-composition`.

## Coverage probe — no test invokes `CalendarPage`

```
$ grep -rn "calendar/page\|CalendarPage" tests/
tests/unit/f080-calendar-nav-hrefs.test.tsx:100:    join(process.cwd(), "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx"),
tests/unit/f088-planner-header-lift.test.tsx:39:  "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx",
tests/unit/f102-calendar-page-composition.test.tsx:3:// calendar page (app/(workspace)/w/[workspaceSlug]/calendar/page.tsx) calls
tests/unit/f102-calendar-page-composition.test.tsx:14:describe("F102: CalendarPage composition (page.tsx data-flow, replayed)", () => {
tests/unit/f029-switcher-url-wiring.test.tsx:222:      "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx",
tests/unit/f029-switcher-url-wiring.test.tsx:326:        "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx",
tests/unit/f016-calendar-page-no-task-query.test.ts:18:  "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx",
tests/unit/f031-page-layout-derivation.test.tsx:19:  "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx",
```

Every hit is either a `readFileSync` path constant or a comment. The page
component itself is never imported, never rendered, never called.
