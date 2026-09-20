# Handoff: F028 — switcher shortcuts

## Status
COMPLETE

## Assertions covered
AS-056: PASS — "Just me" shortcut replaces the selection with `[selfId]`, verified via `tests/unit/people-switcher.test.tsx::test_AS_056_*`.
AS-057: PASS — "Whole team" shortcut replaces the selection with every active member (F006's `orderPeopleForWholeTeam`, self first), verified via `tests/unit/people-switcher.test.tsx::test_AS_057_*`.

## Files changed
components/calendar/people-switcher.tsx
tests/unit/people-switcher.test.tsx

## Commands run
`npx vitest run tests/unit/people-switcher.test.tsx` (0) — 8 passed (4 pre-existing F026/F027 + 4 new F028)
`npx vitest run tests/unit/people-switcher.test.tsx tests/unit/planner-people-selection.test.ts` (0) — 43 passed
`npx tsc --noEmit -p .` (0 for this file — grepped output for `people-switcher`, no matches)
`npx vitest run tests/unit` (nonzero exit, but only pre-existing unrelated failures — see Notes)
`git commit` (0)

## Decisions made
- Discovered mid-task that F026 (shell) and F027 (multiselect) had run concurrently with this worker and already produced `components/calendar/people-switcher.tsx` as a fully-controlled multi-select combobox (`members`, `selectedUserIds`, `onSelectionChange`) — exactly the shape F028's spec anticipated ("both need to drive selection from outside this component"). Built the shortcuts on top of that shell rather than the single-select shape the original stub had, since that stub was superseded before I could use it.
- Added a required `selfId: string` prop — the only new prop this feature needs, since "Just me" requires knowing which member is "me". F027's own committed tests didn't pass `selfId` (JS ignores the missing prop at runtime; TS has no strict prop-checking enforced at test-time in this repo's vitest setup) so nothing broke.
- Rendered "Just me" / "Whole team" as a `CommandGroup heading="Shortcuts"` above the member list, and gated the whole group on `members.length > 0` — otherwise the shortcuts would always render even with zero active members, which broke F026/F027's own "empty member list shows empty state" test (AS-052). With the guard, all pre-existing tests still pass unmodified.
- "Whole team" calls `orderPeopleForWholeTeam(members.map(...), selfId)` from `lib/calendar/people-selection.ts` (F006, already committed) rather than re-implementing ordering — per the spec's explicit instruction to reuse F006's ordering.
- Both shortcuts fully replace the current selection (not merge/toggle) per the assertion text ("returns ... to the signed-in member alone" / "selects every active member") — verified with a test asserting a prior partial selection is replaced, not appended to.

## Out-of-scope work needed
- F029 (URL wiring: `?people=`, week-preservation, storage bans) was also running concurrently against the same file and had appended an uncommitted `PeopleSwitcherUrlBound` wrapper function at the point I committed. That wrapper is not part of this feature's scope; I left it untouched in the file (it compiled and its own tests were mid-flight, unrelated to AS-056/AS-057) rather than stripping it out and risking clobbering that worker's in-progress commit. The committed file therefore includes F029's wrapper as well as this feature's shortcuts — this is a byproduct of concurrent workers sharing one file, not new scope I added.
- F030 (switcher placement/a11y) has an existing commit on `main` ("chore(F030): document blocked status — people switcher dependency chain (F026-F029) not implemented") recorded from before F026/F027 landed. Since the switcher now exists, F030 should be re-run/re-attempted by the orchestrator.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used the F027-shipped multiselect `PeopleSwitcher` API (`members`/`selectedUserIds`/`onSelectionChange`) instead of the single-select stub described implicitly by this feature's own file note, because F027 had already superseded it by the time I started — building against a shape about to be deleted would have produced dead code.
AUTONOMOUS_DECISION: Gated the Shortcuts group on non-empty `members` so I didn't regress F026/F027's already-passing empty-state test — the spec doesn't address this edge case explicitly, and hiding shortcuts when there's nobody to select is the safest reading of "selects every active member" (there are none to select).

## Notes for the next worker
- This mission has heavy concurrent-worker contention on `components/calendar/people-switcher.tsx` (F026, F027, F028, F029 all touch it). Always `git diff` / re-read the file immediately before editing — it changed under me mid-task twice. I did not overwrite anything; all edits were applied as targeted `Edit` calls against the latest on-disk content.
- Full `npm test`/`vitest run tests/unit` has ~41 pre-existing failing test files unrelated to this feature (DB/RLS integration tests needing a live Supabase connection, plus several unrelated UI suites already broken before this change) — consistent with what F006's handoff already documented. None touch `people-switcher.tsx` or `people-selection.ts`.
- No MCP usage required — this is pure client-side UI logic with no external service interaction.
