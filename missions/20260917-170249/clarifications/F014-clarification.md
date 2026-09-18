# F014 Clarification

_Generated: 2026-09-17T00:00:00Z_  _Mode: accept-and-continue — ★ defaults taken for all questions, no interactive session. The user explicitly instructed the orchestrator to proceed through the full mission autonomously._

## Round A — 10 task questions

**1. Implementation pattern**
- (a) a single exported pure function per concern in lib/webflow-converter/                    ★ recommended  ← chosen
- (b) a class with internal state
- (c) a hook-like factory function
- (d) split across multiple small modules re-exported from an index

**2. Data shape**
- (a) plain TypeScript interfaces/types matching the prototype's JS object shapes 1:1                    ★ recommended  ← chosen
- (b) a class-based model with methods
- (c) Zod-validated schemas
- (d) untyped, inferred only

**3. State / storage location**
- (a) none — the function is stateless, all state is parameters and return value                    ★ recommended  ← chosen
- (b) module-level cache
- (c) closure-captured mutable state
- (d) external store

**4. Public API surface**
- (a) export only the one function this feature is named for, keep helpers unexported                    ★ recommended  ← chosen
- (b) export every internal helper too, for maximum testability
- (c) export a single default object bundling everything
- (d) no explicit exports, side-effect only

**5. Failure / error handling**
- (a) never throw for expected-bad input — return it as a warning/error entry in the result, matching the rest of the engine                    ★ recommended  ← chosen
- (b) throw a custom error class
- (c) return null on failure
- (d) console.warn and continue silently

**6. Empty / zero state**
- (a) empty input produces an empty (not undefined/null) result of the same shape as a populated one                    ★ recommended  ← chosen
- (b) empty input throws
- (c) empty input returns a sentinel
- (d) undefined behavior, caller must guard

**7. Validation rules**
- (a) match the reference prototype's behavior exactly (already proven via 24 passing tests and a manual Webflow paste)                    ★ recommended  ← chosen
- (b) stricter than the prototype
- (c) looser than the prototype
- (d) no validation, trust input

**8. Performance budget**
- (a) not a constraint — inputs are small (a section's worth of HTML/CSS), correctness matters far more than speed                    ★ recommended  ← chosen
- (b) <50ms
- (c) <200ms
- (d) <500ms

**9. Test surface**
- (a) unit tests covering every branch named in this feature's assertion IDs, colocated as *.test.ts                    ★ recommended  ← chosen
- (b) property-based/fuzz testing
- (c) snapshot testing only
- (d) manual testing only, no automated tests

**10. Dependencies on existing code**
- (a) only this feature's new files plus the specific sibling modules named in its own "Depends on" line                    ★ recommended  ← chosen
- (b) reads from pm-app's auth/session modules
- (c) reads from Supabase query helpers
- (d) requires changes to migrations

## Round B — 5 follow-ups

**11. Port fidelity — How closely should this port follow the standalone prototype's already-tested implementation?**
- (a) byte-for-byte logic port, TypeScript types added but behavior unchanged, except where this feature's own notes call out a deliberate departure                    ★ recommended  ← chosen
- (b) a full rewrite using different algorithms
- (c) only the public signature is kept, internals redesigned
- (d) no reference to the prototype, implement from the assertion IDs alone

**12. Test provenance — Should this feature's tests be adapted from the prototype's existing test suite or written fresh?**
- (a) adapt the prototype's existing passing tests (same inputs/expected outputs), add new ones only for behavior this feature's notes say differs from the prototype                    ★ recommended  ← chosen
- (b) write entirely fresh tests without reference to the prototype
- (c) skip tests, rely on F039's later audit
- (d) copy the prototype's tests verbatim with no adaptation

**13. Naming — Should exported function/type names match the prototype's naming exactly?**
- (a) yes, keep names identical for traceability between the two codebases                    ★ recommended  ← chosen
- (b) rename to match a different pm-app convention
- (c) prefix everything with "webflow"
- (d) no naming convention enforced

**14. Module boundaries — Should this feature's code live in exactly the file named in its "Files" line, or can it be split further?**
- (a) the named file is the target; splitting further is fine if it stays under the same directory and nothing outside this feature's dependents needs to change its imports                    ★ recommended  ← chosen
- (b) must be exactly one file, no exceptions
- (c) must be split into at least 3 files regardless of size
- (d) file location is unconstrained

**15. Edge-case scope — Should this feature handle CSS/HTML edge cases beyond what the prototype's own test suite already covers?**
- (a) only what the assigned assertion IDs require — additional edge cases are out of scope for v1 unless they block an assertion                    ★ recommended  ← chosen
- (b) handle every conceivable edge case now
- (c) defer all edge cases to a future mission
- (d) no edge case work at all, happy path only

## Round B — 5 "definition of done" questions

**16. Primary success test**
- (a) a colocated unit test (vitest) on the core function, covering every branch named in this feature's assertion IDs                    ★ recommended  ← chosen
- (b) an integration test only
- (c) an end-to-end test only
- (d) all three

**17. Failure test**
- (a) a unit test on each error/warning branch this feature introduces                    ★ recommended  ← chosen
- (b) an integration test forcing failure
- (c) a chaos test
- (d) error paths tested manually only

**18. Manual verification**
- (a) follow the 2-3 step check named in this feature's own notes (or, for engine features with no UI, run the test file directly and read the output)
- (b) a full demo to the user
- (c) reading log lines only
- (d) none — automated tests suffice                    ★ recommended  ← chosen

**19. Side-effect verification**
- (a) a test or review confirms this feature touches only the files named in its own "Files" line — nothing else in the repo changes behavior                    ★ recommended  ← chosen
- (b) a snapshot test of unrelated data
- (c) no side-effect check
- (d) not applicable

**20. Evidence artifact**
- (a) test output (and, for UI features, a screenshot of the working control) attached to the handoff                    ★ recommended  ← chosen
- (b) a screenshot only
- (c) log lines only
- (d) all of the above
