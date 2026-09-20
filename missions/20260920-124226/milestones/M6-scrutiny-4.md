# M6 scrutiny — pass 4

_Milestone: M6 — The people switcher (F026–F030; follow-ups F067–F077)_
_Mission: 20260920-124226_  _Date: 2026-09-20_
_Verdict: **RED** — 1 assertion FAIL (blocker) + 1 gate FAIL (lint)_

Two of pass 3's three FAILs are genuinely fixed. **AS-061 is now real** (a Playwright
spec that runs in Chromium at 375px, verified falsifiable). **AS-013's runtime guard is
now live** (`vi.stubGlobal` records an obfuscated write inside `toggleMember`).
**AS-011 is not fixed** — F075 moved the logic, not the hole. The mutation that has
survived four consecutive passes still survives.

Lint is red for the first time in this milestone: F076 deleted the jsdom AS-061 cases
and left an unused `fireEvent` import behind.

Every verdict below is a mutation executed on a clean tree and reverted with
`git checkout --`. `git status --porcelain components lib app tests` is empty at the end.

## Verdict table

| Assertion | Verdict | Severity | Reason |
|---|---|---|---|
| AS-011 | **FAIL** | blocker | The directed mutation (`peopleParam = undefined` inside `buildPlannerNavHrefs`) now fails 2 tests — but **the production call site is still uncovered**. `page.tsx:93–100` keeps a local `weekHrefFor` closure that calls `buildPlannerNavHrefs` and `page.tsx:101–107` a second call for `todayHref`. Setting `peopleParam: undefined` in *either* call — prev/next/today silently drop `?people=` in the real app, the exact user-visible defect the assertion forbids — leaves **73/73 green**. F075's "source guard" (`f029-switcher-url-wiring.test.tsx:331`) is the same token-presence regex F071 already declared inadequate: `/buildPlannerNavHrefs\(\{[\s\S]*?peopleParam[\s\S]*?\}\)/` matches `peopleParam: undefined` happily. The extraction also left page.tsx *more* contorted, not less: `weekHrefFor` invokes a three-href builder with `prevWeekKey: key, nextWeekKey: key` and throws away two of the three results. |
| AS-012 | PASS | — | Deleting the `if (weekParam) params.set("week", weekParam)` carry-forward in `PeopleSwitcherUrlBound` fails 1 test through the real rendered component. |
| AS-013 | PASS | major | **Pass-3 FAIL fixed, with a residual hole.** The `vi.stubGlobal` recorders are now genuinely live: an obfuscated `globalThis["session"+"Storage"].setItem(...)` inserted *inside `toggleMember`* fails 1 test (it survived every prior pass). A plain `localStorage.setItem` in `people-switcher.tsx` fails the source scan. **Residual:** the scan is a hardcoded five-file allowlist, so `window.localStorage.setItem("planner:lastblock", …)` in `components/calendar/add-block-popover.tsx` — a Planner component, writing Planner view state — leaves 73/73 green. Likewise a non-exercised obfuscated write in an unreferenced helper. Real today; fragile against the next calendar component. |
| AS-051 | PASS | — | Hoisting `PeopleSwitcherUrlBound` out of the `flex items-center gap-1` nav div into the outer header row (still visually adjacent) fails 1 test. |
| AS-052 | PASS | — | Replacing the member row's `AvatarImage`/`AvatarFallback` body with a bare `<Avatar size="sm" />` fails 1 test. Real `src` for an avatar-bearing member, derived initials for a null-avatar member. |
| AS-053 | PASS | — | `value={displayNameFor(member)}` → `value={member.userId}` fails 2 tests; narrowing and the no-match empty state both assert on rendered rows. |
| AS-054 | PASS | — | `onSelectionChange([...selectedUserIds, userId])` → `onSelectionChange([userId])` fails 2 tests. |
| AS-055 | PASS | — | Count half: `maxVisibleAvatars = 3` → `= 99` fails 2 tests. Identity half: forcing every trigger avatar to render the same member fails 18 tests. |
| AS-056 | PASS | — | Directed mutation repeated: `onSelectionChange([selfId])` → `onSelectionChange([members[0]!.userId])` fails 1 test. F073's fixture pins `selfId = "member-c"`, so self ≠ first-listed. |
| AS-057 | PASS | — | `members.map(...)` → `members.slice(0,-1).map(...)` fails 2 tests (set equality plus self-first ordering). |
| AS-059 | PASS | major (carried) | Removing the `[selfId]` coercion fails 1 test. **Pass 1–3's structural objection is unchanged:** `page.tsx:120` still passes `blockUserIds={workspaceMembers.active.map((m) => m.userId)}` to `getCalendarBlocks`. `selectedUserIds` paints the switcher only; it does not filter blocks. AS-059 is true for the wrong reason until M7/F031. |
| AS-060 | PASS | — | `tabIndex={-1}` on the trigger fails 2 tests. The flow is genuinely pointer-free (`user.tab()` → `{Enter}` → typed query → `{ArrowDown}{Enter}`), asserting the additive `onSelectionChange`. |
| AS-061 | PASS | — | **Pass-3 blocker genuinely fixed.** The jsdom cases are deleted; `tests/e2e/m6-people-switcher-mobile.spec.ts` seeds a workspace, injects a real session cookie, sets a 375×812 viewport and drives Chromium. **Verified it actually runs, not skips: `1 passed (7.5s)`.** **Verified falsifiable:** adding `className="hidden md:flex"` to `PeopleSwitcherUrlBound` in `week-view.tsx` — the parent-wrapper mutation that survived passes 1–3 — produces `expect(locator).toBeVisible() failed … 1 failed`. It asserts real visibility, opens the popover, and asserts the search input. |

