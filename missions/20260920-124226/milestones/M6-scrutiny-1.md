# M6 scrutiny — pass 1

_Milestone: M6 — The people switcher (F026–F030)_
_Mission: 20260920-124226_  _Date: 2026-09-20_
_Verdict: **RED** — 4 FAILs (2 blocker, 2 major)_

## Verdict table

| Assertion | Verdict | Severity | Reason |
|---|---|---|---|
| AS-011 | **FAIL** | blocker | Only the pure helper `buildWeekNavHref` is tested. Deleting `peopleParam` from both call sites in `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx:92-94` leaves every M6 test green — prev/next/today would silently drop `?people=` in production. Mutation independently reproduced twice. |
| AS-012 | PASS | — | Exercised through the real `PeopleSwitcherUrlBound`; removing the `week` carry-forward fails the test. |
| AS-013 | PASS | minor | The `Storage.prototype.setItem` spy test is genuine and kills an injected `localStorage.setItem`. The companion test is a source-text regex on one file — vacuous, and blind to storage written from `week-view.tsx`/`page.tsx`. Independent grep of `components/calendar/**` and the calendar route confirms zero storage calls, so the assertion itself holds. |
| AS-051 | PASS | minor | Switcher renders inside the same header row as prev/today/next; moving it to a sibling toolbar fails 3 tests. Weak point: the test derives "the header row" via `prevLink.closest("div")`, so any future wrapper `div` around the prev button silently narrows the ancestor and makes the assertion vacuous. |
| AS-052 | **FAIL** | major | Name is asserted; **avatar is not**. Replacing each row's avatar body with a bare `<Avatar size="sm" />` (no `AvatarImage`, no `AvatarFallback` initials) leaves all 15 tests green — the test only counts `[data-slot="avatar"]` elements. No test asserts `src`/`alt` or fallback initials, and no fixture in the multiselect file sets `avatarUrl`. |
| AS-053 | PASS | — | Non-vacuous: changing `value={displayNameFor(member)}` to `value={member.userId}` fails the narrowing test. Both narrowing and the no-match empty state assert on real rendered rows. |
| AS-054 | PASS | — | Non-vacuous: replacing the add branch with `onSelectionChange([userId])` fails. Cumulative selection is exercised through a stateful controlled wrapper; deselect-one asserted separately. |
| AS-055 | **FAIL** | major | Two surviving mutations: (a) `maxVisibleAvatars = 3` → `= 99` — the default is never exercised because every AS-055 test passes an explicit value, so the production overflow threshold is untested; (b) `Math.max(0, selectedMembers.length - visibleMembers.length)` → `selectedUserIds.length - visibleMembers.length` — no fixture has a selected id absent from `members`. The `selected.length === maxVisibleAvatars` boundary (no chip) is never asserted at the boundary. |
| AS-056 | PASS | major (edge) | Happy path genuinely asserted. Hole: when `selfId ∉ members`, "Just me" emits `[selfId]`, and the closed trigger then renders the *empty* state (`aria-label="Select people"`, no avatar group) despite a selection existing. Silent failure, untested. |
| AS-057 | PASS | — | Set equality plus self-first position asserted; "replaces a prior partial selection" covered. |
| AS-059 | PASS | major | The `[selfId]` coercion in `PeopleSwitcherUrlBound` is non-vacuous (removing it fails the test). **But** `page.tsx:120` still passes `blockUserIds={workspaceMembers.active.map(...)}` — every active member — to `getCalendarBlocks`; `selectedUserIds` only paints the switcher. AS-059 is therefore trivially true for the wrong reason and must be re-validated once M7/F031 wires the selection into the query. |
| AS-060 | PASS | — | Genuinely keyboard-driven: `user.tab()` → `{Enter}` → typed `"Grace"` → `{ArrowDown}{Enter}` via `userEvent`. No `fireEvent.click`, no direct `onSelect` invocation. |
| AS-061 | **FAIL** | blocker | Vacuous. Adding `sm:hidden` to the trigger's className (the switcher literally disappears above the `sm` breakpoint) leaves all 6 placement tests green — the regex `/(^|\s)hidden(\s|$)/` matches no Tailwind responsive variant. Second flaw: `switcherTrigger.closest('[class*="flex"]')` resolves to the trigger *itself* (its className starts with `flex items-center`), so the "header row isn't `md:hidden`" assertion checks the wrong element. The companion test sets `window.innerWidth = 375`, which changes nothing about CSS in jsdom, then re-runs AS-060's flow with `fireEvent` — it proves nothing about mobile width. |

## Additional source findings (no test covers any of these)

