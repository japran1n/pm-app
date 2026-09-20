# M6 — The people switcher — scrutiny pass 7

Date: 2026-09-20
Scope: F026, F027, F028, F029, F030 (+ follow-ups F067–F083)
Verdict: **RED** — 6 FAIL (3 blocker, 3 major), 7 PASS

Method: three independent reviewers, each given only assertion text + file
lists (no handoffs, no prior scrutiny reports), each required to perform real
mutation testing (apply → run → `git checkout --`). All mutation results below
were re-confirmed with `--no-cache` after two reviewers independently hit false
"survived"/"green" readings from stale Vite transform caches.

## Assertion table

| ID | Result | Reason |
|---|---|---|
| AS-011 | FAIL (major) | `buildPlannerNavHrefs` itself is mutation-covered, but the **page call site is still only guarded by a source-text regex**. `peopleParam: peopleParam ? undefined : peopleParam` at the call site drops `?people=` on every real navigation and the whole suite stays green. F080's header comment claims the regex guard was replaced by real `<a href>` assertions; it was not — `f080-calendar-nav-hrefs.test.tsx` renders `WeekView` with **hardcoded href strings supplied by the test**, so it only proves `WeekView` copies a string prop onto an anchor. Five passes have now failed to close this. |
| AS-012 | PASS | Deleting the `if (weekParam) params.set("week", …)` block fails `f029-switcher-url-wiring.test.tsx`. Asserted on the real pushed URL string via `pushMock`, not a mock argument shape. |
| AS-013 | PASS (major) | Contract text is narrow — "no Planner view state is written to `localStorage` or `sessionStorage`" — and both a `setItem` inside `toggleMember` and one inside a mount `useEffect` are caught, by the source scan in both cases. Major fragility: the source scan is a **hardcoded list of 5 file paths**. `components/calendar/` holds 11 files; `add-block-popover.tsx`, `calendar-block-chip.tsx`, `calendar-block-popover-form.tsx`, `time-off-*.tsx` and `client-presentation-banner.tsx` are all unscanned, and any new file opts out by existing. The `vi.stubGlobal` runtime guard spies only on `setItem` during a single click and caught nothing the regex didn't. |
| AS-051 | PASS | Mutation-verified: moving `PeopleSwitcherUrlBound` into a preceding sibling `<div>` fails `test_AS_051_switcher_renders_in_the_same_header_row...`. Walks up from the real `Previous week` anchor and requires trigger + next + today inside that same `div`; a negative test (prop omitted → no trigger) guards against a vacuous selector. |
| AS-052 | FAIL (major) | The word **"active" is asserted one layer away from where it can regress.** Changing both call sites in `calendar/page.tsx` from `workspaceMembers.active.map(...)` to `[...active, ...pending].map(...)` — leaking invited members into the switcher *and* into `activeMemberIds` — **breaks no test**. `switcher-member-source.test.ts` only proves `getWorkspaceMembers` itself splits active from invited; nothing pins what the page consumes. The avatar/name half is solid (blanking the name span kills 4 tests; the `AutoLoadingImage` shim makes the real `<img>` path reachable). Carried unfixed from pass 6, where it was logged as "minor". |
| AS-053 | PASS | F082's tests are genuinely falsifiable, verified by mutation: a prefix-only `filter=` prop kills `test_AS_053_filter_matches_substring_not_just_prefix` ("ovelace" → Ada); a case-**sensitive** `includes` filter kills `test_AS_053_filter_is_case_insensitive` ("ADA LOVELACE"). Pass 6's stated gap is closed. |
| AS-054 | FAIL (blocker) | **The accumulate behaviour is now well covered; the visible selected state is not covered at all.** Deleting *both* the `<CheckIcon/>` conditional and `className={cn(isSelected && "bg-accent …")}` leaves **22/22 tests green**. The only guard is `data-checked`, a test-only attribute no user or screen reader sees. So the F081 fix can be reverted silently and the switcher returns to exactly the state pass 6 called a blocker. Worse, `aria-selected={isSelected}` is **dead code**: cmdk's `Item` spreads caller rest-props *before* its own `aria-selected`/`data-selected`, so cmdk's *highlight* state always wins — empirically confirmed (with `selectedUserIds: ["u2"]` the Grace row reports `aria-selected="false" data-checked="true"`). Multi-select state is therefore exposed to assistive tech nowhere, and the listbox has no `aria-multiselectable`. Separately, because `command.tsx` already styles `data-selected:bg-accent` for cmdk's *hover/active* item, F081's `bg-accent` selected style is visually indistinguishable from mere hover — the CheckIcon is the only real signal, and it is untested. (F083 mutation: accumulate → `onSelectionChange([userId])` **is** caught by 2 tests. That half is fixed.) |
| AS-055 | FAIL (major) | F083's fix works for what it targeted: `.slice(0, max)` → `.slice(-max)` is killed by `test_AS_055_overflow_shows_first_n_members_in_selection_order_not_last_n`. But the assertion's own clause — **"when it does not fit"** — is still never evaluated. `maxVisibleAvatars` defaults to 3 and `week-view.tsx` **never passes it**, so production is an unconditional fixed-N truncation with no width or `ResizeObserver` logic: three avatars can overflow a 375px trigger with no `+N`, and a wide trigger collapses at four. Every test that exercises the non-default path passes the prop explicitly, i.e. exercises a configuration that does not exist in the app. Also still unfixed from pass 6: `selectedMembers = members.filter(...)` drops selected ids absent from `members` from *both* the avatars and the overflow count, under-reporting the real selection. |
| AS-056 | FAIL (blocker) | **The Planner does not narrow.** `calendar/page.tsx:127` still passes `blockUserIds={workspaceMembers.active.map((m) => m.userId)}` with the comment "The real '?people=' selection lands in F013 — until then, every active member preserves today's whole-workspace behaviour." `selectedUserIds` reaches only `peopleSwitcher.selectedUserIds`, i.e. the switcher's own checkmarks and trigger avatars; `week-view.tsx` never filters `blocks` by it either. Click "Just me" and the grid is byte-identical to "Whole team". The shortcut's *selection* behaviour is well covered (self-not-first fixture kills a `members[0]` implementation), but AS-056 says "returns **the Planner**", not "the switcher". Upgraded from pass 6's INCONCLUSIVE: this is a plain fail today, deferred by design to F031/M7. |
| AS-057 | PASS (major) | `members.slice(0, -1)` is caught. Structurally true that `members` = `workspaceMembers.active`. Major: the fixture has only **2 members**, so "every active member" is a weak sample — a `slice(0,2)`-style cap would survive. Its user-visible half is vacuous for the same reason as AS-056 and must be re-verified at M7. |
| AS-059 | FAIL (blocker) | The empty→`[selfId]` coercion is genuinely doubled up and mutation-resistant at URL level (removing it fails the f029 test; `parsePeopleParam` coerces independently). But "leaves **the Planner** showing the signed-in member" is unobservable while the grid is never narrowed (AS-056). Upgraded from pass 6's INCONCLUSIVE for the same reason. |
| AS-060 | FAIL (major) | Genuinely non-vacuous — real `userEvent.tab()`/`keyboard()`, no `fireEvent`; `tabIndex={-1}` on the trigger kills both tests and `readOnly` on `CommandInput` kills the search step. But **`{ArrowDown}` is provably a no-op**: after typing "Grace", cmdk has already auto-selected the sole filtered row (`[data-selected="true"]` reads `"GHGrace Hopper"` before any key press), and *deleting `{ArrowDown}` from the test yields the identical* `onChange(["user-1","user-2"])`. Removing arrow-key navigation entirely would not be caught, so "have a member toggled using the keyboard alone" rests on Enter against a pre-highlighted row. Escape-to-close, Space-to-activate, and keyboard *de*-selection are unasserted. |
| AS-061 | PASS (major) | Real evidence, independently reproduced: `npx playwright test tests/e2e/m6-people-switcher-mobile.spec.ts` → **1 passed (9.4s)**, real Chromium at 375×812. Mutation-verified: prepending `hidden md:flex` to the trigger makes `getComputedStyle().display === "none"` at `innerWidth === 375` and `toBeVisible()` fails — while the jsdom file stays 4/4 green, confirming Playwright is the only thing covering this. Major: with `SUPABASE_SECRET_KEY` unset the spec is silent skipped-green (exit 0, `1 skipped`). Mitigated but not eliminated by the `if (process.env.CI && !haveAdminCreds) throw` guard plus `.github/workflows/ci.yml` running Playwright against an ephemeral stack — CI cannot go green while skipping, local runs can. The spec also asserts only that the *trigger* is visible; nothing checks the popover content is not clipped off-screen at 375px. No M6 evidence artifact was recorded despite pass 6 asking for one. |

