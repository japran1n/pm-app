# F038: accessibility pass

**Milestone:** M7 — Design & accessibility
**Estimated worker time:** 25 minutes
**Depends on:** F037

## Assertion IDs covered
- AS-123
- AS-125
- AS-126
- AS-128

## Draft scope
- Keyboard-only pass over every control (tabs, buttons, verify box).
- Every button has an accessible name.
- Run the project's existing a11y lint against the new files and fix any violations.
- Confirm no horizontal scroll at standard desktop widths.

## Files (approximate)
components/webflow-tool/*.tsx

## Notes for clarification
Run whatever a11y check the repo already has configured (eslint-plugin-jsx-a11y per an earlier mission's AS-069) rather than introducing a new tool.
- MCP at run: none




---

## Clarified implementation (from clarifications/F038-clarification.md)

- Implementation pattern: a review-and-fix pass against already-built code plus, where a gap is found, a small targeted patch — not new features
- Data shape: not applicable — this feature touches process/quality, not data
- State / storage location: not applicable
- API contract: not applicable — no new endpoint or function surface
- Failure / error handling: any gap found is fixed directly (small patch) rather than merely reported, since this is the mission's own closing quality gate
- Empty / zero state: not applicable
- Validation rules: every check in this feature's scope bullets must actually pass, not just "mostly pass"
- Performance budget: not applicable
- Auth / access control: not applicable — this is a build-time/process-time check, not a runtime access surface
- Dependencies on existing code: reviews the accumulated output of every feature in its "Depends on" line

### Follow-up decisions
- Scope boundary: note it, but only fix what is in scope; flag out-of-scope findings for a separate follow-up rather than silently expanding this feature
- Tooling: whatever the repo already runs for lint/test/build (npm run lint, npm test, npm run build) — no new tool is introduced by this mission
- Evidence format: a short pass/fail per scope bullet with command output pasted where relevant (matching this repo's existing handoff convention)
- Re-run policy: yes — this feature's checks are meant to be cheap to re-run and should be re-run as part of F041 (the final build/lint/typecheck gate) regardless
- Severity handling: no — only findings that violate a named assertion ID block completion; cosmetic findings are noted but not blocking

## Definition of done

- **Primary success test:** command output (lint/test/build) showing green, pasted into the handoff
- **Failure test:** a unit test on each error/warning branch this feature introduces
- **Manual verification:** follow the 2-3 step check named in this feature's own notes (or, for engine features with no UI, run the test file directly and read the output)
- **Side-effect verification:** a test or review confirms this feature touches only the files named in its own "Files" line — nothing else in the repo changes behavior
- **Evidence artifact:** test output (and, for UI features, a screenshot of the working control) attached to the handoff

These five answers are what the milestone validators check. A worker is not
done until each definition-of-done answer is satisfied with concrete output
linked from the handoff.
