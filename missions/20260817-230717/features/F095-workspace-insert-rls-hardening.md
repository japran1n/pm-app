# F095: workspace insert RLS hardening

**Milestone:** M2 — Auth & Workspace (follow-up)
**Estimated worker time:** 45 minutes
**Depends on:** F013
**Parent:** F013

## Assertion IDs covered
- AS-006

## Draft scope
- scrutiny-validator found the `workspaces_insert_authenticated` RLS policy (`with check (true)`) lets any authenticated user INSERT a workspaces row directly via the Supabase API, bypassing the Server Action. Since workspace_members has no INSERT policy for `authenticated`, such a workspace can never get an owner — permanently orphaned, squats its slug.
- Also: if both the membership insert AND the compensating rollback delete fail in createWorkspace, an ownerless workspace is silently left behind (logged only).
- Fix: move workspace creation fully behind a SECURITY DEFINER Postgres function/RPC that inserts both the workspace row and the owner membership row atomically in one statement/transaction, replacing the current two-step admin-client sequence. Update createWorkspace to call the RPC instead of two separate inserts.
- Add a test that induces the rollback-failure path (or, with the RPC approach, prove atomicity directly — e.g. force a failure mid-transaction and confirm neither row persists) and assert no permanent orphan remains.

## Files (approximate)
supabase/migrations/ (new — SECURITY DEFINER function), lib/actions/workspaces.ts, tests/integration/create-workspace-owner.test.ts

## Notes for clarification
Source: M2-scrutiny.md, "follow-up-workspace-insert-rls-hardening". Severity: blocker.
