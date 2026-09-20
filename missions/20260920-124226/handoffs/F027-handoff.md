# Handoff: F027 — switcher multiselect

## Status
COMPLETE

## Assertions covered
AS-054: PASS — toggling a member's row in the switcher adds/removes only that member from `selectedUserIds`, leaving the rest of the selection untouched (several members selected at once). Verified via `tests/unit/people-switcher-multiselect.test.tsx::test_AS_054_*`.
AS-055: PASS — the closed trigger renders an `AvatarGroup` with one avatar per selected member up to `maxVisibleAvatars`, and an `AvatarGroupCount` "+N" element for the exact remainder once the selection doesn't fit. Verified via `tests/unit/people-switcher-multiselect.test.tsx::test_AS_055_*`.

## Files changed
components/calendar/people-switcher.tsx
tests/unit/people-switcher-multiselect.test.tsx

## Commands run
`npx vitest run tests/unit/people-switcher-multiselect.test.tsx` (0) — 7 passed
`npx vitest run tests/unit/people-switcher-multiselect.test.tsx tests/unit/people-switcher.test.tsx tests/unit/f029-switcher-url-wiring.test.tsx` (0) — 24 passed
`npx vitest run tests/unit` (0 for run; 41 failed test files / 133 failed tests, all pre-existing and unrelated to `people-switcher.tsx` or `people-selection.ts` — matches the pre-existing failure count documented in F028's and F050's handoffs; none reference `people-switcher`)
`npx tsc --noEmit -p .` (0 matches for `people-switcher`)
`npx eslint components/calendar/people-switcher.tsx tests/unit/people-switcher-multiselect.test.tsx` (0)
`git commit` (0)

## Decisions made
- `components/calendar/people-switcher.tsx` did not exist and F026 (shell: combobox listing active members, type-to-filter) had not been implemented when this worker started, despite F027 depending on it. AUTONOMOUS_DECISION: built the full shell (Popover + cmdk `Command` list, avatar + name per member, `CommandInput` type-to-filter) alongside this feature's own multi-select toggle behaviour and closed-trigger avatar group, since AS-054/AS-055 are unreachable without a shell. cmdk (`components/ui/command.tsx`) is the repo's existing combobox primitive per F026's own clarification note, so no new dependency was introduced.
- Selection is fully controlled by the caller: `members`, `selectedUserIds`, `onSelectionChange`. No internal selection state. This was a deliberate seam for F028 ("just me"/"whole team" shortcuts) and F029 (URL wiring), both of which need to drive selection from outside the component — confirmed correct by later concurrent commits (`1ab50a12` F028, `43b6201d` F029) building directly on this contract without needing to change it.
- Overflow: `maxVisibleAvatars` (default 3) caps the closed trigger's `AvatarGroup`; anything beyond that collapses into a single `AvatarGroupCount` showing the exact remaining count (not a rounded/capped value), using the existing `AvatarGroup`/`AvatarGroupCount` primitives from `components/ui/avatar.tsx` rather than inventing new overflow UI.
- This mission runs with heavy concurrent-worker contention on this exact file — F026, F028, and F029 workers were all editing/committing `components/calendar/people-switcher.tsx` in the same window as this worker. Confirmed via `git log` that by the time this worker went to commit, `components/calendar/people-switcher.tsx` was already captured (clean, matching this worker's own on-disk edits including the `AvatarGroup` `size`-prop typecheck fix) inside the F029 commit (`43b6201d`), and F026's handoff explicitly documents this worker's shell as the dependency it tested against. No separate product-code commit was needed from this worker; this handoff and its test file are what was still outstanding for F027's own assertions.
- Fixed a `tsc --noEmit` failure on `<AvatarGroup ... size="sm">` (F026's handoff flagged this as this feature's bug to fix) by dropping the unsupported `size` prop from the `AvatarGroup` call — `AvatarGroup` doesn't accept a `size` prop; per-avatar `size="sm"` on each `Avatar` already produces the correct visual size.

## Out-of-scope work needed
None beyond what F026/F028/F029/F030's own specs already own. F030 (placement/a11y) still needs to place the switcher in the Planner header row alongside week controls and verify keyboard/mobile operability — out of this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Built the F026 shell (list of active members, avatar + name, cmdk type-to-filter) as part of this feature's work because it did not exist yet and AS-054/AS-055 have no host component without it. Kept the shell minimal and exactly matching F026's own spec so the concurrent/later F026 worker could verify it against AS-052/AS-053 without rework (confirmed: F026's handoff did exactly this, writing tests against the shipped shell rather than rebuilding it).
AUTONOMOUS_DECISION: Chose `maxVisibleAvatars = 3` as the default overflow threshold — the spec/clarification set no explicit number, only "an overflow count when it does not fit." Three matches this repo's other avatar-group usages' typical density and leaves room for the overflow badge itself without crowding the trigger.

## Notes for the next worker
- `components/calendar/people-switcher.tsx` and `tests/unit/people-switcher.test.tsx` are shared across F026/F027/F028/F029(/F030 next). Always re-read the file immediately before editing — it changed multiple times mid-session under concurrent workers in this run.
- This feature's own dedicated multi-select/overflow tests live in `tests/unit/people-switcher-multiselect.test.tsx` (kept separate from the shared `tests/unit/people-switcher.test.tsx` file used by F026/F028, to avoid merge contention on that file while multiple workers were appending `describe` blocks to it concurrently).
- No MCP usage required — pure client-side UI/state logic, no external service interaction.