## Mutation log

| # | Mutation | Target | Result |
|---|---|---|---|
| 1 | `<Command filter={prefix-only}>` | people-switcher.tsx | **CAUGHT** — AS-053 substring test |
| 2 | `<Command filter={case-sensitive includes}>` | people-switcher.tsx | **CAUGHT** — AS-053 case test |
| 3 | `toggleMember` accumulate → `onSelectionChange([userId])` | people-switcher.tsx | **CAUGHT** — 2 AS-054 tests |
| 4 | `selectedMembers.slice(0, max)` → `.slice(-max)` | people-switcher.tsx | **CAUGHT** — AS-055 first-n test |
| 5 | delete `<CheckIcon/>` **and** the `isSelected` className | people-switcher.tsx | **SURVIVED** — 22/22 green |
| 6 | remove `data-checked={isSelected}` | people-switcher.tsx | CAUGHT (attribute-presence only) |
| 7 | page: `workspaceMembers.active` → `[...active, ...pending]` (both call sites) | page.tsx | **SURVIVED** |
| 8 | blank the member-name `<span>` | people-switcher.tsx | CAUGHT — 4 tests |
| 9 | delete `if (weekParam) params.set("week", …)` | people-switcher.tsx | CAUGHT — AS-012 |
| 10 | drop the empty→`[selfId]` coercion | people-switcher.tsx | CAUGHT — AS-059 |
| 11 | "Just me" → `[members[0].userId]` | people-switcher.tsx | CAUGHT — AS-056 (self-not-first fixture) |
| 12 | "Whole team" → `members.slice(0, -1)` | people-switcher.tsx | CAUGHT — AS-057 |
| 13 | `localStorage.setItem` in `toggleMember` | people-switcher.tsx | CAUGHT (both guards) |
| 14 | `localStorage.setItem` in a mount `useEffect` | people-switcher.tsx | CAUGHT (both guards) |
| 15 | remove `peopleParam` from `buildWeekNavHref` calls | week-nav.ts | CAUGHT — 2 F075 tests |
| 16 | `peopleParam: undefined` at the page call site | page.tsx | CAUGHT (regex guard only) |
| 17 | `peopleParam: peopleParam ? undefined : peopleParam` at the page call site | page.tsx | **SURVIVED** |
| 18 | move switcher out of the nav row | week-view.tsx | CAUGHT — AS-051 |
| 19 | `tabIndex={-1}` on `PopoverTrigger` | people-switcher.tsx | CAUGHT — both AS-060 tests |
| 20 | `readOnly` on `CommandInput` | people-switcher.tsx | CAUGHT — AS-060 search step |
| 21 | delete `{ArrowDown}` from the AS-060 test | test file | **SURVIVED** (identical `onChange`) — arrow nav uncovered |
| 22 | `hidden md:flex` on the trigger | people-switcher.tsx | CAUGHT by Playwright only; jsdom 4/4 green |