## Gate results

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** — exit 0, no output |
| `npx eslint . --max-warnings=0` | **FAIL** — exit 1. `tests/unit/people-switcher-placement-a11y.test.tsx:15:19 'fireEvent' is defined but never used`. Introduced by F076's deletion of the jsdom AS-061 cases. Severity **minor** as a defect, but it is a hard gate and the milestone cannot be GREEN with it red. |
| M6 unit scope (5 files) | **PASS** — 73/73 |
| `tests/e2e/m6-people-switcher-mobile.spec.ts` | **PASS** — 1/1 in Chromium, real browser, real 375px viewport |
| `npx vitest run tests/unit` (whole unit tree) | 41 failed files / 133 failed tests — **all pre-existing and out of M6 scope**: sitemap-builder (`f003`–`f048`, `f081`–`f104`), list-view due-date cells, `f250`. Zero failing files match `calendar|people|planner|week|switcher`. Dominant cause: `useArchitectureActions must be used within an ArchitectureActionsProvider` (16×). Not caused by M6, but worth an orchestrator ticket — the repo's unit tree is not green. |

## Source findings (production defects, still uncovered)

Carried from passes 1–3; F075–F077 changed one production file (`page.tsx`, to call the
new `lib/calendar/week-nav.ts`) and otherwise touched tests only.

1. **Shortcuts vanish while filtering.** cmdk filters the `Shortcuts` group, so typing any member name removes both "Just me" and "Whole team".
2. **Other query params silently erased.** `PeopleSwitcherUrlBound` builds a fresh `URLSearchParams` with only `week`/`people` and never reads `useSearchParams()`.
3. **Invalid `?week=` propagates.** The switcher echoes the raw `weekParam` verbatim while prev/next normalize to the resolved `weekKey`.
4. **`aria-selected` is overloaded** — the component sets it for *checked*, cmdk sets it for *highlighted*.
5. **Duplicate cmdk `value`s** when two members both have null `name` and `email` (both render `value="Unknown member"`).
6. **`selfId ∉ members` renders an empty trigger.** "Just me" emits `[selfId]`, `selectedMembers` filters it out, and the closed trigger shows the `aria-label="Select people"` empty state despite a live selection.
7. **`page.tsx`'s `weekHrefFor` is a misuse of its own helper** — it calls a three-href builder with `prevWeekKey: key, nextWeekKey: key` and discards two results, then calls it a second time for `todayHref`. Three `buildWeekNavHref` calls become six.

## Recommended follow-up features

**FU-N (blocker) — Make `page.tsx` hold no href logic at all, and observe it.** The current
shape leaves two untested `buildPlannerNavHrefs({ …, peopleParam })` call expressions in
`page.tsx`; mutating either to `peopleParam: undefined` breaks prev/next/today in
production with the suite green (verified this pass and passes 2 and 3). Fix the shape,
not the regex: have `page.tsx` call `buildPlannerNavHrefs` **exactly once** with the real
`weekKey`, `previousWeekKey(weekKey)` and `nextWeekKey(weekKey)`, destructure
`{ prevHref, nextHref, todayHref }`, and pass those three strings down to
`WeekGridSection` — deleting the `weekHrefFor` closure and the `weekHrefFor: (key: string) => string`
prop from `WeekGridSection` entirely, so the page contains no derivation to get wrong.
Then cover the remaining wiring with an observation rather than a regex: a test that
renders `WeekGridSection`/`WeekView` with a known `peopleParam`-derived href set and
asserts the rendered `<a href>` of the prev, next and Today controls each carry
`people=`. The acceptance bar is mechanical: with the closure gone there must be no
expression in `page.tsx` matching `peopleParam\s*:` other than the single call, and
deleting `peopleParam` from that call must turn at least one test red. Drop the
token-presence source regex at `f029-switcher-url-wiring.test.tsx:331` — it has now
produced two false greens across two passes and is worse than no guard because it reads
as coverage.

**FU-O (blocker, trivial) — Clear the lint gate.** Remove the unused `fireEvent` import
left at `tests/unit/people-switcher-placement-a11y.test.tsx:15` when F076 deleted the
jsdom AS-061 cases (or use it). `npx eslint . --max-warnings=0` must exit 0.

