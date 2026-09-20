# M6 — The people switcher — scrutiny pass 6

Date: 2026-09-20
Scope: F026, F027, F028, F029, F030 (+ follow-ups F067–F080)
Verdict: **RED** — 3 FAIL (2 blocker, 1 major-as-fail), 2 INCONCLUSIVE

## Assertion table

| ID | Result | Reason |
|---|---|---|
| AS-011 | PASS | Mutation-verified twice: `peopleParam` dropped inside `buildPlannerNavHrefs` fails 2 tests in `f029-switcher-url-wiring.test.tsx`; `peopleParam: undefined` at the page call site fails `f080-calendar-nav-hrefs.test.tsx`. See note 1. |
| AS-012 | PASS | `PeopleSwitcherUrlBound` forwards `weekParam` verbatim; asserted on the real pushed URL string, not a mock argument shape. |
| AS-013 | INCONCLUSIVE (major) | Primary guard is a source regex over 5 hardcoded paths; the `vi.stubGlobal` runtime guard wraps exactly one member-row click. A storage write on mount, on popover open, from a shortcut, or from any new file is uncaught. `document.cookie` / `window.name` not covered at all. |
| AS-051 | PASS | `people-switcher-placement-a11y.test.tsx` asserts real DOM containment (`prevLink.closest("div").contains(trigger)`), plus a negative test when the prop is omitted. Moving the switcher out of the row fails. |
| AS-052 | PASS (minor) | Per-row avatar image and initials-fallback paths both asserted. Minor: no test proves `page.tsx` passes `workspaceMembers.active` (vs. the unfiltered roster), so an inactive-member leak at the page layer is uncaught. |
| AS-053 | FAIL (major) | Filtering is entirely cmdk's default matcher, exercised by one positive ("Grace") and one negative ("zzzznotamatch"). A prefix-only `filter=`, a case-sensitive filter, or a `search.length < 3` short-circuit all keep the tests green while breaking mid-string / lowercase / short-query narrowing. The test confirms the library works on one happy path; it does not pin the assertion. |
| AS-054 | FAIL (blocker) | The open list has **no visible selected indicator**. Selection is signalled only by `data-checked` and `aria-selected` on `CommandItem`; `components/ui/command.tsx` styles neither (grep for `data-checked`/`aria-selected` in that file returns nothing). A user selecting several members sees no change in the list. The tests assert the attribute and the `onSelectionChange` mock — a token, not a behaviour. Additionally `test_AS_054_three_members_can_be_selected_simultaneously` renders a pre-set prop and re-renders with the identical prop: it clicks nothing and so cannot catch a cap such as `[...selected, id].slice(-3)`. |
| AS-055 | FAIL (major) | "when it does not fit" is never measured. `maxVisibleAvatars` is a constant 3, never overridden by `week-view.tsx`, with no width/ResizeObserver logic — the overflow count is a fixed-N truncation, not a fit test. Two further silent mutations survive: `.slice(0,n)` → `.slice(-n)` (different avatars shown, identical counts) and `selectedMembers = members.filter(...)`, which drops selected ids absent from `members` from *both* the avatars and the overflow count, under-reporting the real selection. |
| AS-056 | INCONCLUSIVE (blocker at M7) | The shortcut exists and pushes `?people=me`, but **the Planner does not narrow**: `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx:127` feeds the block query `blockUserIds={workspaceMembers.active.map((m) => m.userId)}`, not `selectedUserIds`. Clicking "Just me" leaves every member's blocks on screen. The in-file comment defers this to F031 (M7), so it is not an M6 regression — but the assertion as written ("returns the Planner to the signed-in member alone") is not satisfied today and must be re-verified at M7. |
| AS-057 | PASS (major) | `orderPeopleForWholeTeam` over the full `members` prop; asserted via callback. Vacuously consistent with the screen today only because the grid is already unfiltered (see AS-056). Re-verify at M7. |
| AS-059 | INCONCLUSIVE (major) | The empty→self coercion is genuinely doubled up (client `PeopleSwitcherUrlBound` and server `parsePeopleParam`) and mutation-resistant at URL level. But "leaves the Planner showing the signed-in member" is unobservable while the view is never narrowed (AS-056). Re-verify at M7. |
| AS-060 | PASS (major) | Real `userEvent`: `tab()` → focus on trigger → `{Enter}` → type "Grace" (narrowing proves focus reached `CommandInput`) → `{ArrowDown}{Enter}` → `onChange` called with the two-id selection. Gaps: it only drives the bare `PeopleSwitcher`, never `PeopleSwitcherUrlBound`, so gutting `router.push` leaves it green; Escape-to-close and Space activation are unasserted; with the list filtered to one item the `{ArrowDown}` is a no-op, so deleting arrow navigation survives. |
| AS-061 | PASS (major) | `npx playwright test tests/e2e/m6-people-switcher-mobile.spec.ts` → **1 passed (8.4s)**, real Chromium at 375×812, trigger visible and click-to-open works. Major: `test.skip(!haveAdminCreds, ...)` makes the spec report skipped-green on any machine without `.env`, and jsdom deliberately covers nothing here — so absent creds AS-061 has zero coverage, not degraded coverage. The spec also never dismisses the "Welcome to pm-app" onboarding dialog a freshly-seeded user gets; a prior recorded run in `test-results/` failed with that overlay present. |

