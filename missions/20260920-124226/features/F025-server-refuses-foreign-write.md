# F025: server refuses foreign write

**Milestone:** M5 — Read-only
**Estimated worker time:** 15 minutes
**Depends on:** F011

## Assertion IDs covered
- AS-050: A write aimed at another member's block is rejected by the server even when issued directly, bypassing the interface.

## Draft scope
- Test that a write aimed at another member's block is refused server-side, bypassing the UI.

## Files (approximate)
- `tests/integration/planner-block-rls.test.ts`

## Notes for clarification
The UI gating in F021-F024 is convenience; this is the actual boundary.
