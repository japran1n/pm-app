# Handoff: F012 — record DB fix in repo

## Status
COMPLETE

## Assertions covered
(No assertion IDs assigned to F012 in validation-contract.md — this is an infrastructure/DB-hygiene fix, not a behavioural feature. No new assertions were introduced.)

## Files changed
lib/actions/architecture.ts
lib/supabase/database.types.ts
supabase/migrations/20261126030000_drop_ambiguous_cascade_delete_task_overload.sql

## Commands run
`npx tsc --noEmit` (0)
`npx eslint lib/actions/architecture.ts lib/supabase/database.types.ts` (0)
`npx vitest run tests/unit/f041-viewer-guard.test.ts tests/unit/f017-delete-section.test.tsx tests/integration/f004b-scrutiny-remediation-portal-revalidate.test.ts tests/unit/f040-writer-only.test.ts tests/unit/f018-delete-page.test.tsx` (0 — 24/24 passing)

## Decisions made
- Migration timestamp `20261126030000` — one minute after the latest existing migration file (`20261125010000_status_set_v2.sql`), and after the live DB version the orchestrator reported (20261126020000), matching the orchestrator's already-applied `drop function if exists public.cascade_delete_task(uuid);` (migration name on the live DB: `drop_ambiguous_cascade_delete_task_overload`). Named the file identically so `supabase migration list` reconciles it against the live history.
- `database.types.ts`'s `cascade_delete_task` entry was a union of the two overloads (`{ p_task_id }` | `{ p_task_id, p_deleted_by? }`). Since the single-arg overload no longer exists live, collapsed it to the single remaining two-arg-with-default signature, matching how `lifecycle.ts`'s `deleteTask` already calls it.
- Passed `p_deleted_by: user.id` in `deletePage` and `deleteSection`'s `cascade_delete_task` RPC calls (previously only `p_task_id`), matching the convention `lifecycle.ts`'s `deleteTask` already uses, so trash/restore views can show who deleted a page or section without a second write. `user` is already in scope at both call sites (used earlier in each function via `requireActiveMembership(admin, workspaceId, user.id)`), so no new auth lookup was needed.
- Did not touch `cascade_delete_task`'s SQL body itself (out of scope — the orchestrator's live DB change was purely dropping the ambiguous overload; the two-arg function's behavior, including its own `p_deleted_by` stamping logic from `20260822210000_cascade_delete_task_deleted_by.sql`, is unchanged).

## Out-of-scope work needed
None identified beyond what F012's spec already covered.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none beyond the migration-timestamp/type-collapse choices already explained under Decisions made, which followed the spec directly)

## Notes for the next worker
- No MCP tools were used in this feature — the orchestrator had already applied the live DB change before dispatching this worker; this feature only had to add the matching migration file and type/code updates to the repo (`lib/supabase/database.types.ts`, `lib/actions/architecture.ts`, `supabase/migrations/`). If a future worker needs to re-verify the live schema matches (e.g. confirm only the two-arg `cascade_delete_task` overload exists), use the Supabase MCP's schema-introspection tool per `mcp-registry.md`.
- Ran the targeted delete-page/delete-section/permission-guard test files (found via `grep -rl "deletePage\|deleteSection"`) rather than the full suite, per F006's handoff note that the full `vitest run` has ~100 pre-existing unrelated failing test files (`cookies() called outside a request scope`) predating this feature; none of those relate to architecture.ts or cascade_delete_task.
