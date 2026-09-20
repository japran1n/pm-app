# M6 scrutiny — pass 3

_Milestone: M6 — The people switcher (F026–F030; follow-ups F067–F070, F071–F074)_
_Mission: 20260920-124226_  _Date: 2026-09-20_
_Verdict: **RED** — 3 FAILs (2 blocker, 1 major)_

Pass 2 reported 4 FAILs. **Two were genuinely fixed (AS-056, AS-055). Two were not
(AS-011, AS-061) — both are now failing for the third consecutive pass.** One new FAIL
surfaced under mutation that passes 1 and 2 both marked PASS (AS-013): its runtime
guard is dead and its source-regex guard covers one file out of the whole Planner.

Every verdict is backed by a mutation executed on a clean tree, the mutation's presence
confirmed by `grep` on the mutated file, and the file restored with `git checkout --`
immediately after. `git status --porcelain components lib app` is empty at the end.

## Verdict table

| Assertion | Verdict | Severity | Reason |
|---|---|---|---|
| AS-011 | **FAIL** | blocker | F071 deleted F067's source regex and replaced it with a test that **re-implements page.tsx's closure inside the test file** (`tests/unit/f029-switcher-url-wiring.test.tsx:218` — its own comment says "Mirrors page.tsx's `weekHrefFor` closure exactly"). No test imports, renders, or otherwise observes `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`. Repeated pass 2's mutation — `page.tsx:93,94` → `peopleParam: undefined`, so prev/next/today silently drop `?people=` in production — **71/71 tests pass**. Coverage is strictly *worse* than after F067: the regex at least caught deletion of the argument. The pure `buildWeekNavHref` is well covered (mutating it fails 6 tests); the **call sites are covered by nothing**. |
| AS-012 | PASS | — | Deleting the `if (weekParam) params.set("week", weekParam)` carry-forward in `PeopleSwitcherUrlBound` fails 1 test, exercised through the real component. |
| AS-013 | **FAIL** | major | Two guards, both insufficient. (1) The runtime `vi.spyOn(Storage.prototype, "setItem")` + `expect(setLocal).not.toHaveBeenCalled()` is **unfalsifiable** — jsdom's storage does not dispatch through the patched prototype, so the spy can never record. (2) The only guard with teeth is a regex `/\bsessionStorage\s*\./` over the *text of `people-switcher.tsx` alone*. Executed mutations, both surviving 71/71: inserting `(globalThis as any)["session"+"Storage"]?.setItem("planner:people", userId)` into `toggleMember` (evades the regex); and inserting `window.localStorage?.setItem("planner:week", String(weekKey))` into `WeekView` (**not even in the scanned file** — AS-013 says "No *Planner* view state", and `week-view.tsx`, `page.tsx`, and every other Planner component are unguarded). Production is clean today; the assertion is not defended. |
| AS-051 | PASS | — | The test resolves the header row as `prevLink.closest("div")` — the real `flex items-center gap-1` nav div — and requires it to contain the switcher, next, and today. Hoisting `PeopleSwitcherUrlBound` out of the nav div into the outer header flex row (still visually adjacent) fails the test. |
| AS-052 | PASS | — | Repeating pass 1's mutation — replacing the member row's `AvatarImage`/`AvatarFallback` body with a bare `<Avatar size="sm" />` — fails 1 test. F069's test shims `window.Image` and asserts a real `src` for an avatar-bearing member and derived initials for a null-avatar member. |
| AS-053 | PASS | — | `value={displayNameFor(member)}` → `value={member.userId}` fails 3 tests. Narrowing and the no-match empty state both assert on rendered rows. |
| AS-054 | PASS | — | `onSelectionChange([...selectedUserIds, userId])` → `onSelectionChange([userId])` fails 3 tests. |
| AS-055 | PASS | — | **Pass-2 FAIL genuinely fixed.** Count half: `maxVisibleAvatars = 3` → `= 99` fails 2 tests. Identity half (F074): forcing every trigger avatar to render `selectedMembers[0]` now fails 1 test — the exact mutation that survived pass 2. |
| AS-056 | PASS | — | **Pass-2 FAIL genuinely fixed.** `onSelectionChange([selfId])` → `onSelectionChange([members[0]!.userId])` now fails 1 test. F073's fixture pins `selfId = "member-c"`, so self and first-listed are distinguishable. |
| AS-057 | PASS | — | `members.map(...)` → `members.slice(0,-1).map(...)` fails 2 tests. Set equality plus self-first position with `selfId ≠ members[0]`. |
| AS-059 | PASS | major (carried) | Removing the `[selfId]` coercion fails 1 test. **Pass 1/2's structural objection stands unchanged:** `page.tsx:120` still passes `blockUserIds={workspaceMembers.active.map((m) => m.userId)}` to `getCalendarBlocks`. `selectedUserIds` only paints the switcher; it does not filter the blocks. AS-059 is true for the wrong reason and must be re-validated after M7/F031. |
| AS-060 | PASS | — | Adding `tabIndex={-1}` to the trigger fails 3 tests. The flow is genuinely pointer-free: `user.tab()` → `{Enter}` → typed query → `{ArrowDown}{Enter}` via `userEvent`, asserting the additive `onSelectionChange(["user-1","user-2"])`. |
| AS-061 | **FAIL** | blocker | **Third consecutive fail. F072 narrowed the hole rather than closing it.** The new guard is a token regex `/^((max-)?(sm\|md\|lg\|xl\|2xl):)?hidden$/` applied to *the trigger element's own class list*. Executed mutations: `sm:hidden` → **caught** (1 test fails); `max-[767px]:hidden` (arbitrary-value breakpoint — switcher invisible at exactly the mobile width the assertion is about) → **71/71 pass**; wrapping the switcher in `<div className="hidden md:block">` in `week-view.tsx` — the switcher literally disappears at mobile width, the assertion's precise failure mode — → **71/71 pass**. `sr-only`, `invisible`, `opacity-0`, `w-0 overflow-hidden`, and container-query variants are likewise uncovered. The regex also *rejects the legitimate* mobile-first `hidden sm:flex` pair, so it constrains implementation rather than behaviour. The companion checks remain unfalsifiable: `getComputedStyle().display !== "none"` cannot fail because jsdom loads no Tailwind CSS, and the `innerWidth` 375↔1280 element-identity check is a tautology because the component has no resize listener. |

