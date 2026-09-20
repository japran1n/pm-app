# M6 scrutiny — pass 2

_Milestone: M6 — The people switcher (F026–F030, follow-ups F067–F070)_
_Mission: 20260920-124226_  _Date: 2026-09-20_
_Verdict: **RED** — 4 FAILs (2 blocker, 2 major)_

Pass 1 reported 4 FAILs. **Two were genuinely fixed (AS-052, AS-055 overflow-count
half). One was papered over with a source-text regex (AS-011). One was not fixed at
all (AS-061) — the replacement test is the same vacuity in more code.** Two new FAILs
surfaced under mutation that pass 1 had marked PASS/partial (AS-056, AS-055 avatar
identity).

Every verdict below is backed by an executed mutation on a clean tree, with the file
restored via `git checkout --` immediately after. `git status` confirms no source file
was left modified.

## Verdict table

| Assertion | Verdict | Severity | Reason |
|---|---|---|---|
| AS-011 | **FAIL** | major | F067 added a *regex over `page.tsx` source text* asserting each `buildWeekNavHref({...})` call site contains the token `peopleParam`. It kills only pass 1's literal mutation. Executed mutation `buildWeekNavHref({ workspaceSlug, weekKey: key, peopleParam: undefined })` — prev/next silently drop `?people=` in production — **10/10 tests still pass**. No test observes an actual href. Production behaviour is correct at HEAD; the test is not. |
| AS-012 | PASS | — | Deleting the `if (weekParam) params.set("week", weekParam)` carry-forward in `PeopleSwitcherUrlBound` fails 1 test. Exercised through the real component. |
| AS-013 | PASS | — | Injecting `window.localStorage.setItem("planner","x")` into `PeopleSwitcher` fails 27 tests across all 4 files. The `Storage.prototype` spy is genuine and broadly armed. |
| AS-051 | PASS | — | Moving the switcher out of `week-view.tsx`'s `flex items-center gap-1` nav row into a separate sibling toolbar fails 1 test. Non-vacuous. |
| AS-052 | PASS | — | **Pass-1 FAIL genuinely fixed.** Repeating pass 1's mutation (replace the member row's `AvatarImage`/`AvatarFallback` body with a bare `<Avatar size="sm" />`) now fails 1 test. F069's test shims `window.Image`, asserts a real `src` for an avatar-bearing member and derived initials for a null-avatar member. |
| AS-053 | PASS | — | `value={displayNameFor(member)}` → `value={member.userId}` fails 3 tests. Narrowing and no-match empty state both assert on rendered rows. |
| AS-054 | PASS | — | `onSelectionChange([...selectedUserIds, userId])` → `onSelectionChange([userId])` fails 3 tests. Cumulative selection genuinely exercised. |
| AS-055 | **FAIL** | major | F070 fixed the *count* half: repeating pass 1's mutation `maxVisibleAvatars = 3` → `= 99` now fails 2 tests. But the assertion also says the closed state "shows **the current selection** as a group of avatars", and the avatars' identity is untested. Executed mutation at `people-switcher.tsx:169`: `initialsFor(member)` → `initialsFor(selectedMembers[0]!)` — every trigger avatar renders the same person — **all 33 tests pass**. The trigger's `AvatarImage` path is never exercised: all AS-055 fixtures use `avatarUrl: null`. |
| AS-056 | **FAIL** | blocker | Only one test activates "Just me", and it uses `selfId: "user-1"` which is also `members[0]`, so self and first-listed are indistinguishable. Executed mutation at line 195: `onSelectionChange([selfId])` → `onSelectionChange([members[0]!.userId])` — the shortcut returns the Planner to the *first listed* member, not the signed-in one — **all 33 tests pass**. The second AS-056 test uses `selfId: "user-2"` but only asserts the item is *present*; it never selects it. Pass 1 marked this PASS; it is not. |
| AS-057 | PASS | — | `members.map(...)` → `members.slice(0,-1).map(...)` fails 2 tests. Set equality plus self-first position with `selfId ≠ members[0]`. |
| AS-059 | PASS | major (carried) | Removing the `[selfId]` coercion fails 1 test. **But pass 1's structural objection stands unchanged:** `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx:120` still passes `blockUserIds={workspaceMembers.active.map((m) => m.userId)}` to `getCalendarBlocks`. `selectedUserIds` only paints the switcher. AS-059 is true for the wrong reason and must be re-validated after M7/F031. |
| AS-060 | PASS | — | Adding `tabIndex={-1}` to the trigger fails 3 tests. The flow is genuinely pointer-free: `user.tab()` → `{Enter}` → typed query → `{ArrowDown}{Enter}` via `userEvent`. |
| AS-061 | **FAIL** | blocker | **Not fixed. F068 replaced a vacuous test with a longer vacuous test.** Executed mutations: adding `sm:hidden` to the trigger className — **all 33 pass**; adding `max-sm:hidden` (switcher invisible at exactly the mobile width the assertion is about) — **all 33 pass**. The new test's four checks are each unfalsifiable: `classTokens.includes("hidden")` is an exact-token match that cannot match any responsive variant (the test's own comment claims otherwise — that comment is wrong); `getComputedStyle().display !== "none"` can never fail because jsdom loads no Tailwind CSS; the `innerWidth` 375↔1280 element-identity check is trivially true because the component has no resize listener; the ancestor-depth ≤ 4 check re-tests AS-051. The second test only sets `innerWidth` and re-runs AS-060's flow — deleting both `Object.defineProperty` lines would change nothing. |

