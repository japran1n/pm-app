# F001: Install markdown and sanitization dependencies

**Milestone:** M1 — Foundation
**Estimated worker time:** 15 minutes
**Depends on:** none

## Assertion IDs covered
- AS-001 (prereq)
- AS-007 (prereq)

## Draft scope
- Add `react-markdown@^10.1.0`, `remark-gfm@^4.0.1`, `sanitize-html@^2.17.7` to package.json
- Add `@types/sanitize-html` dev dependency
- Run `npm install`, verify CI stays green (no type errors, no test failures)
- No business logic in this feature

## Files (approximate)
- `package.json`
- `package-lock.json`

## Notes for clarification
- MCP at run: none
- These are the only new runtime deps for this mission; everything else reuses existing stack
