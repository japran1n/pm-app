# F001: record baseline

**Milestone:** M0 — Baseline
**Estimated worker time:** 15 minutes
**Depends on:** none

## Assertion IDs covered
- (none — baseline evidence only)

## Draft scope
- Run tsc, eslint, vitest unit, migrations:check at current HEAD and record each exit code.
- Record the current migration count and the HEAD sha.
- Append the result to missions/<id>/run-log.md.

## Files (approximate)
- `missions/<id>/run-log.md`

## Notes for clarification
No code changes. Evidence only, so a later failure can be attributed.