## Note on the flagged pre-existing `tsc` error

The F067 worker flagged a pre-existing `tsc` error in `people-switcher.tsx`.
`npx tsc --noEmit` is **clean at HEAD (exit 0, no output)**. No action needed.

## Additional source findings (unchanged from pass 1, still uncovered)

All of pass 1's findings 1–5 remain true at HEAD; none were addressed by F067–F070
(which touched test files only, plus zero production code). Restated in brief:

1. **Shortcuts vanish while filtering.** cmdk filters the `Shortcuts` group, so typing
   any member name removes both "Just me" and "Whole team".
2. **Other query params silently erased** by `PeopleSwitcherUrlBound` (builds a fresh
   `URLSearchParams` with only `week`/`people`; never reads `useSearchParams()`).
3. **Invalid `?week=` propagates** — the raw `weekParam` is echoed back verbatim while
   prev/next normalize to the resolved `weekKey`.
4. **`aria-selected` is overloaded** — the component sets it for *checked*, cmdk sets
   it for *highlighted*. Removing it survives the whole suite.
5. **Duplicate cmdk `value`s** when two members both have null `name` and `email`
   (both render `value="Unknown member"`).

New in pass 2:

6. **`selfId ∉ members` renders an empty trigger.** Pass 1 noted this under AS-056; it
   compounds the AS-056 blocker. "Just me" emits `[selfId]`, `selectedMembers` filters
   it out, and the closed trigger falls to the `aria-label="Select people"` empty state
   with no avatar — the user sees nothing selected despite having a selection.

## Recommended follow-up features

**FU-H — Replace the AS-011 source regex with a test that observes an actual href.**
`tests/unit/f029-switcher-url-wiring.test.tsx` currently asserts that the *text* of
`app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` contains the token `peopleParam`
inside each `buildWeekNavHref({...})` call. That is a check on source spelling, not on
behaviour: passing `peopleParam: undefined` keeps the token, breaks the feature, and
leaves the suite green — verified. Extract the page's three-href derivation (prev,
next, today) into an exported pure function in `lib/calendar/people-selection.ts` (or
adjacent) that takes `{ workspaceSlug, weekKey, peopleParam }` and returns the three
href strings, have `page.tsx` call only that, and test the extracted function directly:
given a non-empty `peopleParam`, assert all three returned hrefs contain the people
value verbatim. Then delete the regex test. The new test must fail under both the
"delete `peopleParam`" and the "pass `peopleParam: undefined`" mutations.

**FU-I — Make AS-061 falsifiable, or move it out of jsdom.** Three of F068's four
checks cannot fail under any mutation, and the fourth duplicates AS-051; both
`sm:hidden` and `max-sm:hidden` mutations survive. jsdom evaluates no CSS and no media
queries, so *no* className-inspection test can honestly validate "usable at mobile
viewport width". Two changes are needed. First, in the unit test, replace the exact
`classTokens.includes("hidden")` check with a scan that rejects a `hidden` token
carrying *any* variant prefix — match each token against
`/(^|:)hidden$/` after splitting, i.e. reject `hidden`, `sm:hidden`, `max-sm:hidden`,
`md:hidden`, and so on, unless an un-hiding variant for a smaller breakpoint is also
present; apply the same scan to the header row resolved by a stable `data-slot` hook
rather than `closest('[class*="flex"]')`. Delete the `getComputedStyle`, the
`innerWidth` element-identity block, and the second "remains operable regardless of
viewport" test, all of which assert nothing. Second, add a Playwright spec at a 375×667
viewport that asserts the trigger is visible and clickable and that the popover opens
and a member can be toggled — this is the only place AS-061 can actually be validated.
The unit test must fail under `sm:hidden` and under `max-sm:hidden`.

**FU-J — Pin "Just me" to the signed-in member, not the first listed one.** Every test
that *activates* the "Just me" shortcut uses a fixture where `selfId === members[0].userId`,
so the shortcut's defining property is untested: mutating
`onSelectionChange([selfId])` to `onSelectionChange([members[0]!.userId])` keeps all 33
tests green. Add a test with `selfId` set to a member in the middle of the list (and
whose name does not sort first), activate "Just me" via the popover, and assert the
emitted selection is exactly `[selfId]` — not `[members[0].userId]`, not a set
containing more than one id. In the same feature, close the related hole: when `selfId`
is not present in `members`, "Just me" produces a one-id selection but the closed
trigger renders the `aria-label="Select people"` empty state with no avatar, so the
user sees nothing selected. Decide the intended behaviour (most likely: require
`selfId ∈ members` and assert that invariant, or accept a self member object as a prop
and render it), implement it, and test it.