Tree verified clean after all mutation work: `git status --porcelain -- app lib components tests` → empty.

## Process note

`F081-handoff.md` lists `tests/unit/people-switcher-multiselect.test.tsx` under
"Files changed", but commit `288c805a` (F081) touches only
`components/calendar/people-switcher.tsx`. The AS-054 test rewrite was swept
into `7bed2e53` (F083), committed 12 seconds earlier. No correctness impact —
both changes are present — but the handoff-to-commit mapping is wrong and the
F081 handoff's mutation-check claim describes work recorded under another
feature.

## Recommended follow-up features

**Cover the visible selected state and give it a real accessible signal (AS-054, blocker).** Deleting both the `CheckIcon` and the `bg-accent` class from the selected `CommandItem` leaves the entire suite green, so F081's fix is unprotected and can be reverted by accident. Replace the `data-checked` assertions in `people-switcher-multiselect.test.tsx` with assertions on a user-visible element — give the check mark a stable hook (an `aria-hidden` icon plus visually-hidden text, or a `data-slot="people-switcher-item-check"`) and assert it appears on exactly the selected rows and disappears on deselect, driven by clicks. In the same feature, fix the a11y hole: `aria-selected={isSelected}` on a cmdk `CommandItem` is dead code because cmdk spreads caller props before its own `aria-selected`, which it uses for keyboard highlight — the selection state must move to `aria-checked` with `role="option"`/`aria-multiselectable` on the list, or to a rendered checkbox, and a test must assert the *rendered* attribute so the override is caught. Note also that `command.tsx` already applies `bg-accent` to cmdk's hover/active item, so the selected-row background is currently indistinguishable from hover; pick a distinct treatment.

