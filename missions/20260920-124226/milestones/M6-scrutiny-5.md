# M6 scrutiny — pass 5

_Milestone: M6 — The people switcher (F026–F030; follow-ups F067–F079)_
_Mission: 20260920-124226_  _Date: 2026-09-20_
_Verdict: **RED** — 1 assertion FAIL (blocker). Both gates now green._

Pass 4's two findings split. **The lint gate is genuinely fixed** (F078) — `npx eslint .
--max-warnings=0` exits 0. **F079 fixed the *structure* AS-011 was criticised for but not
the *hole*.** `weekHrefFor` is gone, `page.tsx` calls `buildPlannerNavHrefs` exactly once,
and a mutation *inside* the helper is now caught. But the single surviving call expression
in `page.tsx` is still guarded only by a token-presence regex, and the identical
user-visible defect — prev/next/today silently dropping `?people=` — still leaves the
suite 76/76 green. This is the fifth consecutive pass in which some form of this mutation
survives.

Every verdict below is a mutation executed on a clean tree and reverted with
`git checkout --`. `git status --porcelain components lib app` is empty at the end.
Mutations that failed to apply were re-crafted against the real source text and re-run
(AS-012, AS-051, AS-060 in this pass) — a no-op mutation is not evidence.

## Verdict table

| Assertion | Verdict | Severity | Reason |
|---|---|---|---|
| AS-011 | **FAIL** | blocker | The directed mutation now works: `peopleParam = undefined` inside `buildPlannerNavHrefs` (`lib/calendar/week-nav.ts`) fails 2 tests. `weekHrefFor` is confirmed gone from `page.tsx`, and `tests/unit/f079-calendar-page-single-call-site.test.ts` pins exactly one call site. **But the call site itself is still unobserved.** Changing `page.tsx:100` from `peopleParam,` to `peopleParam: undefined,` — prev, next *and* Today all lose `?people=` in the running app, precisely what AS-011 forbids — leaves **76/76 green**, `tsc` clean and `eslint` clean. The only thing standing between that defect and a green build is `f029-switcher-url-wiring.test.tsx:334`'s `/buildPlannerNavHrefs\(\{[\s\S]*?peopleParam[\s\S]*?\}\)/`, which matches `peopleParam: undefined` happily. No e2e spec covers it either: `grep -rn "people=" tests/e2e/` returns nothing. F079 reduced the hole from two call expressions to one; it did not close it. |
| AS-012 | PASS | — | Deleting the `if (weekParam) { params.set("week", weekParam); }` carry-forward in `PeopleSwitcherUrlBound` fails 1 test through the real rendered component. |
| AS-013 | PASS | major (carried) | The `vi.stubGlobal` recorder is live: an obfuscated `globalThis["session"+"Storage"].setItem(...)` inserted inside `toggleMember` fails 1 test. **Residual hole unchanged from pass 4:** the source scan is a hardcoded five-file allowlist, so `window.localStorage.setItem("planner:lastblock", …)` added to `components/calendar/add-block-popover.tsx` — a Planner component writing Planner view state — leaves 76/76 green (re-verified this pass). True today, fragile against the next calendar component added. |
| AS-051 | PASS | — | Hoisting `PeopleSwitcherUrlBound` out of the `flex items-center gap-1` nav cluster into the outer header row fails 1 test. (Pass 4's "add an attribute" variant was a no-op; the real structural hoist was applied here and does kill.) |
| AS-052 | PASS | — | Breaking the member row's `AvatarImage` element fails 7 tests across 2 files. Real `src` for an avatar-bearing member, derived initials for a null-avatar member. |
| AS-053 | PASS | — | `value={displayNameFor(member)}` → `value={member.userId}` fails 2 tests; narrowing and the no-match empty state both assert on rendered rows. |
| AS-054 | PASS | — | `onSelectionChange([...selectedUserIds, userId])` → `onSelectionChange([userId])` fails 2 tests in 2 files. |
| AS-055 | PASS | — | Count half: `maxVisibleAvatars = 3` → `= 99` fails 2 tests. Identity half: forcing every visible trigger avatar to render `selectedMembers[0]` fails 1 test. |
| AS-056 | PASS | — | `onSelectionChange([selfId])` → `onSelectionChange([members[0]!.userId])` fails 1 test. F073's fixture pins `selfId = "member-c"`, so self ≠ first-listed and the mutation is distinguishable. |
| AS-057 | PASS | — | `members.map(...)` → `members.slice(0,-1).map(...)` fails 2 tests (set equality plus self-first ordering). |
| AS-059 | PASS | major (carried) | Removing the `nextSelectedUserIds.length > 0 ? … : [selfId]` coercion fails 1 test. **Structural objection unchanged since pass 1:** `page.tsx:120` still passes `blockUserIds={workspaceMembers.active.map((m) => m.userId)}` to `getCalendarBlocks`. `selectedUserIds` paints the switcher only; it does not filter blocks. AS-059 is satisfied for the wrong reason until M7/F031 lands. |
| AS-060 | PASS | — | `tabIndex={-1}` on `PopoverTrigger` fails 2 tests. The flow is pointer-free (`user.tab()` → `{Enter}` → typed query → `{ArrowDown}{Enter}`) and asserts the additive `onSelectionChange`. |
| AS-061 | PASS | — | Re-verified end-to-end this pass. `npx playwright test tests/e2e/m6-people-switcher-mobile.spec.ts` → **1 passed (9.2s)** in real Chromium at 375×812. **Re-verified falsifiable:** adding `className="hidden md:flex"` to `PeopleSwitcherUrlBound` in `week-view.tsx` produces `expect(locator).toBeVisible() failed … 1 failed`. It asserts real visibility, opens the popover and asserts the search input. |

## Gate results

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** — exit 0, no output |
| `npx eslint . --max-warnings=0` | **PASS** — exit 0, no output. Pass 4's `fireEvent` warning is gone (F078). |
| M6 unit scope (6 files) | **PASS** — 76/76 |
| `tests/e2e/m6-people-switcher-mobile.spec.ts` | **PASS** — 1/1, real browser, real 375px viewport, verified falsifiable |
| `npx vitest run tests/unit` (whole tree) | 41 failed files / 133 failed tests — **all pre-existing and out of M6 scope**. Zero failing files match `calendar|people|planner|week|switcher`. Unchanged from pass 4. Dominant cause remains `useArchitectureActions must be used within an ArchitectureActionsProvider`. Not caused by M6, but the repo's unit tree is not green and deserves its own orchestrator ticket. |

## Source findings (production defects, still uncovered)

Carried from passes 1–4. F078/F079 touched one production file (`page.tsx`) and one test
file; none of these were addressed.

1. **Shortcuts vanish while filtering.** cmdk filters the `Shortcuts` group, so typing any member name removes both "Just me" and "Whole team".
2. **Other query params silently erased.** `PeopleSwitcherUrlBound` builds a fresh `URLSearchParams` with only `week`/`people` and never reads `useSearchParams()`.
3. **Invalid `?week=` propagates.** The switcher echoes the raw `weekParam` verbatim while prev/next normalize to the resolved `weekKey`.
4. **`aria-selected` is overloaded** — the component sets it for *checked*, cmdk sets it for *highlighted*.
5. **Duplicate cmdk `value`s** when two members both have null `name` and `email` (both render `value="Unknown member"`).
6. **`selfId ∉ members` renders an empty trigger.** "Just me" emits `[selfId]`, `selectedMembers` filters it out, and the closed trigger shows the `aria-label="Select people"` empty state despite a live selection.
7. **`currentWeekKey` is dead.** `buildPlannerNavHrefs` accepts `currentWeekKey` in its parameter type and never destructures or uses it. `page.tsx` dutifully computes and passes it. Harmless today, but it is an unused input on the one function this milestone extracted for testability, and `eslint` does not flag it because it is a destructured-object property that is simply never read.

## Recommended follow-up features

**FU-P (blocker) — Observe the rendered hrefs, and delete the regex that has now produced
three false greens.** AS-011 cannot be closed by any further refactor of `page.tsx`,
because the failure mode is not structural — it is that nothing in the suite ever looks at
a rendered `href`. F079 correctly collapsed the page to a single `buildPlannerNavHrefs`
call, and that is the right shape; the remaining work is observation. Add a test that
renders `WeekGridSection` (or `WeekView` directly, whichever the seam allows without a
database) with `prevHref`, `nextHref` and `todayHref` derived from a `peopleParam` of
`"alice,bob"`, then queries the three real anchors — `aria-label="Previous week"`,
`aria-label="Next week"`, and the Today control — and asserts each one's `href` attribute
contains `people=alice%2Cbob`. Separately, cover the page's own derivation by extracting
nothing further but instead testing the page's props assembly: either export a small pure
`plannerNavProps({ workspaceSlug, weekKey, peopleParam })` that `page.tsx` spreads
directly into `<WeekGridSection {...} />`, and test *that*, or add a Playwright case that
loads `/w/<slug>/calendar?people=<two-ids>` and clicks Next, asserting `page.url()` still
carries `people=`. The acceptance bar is mechanical and must be demonstrated in the
handoff: changing `peopleParam,` to `peopleParam: undefined,` at the single `page.tsx`
call site must turn at least one test red. While doing this, **delete**
`tests/unit/f029-switcher-url-wiring.test.tsx:334`'s
`/buildPlannerNavHrefs\(\{[\s\S]*?peopleParam[\s\S]*?\}\)/` assertion — it matches the
defect it claims to forbid, it has now signed off on this bug in passes 3, 4 and 5, and it
is worse than no guard because it reads as coverage. Also drop the unused `currentWeekKey`
parameter from `buildPlannerNavHrefs` and its call site, or use it for `todayHref`.

**FU-Q (major) — Replace AS-013's five-file allowlist with a tree-wide scan.** The current
source scan enumerates five Planner files by name, so a `localStorage.setItem` added to any
*other* Planner component satisfies AS-013's letter while violating it in fact — verified
again this pass by planting a `window.localStorage.setItem("planner:lastblock", …)` in
`components/calendar/add-block-popover.tsx` and watching 76/76 stay green. Change the scan
to glob the whole Planner surface (`components/calendar/**`, `app/(workspace)/w/[workspaceSlug]/calendar/**`,
`lib/calendar/**`) and fail on any `localStorage`/`sessionStorage` identifier, with an
explicit, commented, empty-by-default exception list. Keep the `vi.stubGlobal` runtime
recorder as-is — it is the part that genuinely works.

**FU-R (minor, orchestrator ticket) — The repo's unit tree is not green.** 41 files / 133
tests fail outside M6, dominated by 16 instances of `useArchitectureActions must be used
within an ArchitectureActionsProvider` in the sitemap-builder suites. None are M6's doing,
but a milestone gate that has to be scoped to six named files to be meaningful is a weak
gate.

---

## Appendix — full gate output

### `npx tsc --noEmit`
```
(no output)
exit=0
```

### `npx eslint . --max-warnings=0`
```
(no output)
exit=0
```

### M6 unit scope — baseline
```
 Test Files  6 passed (6)
      Tests  76 passed (76)
   Duration  1.87s
```
Files: `tests/unit/f029-switcher-url-wiring.test.tsx`, `tests/unit/f079-calendar-page-single-call-site.test.ts`,
`tests/unit/people-switcher-multiselect.test.tsx`, `tests/unit/people-switcher-placement-a11y.test.tsx`,
`tests/unit/people-switcher.test.tsx`, `tests/unit/planner-people-selection.test.ts`.

### Mutation log (M6 unit scope, 76 baseline)
```
AS-011  week-nav.ts  peopleParam = undefined         -> 2 failed | 74 passed   KILLED
AS-011  page.tsx     peopleParam: undefined          -> 0 failed | 76 passed   SURVIVED  <-- blocker
AS-012  drop `if (weekParam) params.set("week", …)`  -> 1 failed | 75 passed   KILLED
AS-013  sessionStorage write inside toggleMember     -> 1 failed | 75 passed   KILLED
AS-013  localStorage in add-block-popover.tsx        -> 0 failed | 76 passed   SURVIVED  (residual, major)
AS-051  hoist switcher out of nav cluster            -> 1 failed | 75 passed   KILLED
AS-052  break AvatarImage in member rows             -> 7 failed | 69 passed   KILLED
AS-053  value={displayNameFor} -> {member.userId}    -> 2 failed | 74 passed   KILLED
AS-054  additive -> replace selection                -> 2 failed | 74 passed   KILLED
AS-055  maxVisibleAvatars 3 -> 99                    -> 2 failed | 74 passed   KILLED
AS-055  all visible avatars = selectedMembers[0]     -> 1 failed | 75 passed   KILLED
AS-056  "Just me" -> members[0].userId               -> 1 failed | 75 passed   KILLED
AS-057  whole team -> members.slice(0,-1)            -> 2 failed | 74 passed   KILLED
AS-059  drop [selfId] empty-selection coercion       -> 1 failed | 75 passed   KILLED
AS-060  tabIndex={-1} on PopoverTrigger              -> 2 failed | 74 passed   KILLED
```

### `npx playwright test tests/e2e/m6-people-switcher-mobile.spec.ts`
```
  ✓  1 [chromium] › m6-people-switcher-mobile.spec.ts:122:7 › people switcher reachable
     at mobile viewport width (F076: AS-061) › AS-061: people switcher trigger is visible
     and operable at 375px mobile width (4.2s)

  1 passed (9.2s)
```
Falsifiability check (`className="hidden md:flex"` on `PeopleSwitcherUrlBound`):
```
    Error: expect(locator).toBeVisible() failed
      - Expect "toBeVisible" with timeout 5000ms
    > 186 |     await expect(trigger).toBeVisible();
  1 failed
exit=1
```

### `npx vitest run tests/unit` (whole tree, context only)
```
 Test Files  41 failed | 468 passed | 1 skipped (510)
      Tests  133 failed | 3272 passed | 3 skipped (3408)
   Duration  86.19s
exit=1
```
Failing files matching `calendar|people|planner|week|switcher`: **0**.

### Tree state at end of review
```
$ git status --porcelain components lib app
(empty)
```
