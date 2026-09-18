# F009: longhand transition

**Milestone:** M2 — Conversion engine: CSS
**Estimated worker time:** 30 minutes
**Depends on:** F005

## Assertion IDs covered
- AS-063
- AS-064

## Draft scope
- Port transition expansion, including the comma-separated multi-item case where property/duration/timing-function/delay must stay aligned by position across items.

## Files (approximate)
lib/webflow-converter/longhand.ts, lib/webflow-converter/longhand.test.ts

## Notes for clarification
This is the trickiest expander — port the prototype's expandTransition() exactly, including its test case with two items and an explicit delay on the second.
- MCP at run: none




---

## Clarified implementation (from clarifications/F009-clarification.md)

- Implementation pattern: a single exported pure function per concern in lib/webflow-converter/
- Data shape: plain TypeScript interfaces/types matching the prototype's JS object shapes 1:1
- State / storage location: none — the function is stateless, all state is parameters and return value
- Public API surface: export only the one function this feature is named for, keep helpers unexported
- Failure / error handling: never throw for expected-bad input — return it as a warning/error entry in the result, matching the rest of the engine
- Empty / zero state: empty input produces an empty (not undefined/null) result of the same shape as a populated one
- Validation rules: match the reference prototype's behavior exactly (already proven via 24 passing tests and a manual Webflow paste)
- Performance budget: not a constraint — inputs are small (a section's worth of HTML/CSS), correctness matters far more than speed
- Test surface: unit tests covering every branch named in this feature's assertion IDs, colocated as *.test.ts
- Dependencies on existing code: only this feature's new files plus the specific sibling modules named in its own "Depends on" line

### Follow-up decisions
- Port fidelity: byte-for-byte logic port, TypeScript types added but behavior unchanged, except where this feature's own notes call out a deliberate departure
- Test provenance: adapt the prototype's existing passing tests (same inputs/expected outputs), add new ones only for behavior this feature's notes say differs from the prototype
- Naming: yes, keep names identical for traceability between the two codebases
- Module boundaries: the named file is the target; splitting further is fine if it stays under the same directory and nothing outside this feature's dependents needs to change its imports
- Edge-case scope: only what the assigned assertion IDs require — additional edge cases are out of scope for v1 unless they block an assertion

## Definition of done

- **Primary success test:** a colocated unit test (vitest) on the core function, covering every branch named in this feature's assertion IDs
- **Failure test:** a unit test on each error/warning branch this feature introduces
- **Manual verification:** none — automated tests suffice
- **Side-effect verification:** a test or review confirms this feature touches only the files named in its own "Files" line — nothing else in the repo changes behavior
- **Evidence artifact:** test output (and, for UI features, a screenshot of the working control) attached to the handoff

These five answers are what the milestone validators check. A worker is not
done until each definition-of-done answer is satisfied with concrete output
linked from the handoff.
