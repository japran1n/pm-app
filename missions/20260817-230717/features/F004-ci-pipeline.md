# F004: ci pipeline

**Milestone:** M1 — Foundation
**Estimated worker time:** 20 minutes
**Depends on:** F001

## Assertion IDs covered
- (none — foundation/skeleton feature)

## Draft scope
- GitHub Actions workflow: install, typecheck, lint, unit test on push/PR
- Must pass on an empty/placeholder test suite

## Files (approximate)
.github/workflows/ci.yml

## Notes for clarification
Use the exact commands from tech-decisions.md's 'How to run tests/linter/type-check' sections so this workflow and the local hook stay in sync.
- MCP at run: none