## Gate results

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** — exit 0, no output |
| `npx eslint . --max-warnings=0` | **PASS** — exit 0, no output |
| M6 unit scope (5 files) | **PASS** — 71/71 |
| Full `npx vitest run` | 292 failed files / 310 failed tests — **pre-existing and environmental**, not M6. Every failure traces to `connect ECONNREFUSED 127.0.0.1:54321` (local Supabase is not running): `Failed to create test workspace: TypeError: fetch failed` ×138, `Failed to create workspace` ×57, `owner: fetch failed` ×51. No M6 unit test is among them. |

## Source findings (production defects, all still uncovered)

Unchanged from passes 1–2; F067–F074 touched test files only and changed zero
production code.

1. **Shortcuts vanish while filtering.** cmdk filters the `Shortcuts` group, so typing any member name removes both "Just me" and "Whole team".
2. **Other query params silently erased.** `PeopleSwitcherUrlBound` builds a fresh `URLSearchParams` with only `week`/`people` and never reads `useSearchParams()`.
3. **Invalid `?week=` propagates.** The raw `weekParam` is echoed back verbatim by the switcher while prev/next normalize to the resolved `weekKey`.
4. **`aria-selected` is overloaded.** The component sets it for *checked*; cmdk sets it for *highlighted*. Removing it survives the whole suite.
5. **Duplicate cmdk `value`s** when two members both have null `name` and `email` (both render `value="Unknown member"`).
6. **`selfId ∉ members` renders an empty trigger.** "Just me" emits `[selfId]`, `selectedMembers` filters it out, and the closed trigger falls to the `aria-label="Select people"` empty state — the user sees nothing selected despite having a selection.

## Recommended follow-up features

**FU-J — Cover the AS-011 call sites, not a copy of them.** `tests/unit/f029-switcher-url-wiring.test.tsx` lines 214–240 declare `const weekHrefFor = (key) => buildWeekNavHref({ workspaceSlug: "acme", weekKey: key, peopleParam })` *inside the test* and assert on its output. That construct is a duplicate of the production closure, not an observation of it: changing `page.tsx:93–94` to `peopleParam: undefined` breaks prev/next/today in production and leaves the suite green — verified this pass, and last pass. Extract the three-href derivation out of `page.tsx` into an exported pure function (e.g. `buildPlannerWeekNavHrefs({ workspaceSlug, weekKey, peopleParam })` in `lib/calendar/people-selection.ts`) returning `{ prevHref, nextHref, todayHref }`; make `page.tsx` call only that and pass its results straight to `WeekGridSection`; delete the mirrored closure from the test and assert on the extracted function's real return values. The new test must fail under both the "delete `peopleParam`" and the "pass `peopleParam: undefined`" mutations, and no test may re-declare page.tsx logic locally.

