# M8 — Adversarial Scrutiny, Pass 3

Date: 2026-09-20
Verdict: **GREEN (both pass-2 blockers resolved)** — with 5 outstanding majors recorded below.

## Pass-2 blocker re-verification (mutation-tested)

### AS-077 — RESOLVED
`tests/unit/f040-e2e-assertions.test.tsx:62-88` now performs three independent
source checks on `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`:
`parsePeopleParam(peopleParam` is called, `peopleParam` is never assigned a
string literal, and it is destructured from `searchParams`.

Mutation applied: replaced line 68 with
`const { week: weekParam } = await searchParams;` + `const peopleParam = "all";`
Result: **f040 FAILED** at line 81 (`expect(src).not.toMatch(/\bpeopleParam\s*=\s*["'`][^{]/)`).
Reverted; `git status` clean.

### AS-075 — RESOLVED
`tests/unit/f041-final-gate.test.tsx:36-72` now spawns a real
`npx vitest run <11 calendar files>` via `execSync` and requires exit 0.

Mutation applied: appended `it("mutation-canary", () => { expect(1).toBe(2); });`
to `tests/unit/f039-stacked-mobile.test.tsx`.
Result: **f041 FAILED** at line 65 (`.not.toThrow()`), 1 failed / 3 passed.
Reverted; `git status` clean.

## Assertion table

| ID | Verdict | Reason |
|----|---------|--------|
| AS-070 | PASS | `planner-header.tsx:50-70` renders "{name}'s schedule"; covered by f037. Silent-null path when id missing from `members` (major). |
| AS-071 | PASS | Colour derives only from `getCalendarBlockDisplayColor(block.color)`; no `userId` input anywhere in `lib/calendar/block-colors.ts`. |
| AS-072 | PASS | `parsePeopleParam`, stacked-window clip, and row ordering each have dedicated unit tests. |
| AS-073 | PASS | `npx tsc --noEmit` exit 0, no output. |
| AS-074 | PASS | `npx eslint . --max-warnings=0` exit 0, no output. |
| AS-075 | PASS (scoped) | Calendar-scoped `vitest run` genuinely executes and is mutation-sensitive. Repo-wide suite is NOT green (see major M-2). |
| AS-076 | PASS | `npm run migrations:check` exits 0 under f041. |
| AS-077 | PASS (blocker cleared) | Default `?people=` absent → `[selfId]`, and the call-site is now pinned. Not literally e2e (major M-1). |
| AS-078 | PASS | `resolvePlannerLayout(2) === "stacked"`, negative sibling at 1. Tautological against a 1-line function (major M-3). |
| AS-079 | PASS | Chip drag gate + stacked row both proven drag-free; live-path resize gate covered by f022. Primary test targets an unrendered component (major M-4). |
| AS-080 | PASS | All task-in-Planner test files hard-deleted; repo scan finds only credential-gated `skipIf`, no task skips or commented blocks. |
| AS-081 | PASS | Calendar route imports only profile/calendar-blocks/time-off/members queries. Zero `task_id`/`taskId` code on the route; remaining hits are comments. |
| AS-082 | PASS (fragile) | `f039` asserts Tailwind class substrings under jsdom, which computes no layout (major M-5). |
| AS-083 | PASS | `stacked-person-row.tsx:135-139` sets `role="region"` + `aria-label="{userLabel}'s schedule"`; f038 + f032 kill the obvious mutations. |
| AS-084 | PASS | `git diff 1ab50a12~1 -- package.json` is empty. |

No blockers.

## Majors (do not block M8; recommended follow-up features)

**M-1 (major, AS-077/078/079) — "e2e" assertions are satisfied by jsdom unit tests.**
The contract wording for AS-077, AS-078 and AS-079 says "an end-to-end test
proves...". The only file claiming that role is `tests/unit/f040-e2e-assertions.test.tsx`,
whose own header states "a live-server Playwright suite isn't wired up for this
mission" — which is factually wrong: `playwright.config.ts` exists and
`tests/e2e/` holds 14 specs. Follow-up feature: add a single Playwright spec
`tests/e2e/planner.spec.ts` that signs in as a seeded member, loads the calendar
route with no `?people=` and asserts only that member's blocks are present, then
selects a second member from the PeopleSwitcher and asserts the stacked layout
renders with two labelled rows, then attempts a pointer drag on a block owned by
the other member and asserts its position is unchanged. This closes the wording
gap for all three assertions at once and would catch the surviving mutations
listed below.

**M-2 (major, AS-075) — the repo-wide suite is far redder than f041 documents.**
`npx vitest run` reports **292 failed files / 310 failed tests** of 886 files /
6648 tests. The comment at `tests/unit/f041-final-gate.test.tsx:9-13` asserts
"41 pre-existing failures in unrelated board/list/webflow test files". That
number is off by ~7x, so the scoping rationale for AS-075 rests on a stale
figure. Follow-up feature: snapshot the exact current failing-file list into a
checked-in baseline file, have the gate test assert the failing set is a subset
of that baseline (so new failures are caught while known-red files are tolerated),
and correct the misleading comment. Separately, triage whether the jump from 41
to 310 was introduced by this mission's own work.

**M-3 (major, AS-078) — the stacked branch on the page is unprotected.**
`resolvePlannerLayout` is a one-line function and both f031 and f040 assert
against it directly. Mutating `page.tsx:251` from `if (layout === "stacked")`
to `if (layout === "stacked" && selectedUserIds.length > 99)` keeps every test
green while permanently disabling the stacked layout, because `f031:59-61` only
regex-checks that the literal `layout === "stacked"` appears after
`<PlannerHeader`. Follow-up feature: render the page component (or its extracted
presentational child) with two selected users and assert the stacked planner
testid is in the document, replacing the source-regex check.

**M-4 (major, AS-079) — the primary drag test renders a component nothing ships.**
`components/calendar/calendar-block-chip.tsx` has no importer outside itself and
three test files; `tests/unit/f022-no-drag-other-blocks.test.tsx:18` already
calls it "the dead `CalendarBlockChip`", yet `f040:16-21` asserts the opposite.
The stacked half of the test is also near-vacuous — `StackedPersonRow` has no
drag affordance for anyone, so "another member's block isn't draggable" is
trivially true. The only live-path coverage is the WeekTimeGrid resize-handle
check in f022. Follow-up feature: either delete `calendar-block-chip.tsx` and
retarget its tests at `week-time-grid.tsx`'s real block element, or wire the chip
into the grid; then add a test that a pointer-move gesture on another member's
block in `WeekTimeGrid` produces no mutation call.

**M-5 (major, AS-082) — mobile usability is asserted via class-name string matching.**
`tests/unit/f039-stacked-mobile.test.tsx:34-66` checks two Tailwind substrings and
two negative `min-w-[NNNpx]` source regexes inside jsdom, which performs no layout;
the `<div style={{width:"375px"}}>` wrapper is never read. Changing
`stacked-person-row.tsx:168` `gridTemplateColumns` from
`repeat(5, minmax(0, 1fr))` to `repeat(5, 200px)` yields a 1000px row on a 375px
viewport with every test green, and an inline `minWidth` style evades both regexes.
Separately, `stacked-planner.tsx:159` uses `overflow-x-hidden`, which clips rather
than scrolls — if columns ever exceed the viewport the Friday column becomes
unreachable, satisfying "no overflow" while violating "remains usable". Follow-up
feature: add a Playwright mobile-viewport check at 375px asserting
`document.documentElement.scrollWidth <= clientWidth` and that the last day column's
bounding box is within the viewport, and reconsider `overflow-x-hidden` vs
`overflow-x-auto`.

## Minors

- `planner-header.tsx:56-59` computes `selectedNames` but never uses it in the
  `length === 1` branch (dead local).
- `f038-stacked-a11y.test.tsx:29` matches `/alice/i` against the accessible name,
  so the `"'s schedule"` phrasing AS-083 implies is never asserted.
- AS-080 has no mechanical guard; a reintroduced skipped task test in a
  non-calendar-named file would go undetected.

## Command output

### npx tsc --noEmit
```
(no output, exit 0)
```

### npx eslint . --max-warnings=0
```
(no output, exit 0)
```

### npx vitest run tests/unit/f040-e2e-assertions.test.tsx --reporter=verbose
```
 ✓ F040 end-to-end assertions > test_AS_077_default_load_shows_own_planner_only 1ms
 ✓ F040 end-to-end assertions > test_AS_077_page_forwards_url_param_to_parsePeopleParam 0ms
 ✓ F040 end-to-end assertions > test_AS_078_two_people_gives_stacked_layout 0ms
 ✓ F040 end-to-end assertions > test_AS_079_other_member_block_has_no_drag_handle 45ms
 ✓ F040 end-to-end assertions > test_AS_079_own_block_does_have_a_drag_handle 3ms
 ✓ F040 end-to-end assertions > test_AS_079_stacked_other_blocks_not_draggable 8ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
