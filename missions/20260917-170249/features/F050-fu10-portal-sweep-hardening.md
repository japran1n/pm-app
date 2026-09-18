# F050: portal sweep hardening (minor)

**Milestone:** M1 follow-ups
**Estimated worker time:** 15 minutes
**Depends on:** F045

## Assertion IDs covered
- AS-008

## Clarified implementation
(Inherited from F045)

## Follow-up scope (from M1-scrutiny-2.md — FU-10)
Replace `join("tools","webflow")` with the literal `"tools/webflow"` in both
halves of `tests/unit/f004-webflow-tool-portal-isolation.test.ts` to avoid
Windows path separator ambiguity. Minor hardening — non-blocking on Linux/macOS CI.

## Definition of done
- **Primary success test:** literal string replacement, test still passes
- **Failure test:** existing mutations still caught
- **Manual verification:** none
- **Side-effect verification:** only test file changes
- **Evidence artifact:** test output in handoff
