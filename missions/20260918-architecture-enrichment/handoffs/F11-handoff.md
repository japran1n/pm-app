# Handoff: F11 — Static import isolation for architecture-details

## Status
COMPLETE

## Assertions covered
No F11 feature spec file or validation-contract.md exists in this mission directory for F11; this task was assigned directly via the orchestrator's mission instructions rather than through a numbered feature spec/assertion. The two tests below implement the described security check (three-layer protection layer 2):
AS-N/A (no assigned ID found): PASS — test_AS_no_portal_file_imports_architecture_details verifies no file under app/(portal) or components/architecture/client-* imports lib/queries/architecture-details.ts
AS-N/A (no assigned ID found): PASS — test_AS_no_client_board_imports_architecture_details verifies no client-* file anywhere under components/architecture references architecture-details

## Files changed
tests/unit/f011-import-isolation.test.ts

## Commands run
`npx vitest run tests/unit/f011-import-isolation.test.ts` (0)

## Decisions made
- Fixed a bug in the provided test template: the original grep command interpolated directory paths unquoted (e.g. `app/(portal)`), which broke the shell due to unescaped parentheses. grep exited with an error, which the try/catch silently treated as "zero matches" — a false pass that would never actually detect a violation. Fixed by single-quoting each directory path before interpolating into the shell command.
- Verified the fix is not another false pass by temporarily creating a dummy file `components/architecture/client-tmp-violation.tsx` containing the string "architecture-details", confirming the test correctly failed and listed the violating file, then removing the dummy file before committing.

## Out-of-scope work needed
- No F11 feature spec file (`features/F11-*.md`) or `validation-contract.md` exists in `missions/20260918-architecture-enrichment/`. If this mission intends F11 to map to a formal assertion ID, the orchestrator should add one during a future planning pass so this test can be tied to AS-NNN like other features in this mission.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Fixed the unquoted-path bug in the grep command from the task's provided test template rather than committing the test as-given, because the as-given version would silently pass regardless of actual violations due to the shell syntax error being swallowed by the catch block. This is necessary for the test to provide real security-check value.

## Notes for the next worker
- The grep-based check only catches static string-literal imports of "architecture-details" (via require/import paths). It will not catch dynamic imports built from concatenated strings or re-exports through an intermediary barrel file that itself imports architecture-details.ts and is then imported by a portal/client file. If layer-1 (server-only guard on the query file itself) and layer-3 (runtime/action-level check) exist elsewhere in this mission, this test is layer 2 only, as instructed.
- Confirmed via manual injection test (see Decisions made) that the test correctly detects a real violation before committing.