**FU-K — Stop testing AS-061 in jsdom.** Three of F072's four checks cannot fail under any mutation and the fourth is a class-name allow/deny list that both over-rejects (`hidden sm:flex`) and under-rejects (`max-[767px]:hidden`, `sr-only`, a `hidden md:block` parent wrapper). jsdom evaluates no CSS and no media queries, so no amount of regex refinement will make a jsdom test observe mobile reachability. Move AS-061 to the Playwright e2e layer: load the Planner at a 375×667 viewport, assert the switcher trigger is visible via Playwright's actual visibility check, click it, type into the search box, toggle a member, and assert the URL's `?people=` changed. Delete the jsdom AS-061 tests entirely rather than keeping them alongside — they currently create false confidence. If e2e is out of budget for this milestone, mark AS-061 INCONCLUSIVE in the contract's evidence log rather than backing it with an unfalsifiable test.

**FU-L — Give AS-013 a real trap and repo-wide scope.** Replace the dead `vi.spyOn(Storage.prototype, "setItem")` with `vi.stubGlobal("localStorage", …)` / `vi.stubGlobal("sessionStorage", …)` installing recording proxies whose `setItem`/`removeItem`/`clear` throw, then mount the Planner, run a full open → search → toggle → shortcut cycle, and assert nothing was recorded — verify the new test fails when a write is injected. Separately, replace the single-file `/\bsessionStorage\s*\./` regex with a static scan across *all* Planner sources (`components/calendar/**`, `app/(workspace)/w/[workspaceSlug]/calendar/**`) for any reference to `localStorage`, `sessionStorage`, `Storage`, `indexedDB`, or `document.cookie`. Both of this pass's surviving mutations — an obfuscated `globalThis["session"+"Storage"]` write inside `toggleMember`, and a plain guarded `window.localStorage.setItem("planner:week", …)` inside `WeekView` — must turn the suite red.

**FU-M (carried, blocked on M7) — Re-validate AS-059 once `selectedUserIds` actually filters blocks.** `page.tsx:120` still hands `getCalendarBlocks` every active member's id, so "deselecting everyone leaves the Planner showing the signed-in member" is currently true only because the switcher's own chrome coerces to `[selfId]` — the block query never varied with selection in the first place. After F031 wires `selectedUserIds` into `blockUserIds`, re-run the AS-059 mutation against the rendered block set, not just the emitted URL.

---

## Appendix — full gate output

### `npx tsc --noEmit`
```
(exit 0, no output)
```

### `npx eslint . --max-warnings=0`
```
(exit 0, no output)
```

### `npx vitest run` — M6 unit scope, clean tree
```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  5 passed (5)
      Tests  71 passed (71)
   Duration  1.96s
```
Files: `tests/unit/f029-switcher-url-wiring.test.tsx`, `tests/unit/people-switcher.test.tsx`,
`tests/unit/people-switcher-multiselect.test.tsx`, `tests/unit/people-switcher-placement-a11y.test.tsx`,
`tests/unit/planner-people-selection.test.ts`

### `npx vitest run` — full suite (baseline, clean tree)
```
 Test Files  292 failed | 577 passed | 2 skipped (871)
      Tests  310 failed | 4556 passed | 1682 skipped (6548)
   Duration  174.03s

Dominant failure causes:
 138  Error: Failed to create test workspace: TypeError: fetch failed
  57  Error: Failed to create workspace: TypeError: fetch failed
  51  Error: owner: fetch failed
  36  Error: Failed to create test user: fetch failed
  24  Error: connect ECONNREFUSED 127.0.0.1:54321
  24  Error: Failed to seed workspace: TypeError: fetch failed
```
All are `tests/integration/**` requiring a running local Supabase on port 54321.
Pre-existing; unrelated to M6.

### Mutation log (all restored; `git status --porcelain components lib app` empty)
```
BASELINE                                              71 passed
AS-011a page.tsx peopleParam: undefined               71 passed   <- SURVIVES (FAIL)
AS-011b buildWeekNavHref ignores peopleParam           6 failed
AS-012  drop week carry-forward                        1 failed
AS-013a globalThis["session"+"Storage"] in toggle     71 passed   <- SURVIVES (FAIL)
AS-013b window.localStorage write in WeekView         71 passed   <- SURVIVES (FAIL)
AS-051  hoist switcher out of nav div                  1 failed
AS-052  member-row avatar body gutted                  1 failed
AS-053  value={member.userId}                          3 failed
AS-054  onSelectionChange([userId])                    3 failed
AS-055a maxVisibleAvatars = 99                         2 failed
AS-055b all trigger avatars = selectedMembers[0]       1 failed
AS-056  "Just me" -> members[0].userId                 1 failed
AS-057  whole team drops last member                   2 failed
AS-059  remove [selfId] coercion                       1 failed
AS-060  tabIndex={-1} on trigger                       3 failed
AS-061a trigger "sm:hidden"                            1 failed
AS-061b trigger "max-[767px]:hidden"                  71 passed   <- SURVIVES (FAIL)
AS-061c parent <div className="hidden md:block">      71 passed   <- SURVIVES (FAIL)
```