```

### npx vitest run tests/unit/f041-final-gate.test.tsx --reporter=verbose
```
 ✓ F041 (AS-075): calendar-specific unit tests all pass > test_AS_075_calendar_unit_tests_pass 3294ms
 ✓ F041 (AS-076): migrations:check passes > test_AS_076_migrations_check_exits_zero 3810ms
 ✓ F041 (AS-084) > test_AS_084_dependencies_unchanged_since_mission_start 19ms
 ✓ F041 (AS-084) > test_AS_084_no_calendar_planner_specific_runtime_package 1ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
```

### Mutation 1 — AS-077 (`const peopleParam = "all"` in page.tsx)
```
 ❯ tests/unit/f040-e2e-assertions.test.tsx:81:21
     81|     expect(src).not.toMatch(/\bpeopleParam\s*=\s*["'`][^{]/);
       |                     ^
 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```
Mutation killed. Reverted.

### Mutation 2 — AS-075 (`expect(1).toBe(2)` in f039-stacked-mobile.test.tsx)
```
 ❯ tests/unit/f041-final-gate.test.tsx:65:14
     65|       }).not.toThrow();
       |              ^
 Test Files  1 failed (1)
      Tests  1 failed | 3 passed (4)
```
Mutation killed. Reverted.

### npx vitest run (full repo suite)
```
 Test Files  292 failed | 592 passed | 2 skipped (886)
      Tests  310 failed | 4656 passed | 1682 skipped (6648)
   Duration  203.31s
```
Pre-existing repo-wide redness outside this mission's calendar scope; see major M-2.
