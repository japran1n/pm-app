# F094: sole owner atomic guard

**Milestone:** M2 — Auth & Workspace (follow-up)
**Estimated worker time:** 30 minutes
**Depends on:** F020
**Parent:** F020 (inherits its clarification per task-clarification skill's follow-up rule)

## Assertion IDs covered
- AS-018

## Draft scope
- scrutiny-validator (M2-scrutiny.md) found removeMember's sole-owner guard is check-then-act (TOCTOU race): two concurrent removals against a 2-owner workspace can both pass and leave zero owners.
- Replace with an atomic mechanism: either a single conditional DELETE (`DELETE ... WHERE id=$1 AND (SELECT count(*) FROM workspace_members WHERE workspace_id=$2 AND role='owner' AND status='active') > 1`), or a DB constraint/trigger rejecting a transaction that leaves zero active owners.
- Add a concurrency test firing two simultaneous removeMember calls against a 2-owner workspace, asserting at least one survives.
- Add an explicit self-removal-by-sole-owner test (AS-018's other half, previously untested).

## Files (approximate)
lib/actions/workspaces.ts, supabase/migrations/ (new, if a DB constraint/trigger approach is chosen), tests/integration/remove-member.test.ts

## Notes for clarification
Source: missions/20260817-230717/milestones/M2-scrutiny.md, "follow-up-sole-owner-atomic-guard". Severity: blocker.
