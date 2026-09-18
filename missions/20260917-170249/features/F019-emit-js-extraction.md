# F019: emit js extraction

**Milestone:** M3 — Conversion engine: HTML
**Estimated worker time:** 25 minutes
**Depends on:** F018

## Assertion IDs covered
- AS-101
- AS-102
- AS-103
- AS-104
- AS-105
- AS-107
- AS-108
- AS-109
- AS-110
- AS-134

## Draft scope
- Extract all <script> content (inline bodies and external src tags) into a single ordered custom-code string, completely separate from the node payload.
- No GSAP plugin detection, no CDN auto-injection — this is a deliberate simplification from the prototype (which auto-added CDN tags); v1 does pure passthrough only.
- No linting/validation of the JS — pass through exactly as written.
- No script content anywhere → no custom-code output at all (not an empty string that gets shown).

## Files (approximate)
lib/webflow-converter/convert.ts, lib/webflow-converter/convert.test.ts

## Notes for clarification
This deliberately does LESS than the prototype's src/convert.mjs (which auto-injected GSAP CDN tags) — strip that logic out, keep only the extraction and ordering.
- MCP at run: none




---

## Clarified implementation (from clarifications/F019-clarification.md)

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