### Note 1 — AS-011
The F080 handoff claims the regex guards were deleted. They were not: `tests/unit/f080-calendar-nav-hrefs.test.tsx` still ends with a source-text `describe` block, and that block is the *only* thing that caught mutation 3. The new rendered-`<a href>` tests pass `prevHref`/`nextHref`/`todayHref` in as literal string props, so they never invoke `buildPlannerNavHrefs` and would not have caught either mutation — they prove only that `WeekView` copies its href props onto anchors. AS-011 passes on the strength of the `f029` F075 tests plus the surviving regex guard, not on the strength of F080.

## Mutation log

| Mutation | Expected | Observed |
|---|---|---|
| `lib/calendar/week-nav.ts`: shadow `peopleParam` with `undefined` | test fails | full unit suite 133 → **135** failures; the 2 new ones are `f029-switcher-url-wiring.test.tsx > F075 (AS-011)`. Restored. |
| `page.tsx`: `peopleParam: undefined` in `buildPlannerNavHrefs` | test fails | `f080-calendar-nav-hrefs.test.tsx > test_AS_011_page_passes_people_param_to_nav_hrefs` **FAILED** (1 failed / 19 passed). Restored. |
| both restored | clean tree | `git status --porcelain -- app lib components tests` → empty. |

## Recommended follow-up features

**Give the open list a visible selected state (AS-054, blocker).** A member row that is part of the current selection is today indistinguishable from one that is not: `people-switcher.tsx` sets `data-checked` and `aria-selected` on each `CommandItem`, and `components/ui/command.tsx` has no rule for either, so nothing renders. Add a real affordance inside the row — a check mark rendered conditionally on `isSelected`, which is testable by role/text rather than by attribute — and replace the attribute assertions in `people-switcher-multiselect.test.tsx` with assertions on that rendered element. Rewrite `test_AS_054_three_members_can_be_selected_simultaneously` so it actually clicks three rows in sequence starting from an empty selection and asserts the accumulated selection after each click; the current version re-renders the same prop twice and clicks nothing, so a silent selection cap survives it. Note that `aria-selected` on a cmdk `CommandItem` also collides with cmdk's own use of that attribute for the keyboard-active item, so the a11y signal should move to `aria-checked` with an appropriate role.

**Pin the switcher's filter semantics (AS-053, major).** Filtering currently relies on cmdk's default matcher with no explicit contract, and is covered by a single match and a single non-match. Add tests that fix the intended semantics: a mid-string query ("ovelace") narrows to the expected member, a lowercase query matches a capitalised name, a one- and two-character query already narrows, and a query matching two members leaves exactly those two. Decide explicitly whether email is searchable and assert that decision. Also pin the value cmdk matches on — the row currently sets `value={displayNameFor(member)}`, and two members resolving to the same display name (or two both falling back to "Unknown member") produce duplicate cmdk values, which corrupts cmdk's highlight and filter bookkeeping; the value should be disambiguated with the member id.

