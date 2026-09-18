# F018: emit node tree assembly

**Milestone:** M3 — Conversion engine: HTML
**Estimated worker time:** 40 minutes
**Depends on:** F011, F014, F015, F016, F017

## Assertion IDs covered
- AS-089
- AS-090
- AS-091
- AS-092
- AS-093
- AS-094
- AS-047: an element with an inline style="" attribute produces a warning recommending a class be used instead, during the same node walk
- AS-042
- AS-043
- AS-044
- AS-045
- AS-051

## Draft scope
- Port emit(): walks the parsed HTML tree, builds Webflow nodes, wires class references, root-node ordering.
- script/style elements produce no node of their own (AS-089).
- data-* attributes carry through as xattr with exact name/value; class/style/href/src/alt/id/target are never duplicated into xattr (AS-093).
- Non-class-selector and non-referenced-class warnings from F012/F014 must surface here in the aggregated warnings list, since this is where HTML meets the CSS model.

## Files (approximate)
lib/webflow-converter/emit.ts, lib/webflow-converter/emit.test.ts

## Notes for clarification
Port of emit.mjs, adapted to call the new typemap.ts (F015-F017) and css.ts (F012-F014) modules. This is the largest single feature — if it runs long, it is acceptable to split node-walk from class-id-wiring into two commits within the same feature.
- MCP at run: none




---

## Clarified implementation (from clarifications/F018-clarification.md)

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