**Pin the page's member source to the active list (AS-052, major).** Changing `workspaceMembers.active.map(...)` to include invited members at both call sites in `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx` — leaking invited members into the switcher list and into `activeMemberIds` used by `parsePeopleParam` — breaks no test. Add a page- or `WeekGridSection`-level test that renders with a roster containing an invited/deactivated member and asserts that member appears neither in the switcher list nor in the ids `?people=all` resolves to. This was logged as "minor" in pass 6 and is now the oldest unfixed coverage hole in the milestone.

**Close the AS-011 page call site for real (AS-011, blocker-by-recurrence).** This has now survived five remediation attempts (F067, F071, F075, F079, F080), each of which claimed to replace the source-text regex and did not. `peopleParam: peopleParam ? undefined : peopleParam` at the call site silently drops `?people=` from every nav link with the suite green, because `f080-calendar-nav-hrefs.test.tsx` feeds `WeekView` literal href strings rather than executing the page's own href derivation. The fix is to invoke the page's real computation: extract the page's `searchParams` → `{prevHref,nextHref,todayHref}` derivation into a single exported pure function that takes the raw search params, and assert on the returned strings' parsed `people` value for several inputs — then delete the regex `describe` block. If the derivation cannot be extracted, render the actual server component with mocked data access and read the anchors' real `href` attributes.

**Make the trigger's overflow reflect fit, and count the whole selection (AS-055, major).** `maxVisibleAvatars` is a hardcoded default of 3 that `week-view.tsx` never overrides, so every test of the non-default path exercises a configuration that does not exist in production and the assertion's "when it does not fit" clause is never evaluated. Either measure available trigger width with a `ResizeObserver` and derive the visible count (then test it at a narrow and a wide width), or — if fixed-N is the accepted behaviour — append a new assertion ID recording that decision and have `week-view.tsx` pass the value explicitly so the production path is the tested path. Independently, `selectedMembers = members.filter(...)` silently omits selected ids that are not in `members` from both the avatar group and the `+N`, under-reporting the selection; derive the count from `selectedUserIds` and render an unknown-member placeholder.