1. **Shortcuts vanish while filtering.** cmdk filters the `Shortcuts` group along with members: typing "Grace" removes both "Just me" and "Whole team"; typing "me" hides every real member and shows only "Just me". AS-056/AS-057 say the switcher *offers* the shortcuts — after any keystroke it does not.
2. **Other query params are silently erased.** `PeopleSwitcherUrlBound` (`people-switcher.tsx:302-309`) builds a fresh `URLSearchParams` holding only `week` and `people`; it never reads `useSearchParams()`. `buildWeekNavHref` has the same shape. Harmless today (the page declares only those two params) but any future param or a shared link's UTM is dropped the moment a member is toggled.
3. **Invalid `?week=` propagates.** `page.tsx` resolves the grid with `parseWeekKey(weekParam) ?? currentWeekKey(...)` but forwards the *raw* `weekParam` to the switcher, which writes it straight back. So `?week=banana` survives every selection change, while prev/next normalize to the resolved `weekKey`. Self-consistent but asymmetric.
4. **`aria-selected={isSelected}` is overloaded and untested.** Removing it survives the whole suite (tests read `data-checked`). cmdk already owns `aria-selected` for the *highlighted* option, so multi-select checked state is likely not announced correctly to screen readers. The correct split is `role="option"` + `aria-selected` for highlight and `aria-checked` for selection.
5. **Duplicate cmdk `value`s.** Two members with both `name` and `email` null render `value="Unknown member"`. Per-item `onSelect` still routes correctly, but cmdk keyboard highlighting and filtering treat them as one option.
6. **Pre-existing suite breakage.** `npx vitest run tests/unit` exits 1 with 41 failed files / 133 failed tests. All are Sitemap Builder (`f0NN-*`) and date-dependent due-date tests; none touch `components/calendar/*`, `lib/calendar/*`, or `people-switcher*`. This matches the failure set documented in earlier handoffs and is not attributable to M6, but the M0 gate ("`npx vitest run tests/unit` green") is not actually satisfied at HEAD and should be resolved before the mission's final gate (F041).

## Recommended follow-up features

**FU-A — Integration test for `?people=` preservation across week navigation (AS-011).** The Planner route computes prev/next/today hrefs itself via `weekHrefFor`/`todayHref` in `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`, and nothing tests that producer: the existing AS-011 tests only call `buildWeekNavHref` directly, and the placement test feeds `WeekView` literal href strings. Add a test that exercises the route's own href derivation with a `?people=` value present — either by extracting the derivation into an exported, directly-testable function that the page then calls, or by rendering the page's returned tree with mocked queries — and assert that all three nav hrefs carry the people value forward verbatim. The test must fail when `peopleParam` is dropped from either `buildWeekNavHref` call site.

**FU-B — Make the AS-061 mobile-reachability test behavioural.** The current test asserts the absence of a bare `hidden` class, which no Tailwind responsive variant matches, and then inspects the wrong ancestor element. Replace it with a check that actually falsifies disappearance at small widths: assert the trigger carries no `*:hidden` responsive variant of any breakpoint prefix (`sm:`/`md:`/`lg:`/`xl:`/`max-*:`), correctly resolve the header-row ancestor by a stable `data-*` hook rather than `closest('[class*="flex"]')`, and assert the same about the header row. Pair it with a Playwright assertion at a 375px viewport that the trigger is visible and clickable, since CSS media queries do not evaluate in jsdom at all. The unit test must fail when `sm:hidden` is added to the trigger's className.

**FU-C — Harden the AS-052 avatar assertion and the AS-055 overflow contract.** Three concrete gaps: the AS-052 test counts avatar *elements* and so survives stripping `AvatarImage`/`AvatarFallback`; the AS-055 tests always pass `maxVisibleAvatars` explicitly, so the production default of 3 is never exercised; and the overflow count derives from `selectedMembers` (ids intersected with `members`) with no fixture where a selected id is absent from `members`. Add: a fixture whose member has a non-null `avatarUrl` and assert the rendered `img` `src`/`alt`, plus a null-`avatarUrl` member whose fallback renders the expected initials; an AS-055 case with no explicit `maxVisibleAvatars` asserting 3 avatars and a `+N` chip at four selections; a boundary case at exactly `maxVisibleAvatars` asserting no chip; and a case where `selectedUserIds` contains an id not in `members`, pinning whether it counts toward overflow.

**FU-D — Keep the "Just me" / "Whole team" shortcuts reachable while filtering, and fix the unknown-self trigger state.** Today cmdk's filter applies to the `Shortcuts` group, so typing any member name removes both shortcuts from the popover, and typing "me" hides every member. Exclude the shortcut group from filtering (a `forceMount`-style group or a custom `filter` that always keeps the shortcut values) and assert with a test that both shortcuts are still present after typing a member-name query. In the same feature, close the `selfId ∉ members` hole: "Just me" currently produces a one-id selection whose trigger renders the empty "Select people" state with no avatar, so the user sees nothing selected. Decide and test the intended behaviour — most likely render a self avatar from a passed-in self member, or require `selfId` to be present in `members` and assert that invariant.