**Make the trigger's overflow count reflect fit and the whole selection (AS-055, major).** `maxVisibleAvatars` is a hardcoded 3 with no width measurement, so "when it does not fit" is never evaluated: three avatars can overflow a narrow mobile trigger with no `+N` shown, while a wide trigger collapses at four. Either measure the available width (ResizeObserver on the trigger) and derive the visible count, or amend how the assertion is evidenced and document the fixed-N behaviour explicitly. Independently, fix two correctness bugs the tests cannot see: `selectedMembers` is derived by filtering `members`, so any selected id not present in `members` disappears from both the avatar group and the overflow count, under-reporting the selection; and the visible slice should be pinned by a test with more selected members than `maxVisibleAvatars` so that `.slice(0,n)` cannot be swapped for `.slice(-n)` unnoticed.

**Broaden the no-browser-storage guard (AS-013, major).** The guard is a regex over five hardcoded file paths plus a `vi.stubGlobal` wrapper around one member-row click. Replace the path list with a glob over the whole Planner surface (`components/calendar/**`, `lib/calendar/**`, the calendar route) so a new file cannot opt out by existing, and extend the runtime guard to stub `localStorage`, `sessionStorage`, `document.cookie`, `caches` and `window.name` across a full interaction script — mount, open the popover, type, toggle a member, click "Just me", click "Whole team", close — failing on any write.

**Make the mobile E2E spec loud when it cannot run (AS-061, major).** `test.skip(!haveAdminCreds, ...)` currently reports skipped-green outside CI, and jsdom intentionally covers nothing for this assertion, so a validator run without `.env` yields zero evidence that reads as success. Make the absence of credentials a hard failure unless an explicit `ALLOW_SKIP_E2E` escape hatch is set, and record the passing run as a milestone artifact. In the same spec, dismiss the "Welcome to pm-app" onboarding dialog before clicking the trigger — the spec seeds a brand-new user on every run and a prior recorded run failed with that overlay intercepting the click.

**Assert the switcher's member source at the page layer (AS-052, minor).** `switcher-member-source.test.ts` tests `getWorkspaceMembers` against a mocked Supabase client; no test asserts that `page.tsx` hands `WeekView` the *active* subset. Swapping `workspaceMembers.active` for the unfiltered roster would leak invited and deactivated members into the switcher with the whole suite green. Add a page- or `WeekGridSection`-level test that pins the prop to the active list.

**Carry AS-056/AS-057/AS-059 forward as mandatory M7 re-verification.** `page.tsx:127` passes the full active roster to `getCalendarBlocks`, so the Planner never narrows to the selection and the user-visible half of these three assertions is currently unverifiable. This is deferred by design to F031, and F031's own assertion list (AS-001, AS-002, AS-014, AS-023) does not mention them. Add AS-056, AS-057 and AS-059 to F031's assertion set so the M7 validator is forced to confirm that clicking "Just me" actually empties the grid of everyone else, and that an empty selection still shows the viewer.

## Gate output

```
$ npx tsc --noEmit
exit 0 (no output)

$ npx eslint . --max-warnings=0
exit 0 (no output)

$ npx playwright test tests/e2e/m6-people-switcher-mobile.spec.ts
exit 0
  1 passed (8.4s)
  (WebServer log contains only report-only CSP violations from Next.js vendor chunks — unrelated)

$ npx vitest run <9 M6 unit files>
 Test Files  9 passed (9)
      Tests  94 passed (94)

$ npx vitest run tests/unit/     # full suite, baseline
 Test Files  41 failed | 468 passed | 1 skipped (510)
      Tests  133 failed | 3274 passed | 3 skipped (3410)
```

Note on the full suite: the 133 baseline failures are pre-existing and lie entirely outside M6 (f003 page/section client-visibility, f006/f007/f008/f015/f024/f025 section-card suites, etc. — a different mission's surface). No M6 file is among them. They are recorded here because they are the reason the mutation runs are reported as a delta (133 → 135) rather than as pass/fail of the whole suite, and because a milestone gate that runs the full unit suite cannot currently be green.