**Make AS-060's keyboard coverage falsifiable (AS-060, major).** Deleting `{ArrowDown}` from `test_AS_060_switcher_can_be_opened_searched_and_toggled_with_keyboard_alone` produces the identical result, because typing "Grace" filters to one row that cmdk has already auto-highlighted — so arrow-key navigation has zero coverage. Rewrite the test to not filter to a single result: open the switcher, press ArrowDown N times, and assert the highlighted row (`[data-selected="true"]`) is the Nth in the list at each step, then Enter and assert the toggle. Add Escape-to-close (the behaviour exists and is unasserted), Space-to-activate on the trigger, and a keyboard *de*-selection round trip.

**Broaden the AS-013 storage guard from a path list to a glob (AS-013, major).** The source scan names five files by hand while `components/calendar/` contains eleven; `add-block-popover.tsx`, `calendar-block-chip.tsx`, `calendar-block-popover-form.tsx`, `time-off-day-strip.tsx`, `time-off-delete-button.tsx` and `client-presentation-banner.tsx` are unscanned, and any new Planner file opts out simply by existing. Replace the list with a glob over `components/calendar/**`, `lib/calendar/**` and the calendar route so new files are covered by default, and make the runtime guard stub both storages' full surface (`setItem`, `removeItem`, `clear`) across a complete interaction script — mount, open, type, toggle, "Just me", "Whole team", close.

**Record AS-061 evidence and harden the local skip (AS-061, major).** The Playwright spec genuinely passes and is genuinely falsifiable, but without credentials it exits 0 reporting `1 skipped`, which reads as success to a validator running locally. Add an `ALLOW_SKIP_E2E` opt-in so the absence of credentials is a hard failure by default (the existing `process.env.CI` guard only covers CI), extend the assertion past trigger visibility to confirm the popover content is within the 375px viewport, and save the passing run's trace/screenshot under `missions/20260920-124226/milestones/M6-evidence/` — pass 6 asked for this artifact and no `M6-evidence` directory exists.

**Carry AS-056/AS-057/AS-059 into F031 as mandatory M7 assertions.** `calendar/page.tsx:127` passes the full active roster to the block query and `week-view.tsx` does not filter either, so the Planner never narrows and the user-visible half of these three assertions cannot be verified at all — "Just me" and "Whole team" render identical grids. This is deferred by design (the in-file comment points at F013/F031, and `F013` has a feature file but no handoff, confirming the wiring was never done), but F031's assertion set is currently AS-001, AS-002, AS-014, AS-023 and does not mention these three. Add AS-056, AS-057 and AS-059 to F031 so the M7 validator is forced to confirm that "Just me" empties the grid of everyone else, that "Whole team" fills it with every active member, and that an empty selection still shows the viewer.

## Gate output

```
$ git status --porcelain -- app lib components tests
(empty)

$ npx tsc --noEmit
exit 0 (no output)

$ npx eslint . --max-warnings=0
exit 0 (no output)

$ npx playwright test tests/e2e/m6-people-switcher-mobile.spec.ts
exit 0
  1 passed (9.4s)

$ npx vitest run --no-cache <7 M6 unit files>
 Test Files  7 passed (7)
      Tests  88 passed (88)
   Duration  2.56s

$ npx vitest run tests/unit/     # full suite
 Test Files  41 failed | 468 passed | 1 skipped (510)
      Tests  133 failed | 3277 passed | 3 skipped (3413)
   Duration  86.89s
```

Note on the full suite: the 133 failures are unchanged from the pass-6 baseline
and lie entirely outside M6 (f003 page/section client-visibility, f006/f007/
f008/f015/f024/f025 section-card suites — a different mission's surface). No M6
file is among them. Passing totals rose 3274 → 3277, matching the three tests
F081–F083 added. A milestone gate that runs the full unit suite still cannot be
green.