**FU-E — Fix the `aria-selected` overload on member rows (AS-060 adjacent).** Member rows set `aria-selected={isSelected}` while cmdk independently sets `aria-selected` on the *highlighted* option, so one attribute carries two contradictory meanings and a screen reader cannot distinguish "focused" from "chosen". Removing the attribute entirely survives the whole suite, which proves it is untested. Switch the selection state to `aria-checked` on a row with an appropriate role (or use cmdk's documented multi-select pattern), leave `aria-selected` to cmdk for highlight, and add a test asserting that toggling a member flips the checked-state attribute on that row and on no other row.

**FU-F — Preserve unrelated query params and normalize `?week=` on selection change.** `PeopleSwitcherUrlBound.onSelectionChange` constructs a fresh `URLSearchParams` containing only `week` and `people`, so every other query param on the URL is discarded when a member is toggled; `buildWeekNavHref` behaves the same way for week navigation. Additionally the switcher echoes the raw, unvalidated `weekParam` back into the URL, so `?week=banana` survives indefinitely even though prev/next emit the resolved `weekKey`. Read the current params (via `useSearchParams` in the client wrapper, and by threading the full param record into `buildWeekNavHref` on the server) and set `week`/`people` on top of them rather than replacing them; normalize `week` to the resolved key. Test that an unrelated param survives a selection change and that an invalid `week` is rewritten to the resolved key.

**FU-G — Re-validate AS-059 once the selection drives the query.** `page.tsx` still passes every active member as `blockUserIds` to `getCalendarBlocks`, with the parsed `selectedUserIds` used only to render the switcher. Deselecting everyone therefore cannot produce an empty Planner for the trivial reason that the selection has no effect on the data at all. After M7/F031 wires `selectedUserIds` into the block fetch, re-run AS-059 against the real path: assert that an empty `?people=` resolves to `[selfId]` *and* that the grid then shows the signed-in member's blocks and not the whole workspace's.

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

### `npx vitest run tests/unit`

```
 Test Files  41 failed | 467 passed | 1 skipped (509)
      Tests  133 failed | 3261 passed | 3 skipped (3397)
EXIT=1
```

Failing files (all pre-existing; none in `components/calendar/*`, `lib/calendar/*`, or `people-switcher*`):

```
tests/unit/f003-page-client-visibility-toggle.test.tsx
tests/unit/f003-section-client-visibility-toggle.test.tsx
tests/unit/f006-section-card-menu-kind-row.test.tsx
tests/unit/f007-cms-badge-section-card.test.tsx
tests/unit/f008-section-card.test.tsx
tests/unit/f009-board-layout.test.tsx
tests/unit/f011-slug-proposal.test.ts
tests/unit/f013-create-section.test.tsx
tests/unit/f014-rename-page.test.tsx
tests/unit/f015-rename-section.test.tsx
tests/unit/f016-change-page-kind.test.tsx
tests/unit/f017-delete-section.test.tsx
tests/unit/f018-delete-page.test.tsx
tests/unit/f020-reorder-sections.test.tsx
tests/unit/f022-reorder-columns.test.tsx
tests/unit/f023-keyboard-dnd.test.tsx
tests/unit/f024-drag-cancellation.test.tsx
tests/unit/f024-section-card-details-data.test.tsx
tests/unit/f025-section-card-node-meta-icon.test.tsx
tests/unit/f026-component-picker.test.tsx
tests/unit/f026-meta-bound-to-section.test.ts
tests/unit/f027-instance-display.test.tsx
tests/unit/f032-visual-distinction.test.tsx
tests/unit/f033-hover-highlighting.test.tsx
tests/unit/f034-component-panel.test.tsx
tests/unit/f035-component-detail.test.tsx
tests/unit/f036-rename-delete-panel.test.tsx
tests/unit/f044-page-column-slug-editor.test.tsx
tests/unit/f045-create-page-dialog-page-kind.test.tsx
tests/unit/f048-component-panel-dnd.test.tsx
tests/unit/f060-discipline-estimate-schema.test.tsx
tests/unit/f081-board-performance.test.tsx
tests/unit/f083-note-validation-ui.test.tsx
tests/unit/f084-keyboard-accessibility.test.tsx
tests/unit/f085-sortable-section-list-details-data.test.tsx
tests/unit/f096-invalidate-details-chain.test.tsx
tests/unit/f097-page-column-header-icon-state.test.tsx
tests/unit/f104-page-column-chain.test.tsx
tests/unit/f250-list-inline-edit.test.tsx
tests/unit/list-due-date-cell-empty-state.test.tsx
tests/unit/list-due-date-cell-optimistic.test.tsx
```

### M6 test files in isolation

```
npx vitest run tests/unit/people-switcher.test.tsx
  tests/unit/people-switcher-multiselect.test.tsx
  tests/unit/f029-switcher-url-wiring.test.tsx
  tests/unit/people-switcher-placement-a11y.test.tsx
→ 4 files passed, all tests passed
```

### Working tree

`git status --porcelain -- components lib app tests` → empty. No code, test, or contract file was modified by this review. All mutations were restored.
