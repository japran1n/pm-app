# F014: css parse orchestration

**Milestone:** M2 — Conversion engine: CSS
**Estimated worker time:** 40 minutes
**Depends on:** F005, F006, F007, F008, F009, F010, F012, F013

## Assertion IDs covered
- AS-046
- AS-049
- AS-050
- AS-051
- AS-052
- AS-075
- AS-076

## Draft scope
- Port parseCss(): walks postcss AST, dispatches @media/@supports/@layer/@keyframes/@font-face, builds the class → {base, variants, comboOf} model.
- Combo-class detection: ".a.b" registers b with comboOf "a".
- !important: strip the flag, keep the declaration, add a warning (AS-046) — note this differs slightly from the prototype, which only warned; confirm the declaration is still applied.
- background-image passthrough: do NOT touch it — no special-casing (AS-075), only <img> elements get the "empty" treatment (that's F017, HTML side, not here).
- Unused-class warning (styled but never referenced in HTML) needs the HTML class-usage set — this feature returns per-class "used" tracking hooks that F018 (emit) fills in; keep the warning text accurate either way.

## Files (approximate)
lib/webflow-converter/css.ts, lib/webflow-converter/css.test.ts

## Notes for clarification
Port of parseCss() from the prototype, using postcss@8.5.28 (already present in pm-app's node_modules as a Tailwind 4 transitive dependency — add it as an explicit devDependency so it cannot silently disappear if Tailwind's internals change).
- MCP at run: none




---

## Clarified implementation (from clarifications/F014-clarification.md)

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