**FU-P (major) — Widen AS-013's source scan from an allowlist to a glob.** The scan at
`f029-switcher-url-wiring.test.tsx:220` enumerates five files by hand. A plain
`window.localStorage.setItem("planner:lastblock", "1")` in
`components/calendar/add-block-popover.tsx` — a Planner component storing Planner view
state — passes 73/73 today. Replace the array with a recursive walk of
`components/calendar/**` and `app/(workspace)/w/[workspaceSlug]/calendar/**`, matching
`localStorage`, `sessionStorage`, `indexedDB` and `document.cookie`, so new Planner files
are covered the day they are added rather than the day someone remembers to extend a
list. Verify by injecting a storage write into a calendar file that is *not* in today's
five and confirming the suite turns red.

**FU-Q (carried, blocked on M7) — Re-validate AS-059 once `selectedUserIds` actually
filters blocks.** `page.tsx:120` still hands `getCalendarBlocks` every active member's id,
so "deselecting everyone leaves the Planner showing the signed-in member" holds only
because the switcher's own chrome coerces to `[selfId]`; the block query never varied with
selection. After F031 wires `selectedUserIds` into `blockUserIds`, re-run the AS-059
mutation against the rendered block set, not the emitted URL.

**FU-R (minor, out of milestone) — The unit tree is not green.** 41 unit files / 133
tests fail on a clean checkout, unrelated to M6 (sitemap builder + list view). This
milestone is being validated against a scoped 5-file run because the tree-wide run is
already red; that is a standing risk to every future milestone gate.

---

## Appendix — full gate output

### `npx tsc --noEmit`
```
(exit 0, no output)
```

### `npx eslint . --max-warnings=0`
```
/Users/sasajapranin/Desktop/pm-app/tests/unit/people-switcher-placement-a11y.test.tsx
  15:19  warning  'fireEvent' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

✖ 1 problem (0 errors, 1 warning)

ESLint found too many warnings (maximum: 0).
(exit 1)
```

### `npx vitest run` — M6 unit scope, clean tree
```
 Test Files  5 passed (5)
      Tests  73 passed (73)
   Duration  1.92s
```
Files: `tests/unit/f029-switcher-url-wiring.test.tsx`, `tests/unit/people-switcher.test.tsx`,
`tests/unit/people-switcher-multiselect.test.tsx`, `tests/unit/people-switcher-placement-a11y.test.tsx`,
`tests/unit/planner-people-selection.test.ts`

### `npx playwright test tests/e2e/m6-people-switcher-mobile.spec.ts`
```
  1 passed (7.5s)      (exit 0 — did NOT skip; admin creds present, Chromium launched, 375x812)
```

### `npx vitest run tests/unit` — whole unit tree (baseline, clean tree)
```
 Test Files  41 failed | 467 passed | 1 skipped (509)
      Tests  133 failed | 3269 passed | 3 skipped (3405)
```
Zero failing files match `calendar|people|planner|week|switcher`. Failing files are
sitemap-builder (`f003`–`f048`, `f081`–`f104`, `f250`) and list-view due-date cells.
Pre-existing; unrelated to M6.

### Mutation log (all restored; `git status --porcelain components lib app tests` empty)
```
BASELINE                                                  73 passed
AS-011a lib/calendar/week-nav.ts peopleParam=undefined     2 failed   <- caught (directed mutation)
AS-011b page.tsx weekHrefFor  peopleParam: undefined      73 passed   <- SURVIVES (FAIL, blocker)
AS-011c page.tsx todayHref    peopleParam: undefined      73 passed   <- SURVIVES (FAIL, blocker)
AS-012  drop week carry-forward                            1 failed
AS-013a plain localStorage.setItem in people-switcher      1 failed   <- caught (directed mutation)
AS-013d obfuscated sessionStorage write in toggleMember    1 failed   <- caught (runtime guard now live)
AS-013b same write in an unreferenced helper              73 passed   <- survives (major)
AS-013e localStorage write in add-block-popover.tsx       73 passed   <- survives (major, outside allowlist)
AS-013c document.cookie in week-view.tsx                  73 passed   <- survives (out of assertion text)
AS-051  hoist switcher out of nav div                      1 failed
AS-052  member-row avatar body gutted                      1 failed
AS-053  value={member.userId}                              2 failed
AS-054  onSelectionChange([userId])                        2 failed
AS-055a maxVisibleAvatars = 99                             2 failed
AS-055b all trigger avatars identical                     18 failed
AS-056  "Just me" -> members[0].userId                     1 failed
AS-057  whole team drops last member                       2 failed
AS-059  remove [selfId] coercion                           1 failed
AS-060  tabIndex={-1} on trigger                           2 failed
AS-061  className="hidden md:flex" on the switcher    Playwright 1 failed (toBeVisible)
```
