# Handoff: F026 — people switcher shell

## Status
COMPLETE

## Assertions covered
AS-052: PASS — `PeopleSwitcher` (components/calendar/people-switcher.tsx) lists every entry of the `members` prop (F014's active-member shape) inside its popover with avatar (image or initials fallback) + display name. Test: `test_AS_052_lists_active_members_with_avatar_and_name` (plus `test_AS_052_empty_member_list_shows_empty_state`).
AS-053: PASS — cmdk's built-in filtering (via `CommandInput`) narrows the rendered `CommandItem` rows as the query changes; non-matching members disappear and the empty state appears for a query matching nobody. Tests: `test_AS_053_typing_narrows_the_listed_members`, `test_AS_053_typing_a_query_matching_nobody_shows_the_empty_state`.

## Files changed
tests/unit/people-switcher.test.tsx

## Commands run
`npx vitest run tests/unit/people-switcher.test.tsx -t "AS_052|AS_053"` (0, 4 passed / 4 skipped — the skipped ones are F028's own shortcut tests, not this feature's)
`npx vitest run tests/unit/people-switcher.test.tsx` (1 — see Decisions made: one F028-authored test in this shared file fails for a reason unrelated to AS-052/AS-053; not this feature's scope)
`npx tsc --noEmit` (1 — pre-existing `AvatarGroup` prop-typing error in the shared component file at line 154, introduced by a concurrent F027 worker; unrelated to AS-052/AS-053 and outside this feature's file-ownership)
`npx eslint components/calendar/people-switcher.tsx tests/unit/people-switcher.test.tsx --max-warnings=0` (0)

## Decisions made
- `components/calendar/people-switcher.tsx` did not exist when this worker started. A concurrent F027 worker (multiselect, depends on F026) had already built the full shell (list + avatar + name + cmdk type-to-filter) as part of implementing its own AS-054/AS-055, since F027 could not proceed without a shell existing. Rather than duplicate or revert that work, this worker verified the shipped shell satisfies AS-052/AS-053's assertion text exactly and wrote tests against it, matching the actual component API (`members`/`selectedUserIds`/`onSelectionChange`, later `selfId` added by a further concurrent F028 worker for the "Just me"/"Whole team" shortcuts).
- `tests/unit/people-switcher.test.tsx` is a shared file: while this worker was writing/running AS-052/AS-053 tests, a concurrent F028 worker appended its own `describe("PeopleSwitcher shortcuts (F028)")` block (AS-056/AS-057) below mine, and added the required `selfId` prop to the component, which required back-filling `selfId` into this worker's 4 test calls (patched via a small script, verified `AS_052`/`AS_053` still pass with `selfId` present).
- Did not touch `components/calendar/people-switcher.tsx` itself — per CLAUDE.md's "don't silently expand scope" rule and to avoid stepping on the concurrent F027/F028 workers actively editing that file. AS-052/AS-053 are already satisfied by what's on disk; no product-code change was needed for this feature.

## Out-of-scope work needed
- `components/calendar/people-switcher.tsx` line ~154: `<AvatarGroup data-slot="people-switcher-avatar-group" size="sm">` fails `tsc --noEmit` (`Property 'size' does not exist` on `AvatarGroup`'s prop type). This is F027's code (avatar-group overflow display, AS-055), not F026's — flagging for whichever worker owns that file next (F027 or a fixup feature) to either add a `size` prop to `AvatarGroup` in components/ui/avatar.tsx or drop the prop from this call site.
- `tests/unit/people-switcher.test.tsx` test `test_AS_057_whole_team_shortcut_replaces_any_prior_partial_selection` (F028's own test, in the shared file) fails: `openSwitcher()` looks up a button named "Select people", but that test pre-selects `["user-1"]`, so the trigger's accessible name is `"1 people selected"` instead — a bug in that F028 test's helper usage, not in AS-052/AS-053 or this feature's code. Flagging for F028's owner to fix (e.g. make `openSwitcher` accept an expected name, or use a stable `data-slot` selector instead of accessible name).

## Blockers
(none — Status is COMPLETE; AS-052 and AS-053 both pass. The two items above are other features' bugs, not blockers to this feature's own definition of done.)

## Autonomous decisions
AUTONOMOUS_DECISION: Wrote tests against the component as already implemented by the concurrent F027 worker rather than building a competing/duplicate shell, since the file did not exist at the start of this run and by the time this worker acted, F027 (and later F028) had already delivered a shell satisfying AS-052/AS-053's assertion text. This avoided a merge conflict / wasted rework and kept the mission's single source of truth for this component intact.

## Notes for the next worker
- `components/calendar/people-switcher.tsx` is being actively developed across F026/F027/F028 (and likely F029 next, per its header comment referencing URL wiring). Re-read the file fresh before editing — it has changed multiple times mid-run in this session.
- `tests/unit/people-switcher.test.tsx` is similarly shared; this worker's AS-052/AS-053 block is `describe("PeopleSwitcher", ...)` at the top of the file — leave it in place when adding further `describe` blocks below.
- cmdk's `CommandEmpty` can take a tick to appear in jsdom (uses a `MutationObserver`-driven visibility check internally) — use `waitFor` with a generous timeout (this worker used 3000ms) rather than a synchronous assertion.
