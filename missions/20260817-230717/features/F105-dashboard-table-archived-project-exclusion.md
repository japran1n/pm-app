# F105: dashboard table archived project exclusion

**Milestone:** M7 — Dashboard (follow-up)
**Estimated worker time:** 20 minutes
**Depends on:** F078
**Parent:** F078

## Assertion IDs covered
- AS-129, AS-134

## Draft scope
- scrutiny-validator (M7-scrutiny.md, Finding 1) found the three dashboard RPCs (F071/F072/F075) correctly exclude archived-project tasks (`projects.deleted_at is null`), but F078's `getWorkspaceListTasks` query never checks `projects.deleted_at` — archived-project tasks leak into the dashboard table while being correctly excluded from the charts on the same page, an internally inconsistent dashboard.
- Fix: add `projects.deleted_at is null` to `getWorkspaceListTasks`'s query (join filter), matching the RPCs' exclusion rule exactly.
- Add a test: a task belonging to an archived project does NOT appear in the dashboard table, while a task in a non-archived project does — proving parity with the charts' exclusion behavior.

## Files (approximate)
lib/queries/tasks.ts (getWorkspaceListTasks), tests

## Notes for clarification
Source: M7-scrutiny.md, Finding 1. Severity: major (internally inconsistent data on the same page).