**FU-K — Assert the closed trigger's avatars depict the actual selection.** AS-055
says the closed state shows *the current selection*; the tests only count elements
inside `[data-slot="people-switcher-avatar-group"]`, so rendering the same person's
initials in every slot (`initialsFor(member)` → `initialsFor(selectedMembers[0]!)` at
`people-switcher.tsx:169`) survives the whole suite. Add a test that selects two or
three distinguishable members and asserts the trigger's avatars carry each selected
member's own initials, in selection order, and no unselected member's. Add at least one
fixture with a non-null `avatarUrl` — every current AS-055 fixture is `avatarUrl: null`,
so the trigger's `AvatarImage` branch is dead code as far as the suite is concerned —
and assert its `src`/`alt`. Also add the boundary case at exactly `maxVisibleAvatars`
selections asserting no `+N` chip is rendered, and a case where `selectedUserIds`
contains an id absent from `members`, pinning whether it counts toward the overflow
number (today it does not, because `overflowCount` derives from `selectedMembers`).

Pass 1's **FU-D** (shortcuts vanish while filtering), **FU-E** (`aria-selected`
overload), **FU-F** (query-param preservation and `?week=` normalization) and **FU-G**
(re-validate AS-059 after M7/F031 wires the selection into the block fetch) were never
spawned and remain open. FU-A/FU-B/FU-C are superseded by FU-H/FU-I/FU-J+FU-K
respectively.

---

## Gate output

### `npx tsc --noEmit`

```
(no output)
EXIT=0
```

### `npx eslint . --max-warnings=0`

```
(no output)
EXIT=0
```

### `npx vitest run tests/unit/people-switcher.test.tsx tests/unit/people-switcher-multiselect.test.tsx tests/unit/people-switcher-placement-a11y.test.tsx tests/unit/f029-switcher-url-wiring.test.tsx tests/unit/planner-people-selection.test.ts` (baseline, clean tree)

```
 Test Files  5 passed (5)
      Tests  68 passed (68)
```

### `npx vitest run tests/unit` (full suite)

```
 Test Files  41 failed | 467 passed | 1 skipped (509)
      Tests  133 failed | 3264 passed | 3 skipped (3400)
EXIT=1
```

Identical pre-existing failure set to pass 1 (41 files / 133 tests), +3 newly passing
tests from F067–F070. All failures are Sitemap Builder (`f0NN-*`) and date-dependent
due-date tests; none touch `components/calendar/*`, `lib/calendar/*`, or
`people-switcher*`. Not attributable to M6, but the M0 gate
("`npx vitest run tests/unit` green") is still not satisfied at HEAD and must be
resolved before F041.

### Mutation log (all restored)

| # | Target | Mutation | Result |
|---|---|---|---|
| M1 | `people-switcher.tsx:139` | prepend `sm:hidden` to trigger className | **SURVIVED** (33 pass) |
| M2 | `people-switcher.tsx:103` | `maxVisibleAvatars = 3` → `= 99` | killed (2 fail) |
| M3 | `people-switcher.tsx:230-238` | member row body → `<Avatar size="sm" />` | killed (1 fail) |
| M4 | `page.tsx:93-94` | delete `peopleParam` from both call sites | killed (1 fail) |
| M4b | `page.tsx:93` | `peopleParam: undefined` | **SURVIVED** (10 pass) |
| M5 | `people-switcher.tsx:195` | `[selfId]` → `[members[0]!.userId]` | **SURVIVED** (33 pass) |
| M6b | `people-switcher.tsx:169` | `initialsFor(member)` → `initialsFor(selectedMembers[0]!)` | **SURVIVED** (33 pass) |
| M7 | `people-switcher.tsx:139` | prepend `max-sm:hidden` to trigger className | **SURVIVED** (33 pass) |
| M8 | `people-switcher.tsx:304-306` | delete `week` carry-forward | killed (1 fail) |
| M9 | `people-switcher.tsx:300` | drop `[selfId]` empty coercion | killed (1 fail) |
| M10 | `people-switcher.tsx:225` | `value={displayNameFor(member)}` → `value={member.userId}` | killed (3 fail) |
| M11 | `people-switcher.tsx:123` | append → replace on select | killed (3 fail) |
| M12 | `people-switcher.tsx:137` | add `tabIndex={-1}` to trigger | killed (3 fail) |
| M13 | `people-switcher.tsx:106` | inject `localStorage.setItem` | killed (27 fail) |
| M14 | `week-view.tsx:90-98` | move switcher to a sibling toolbar outside the nav row | killed (1 fail) |
| M15 | `people-switcher.tsx:206` | `members.map` → `members.slice(0,-1).map` | killed (2 fail) |
