# F043: dnd kit setup

**Milestone:** M5 — Board & drag-and-drop
**Estimated worker time:** 30 minutes
**Depends on:** F042

## Assertion IDs covered
- (none — foundation/skeleton feature)

## Draft scope
- @dnd-kit/core + sortable wired with pointer + keyboard sensors, DragOverlay for the dragged card

## Files (approximate)
components/board/*

## Notes for clarification
Keyboard sensor is required, not optional — it's what AS-151 depends on for the board specifically.
- MCP at run: none


## Clarified implementation

_Appended by /mission-tasks — accept-and-continue mode, ★ defaults._

- **Pattern:** single script/config change per feature, no unnecessary abstraction.
- **Failure handling:** if a setup command fails, Status = BLOCKED with the exact command and error text in Blockers.
- **Success proof:** the exact command from tech-decisions.md's relevant "How to run ..." section exits 0.
- **Scope:** builds only on this feature's own new files/config plus the prior M1 feature's output — no forward dependencies on later milestones.

## Definition of done

- **Primary success test:** appropriate to feature type — unit test for pure logic (migrations/utilities), integration test for Server Actions touching Supabase, end-to-end (Playwright) only for interaction-heavy assertions (e.g. F090's board reorder).
- **Failure test:** the negative case is asserted explicitly within the same test suite as the happy path (e.g. non-member calling an action, invalid input, cross-workspace access attempt).
- **Manual verification:** none beyond the automated test — per discovery Q26 (critical paths only), the validation contract itself is the sign-off criterion for a solo MVP.
- **Side effects:** where the feature touches workspace-scoped data, the test asserts no other workspace's rows are mutated or returned.
- **Evidence artifact:** test output (pass) referencing the assertion ID by name is the non-negotiable minimum; a screenshot/log line is added where it adds real signal (e.g. Playwright trace for F090).
