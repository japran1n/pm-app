# Handoff: F117 — timer rpc membership hardening

## Status
COMPLETE

## Assertions covered
AS-175: PASS — RLS/gating on time_entries and active_timers now additionally backed by an explicit in-RPC membership check in start_timer_atomic/stop_timer_atomic, verified by tests/integration/timer-rpc-membership-hardening.test.ts
AS-176: PASS — non-member calling start_timer_atomic or stop_timer_atomic directly via supabase.rpc(...) (bypassing lib/actions/time-entries.ts entirely) is rejected with no row written; verified by tests/integration/timer-rpc-membership-hardening.test.ts

## Files changed
supabase/migrations/20260818181000_harden_timer_rpc_membership.sql
tests/integration/timer-rpc-membership-hardening.test.ts

## Commands run
`supabase db push` (0)
`npx vitest run tests/integration/timer-rpc-membership-hardening.test.ts tests/integration/start-stop-timer.test.ts` (0)
`npx vitest run` (0) — 96 test files, 504 tests, all passed
`npx eslint .` (0) — 0 errors, 1 pre-existing warning (lib/queries/search.ts:159, unrelated)
`npx tsc --noEmit` (0)
`npm run build` (0)

## Decisions made
- Used `CREATE OR REPLACE FUNCTION` on both existing functions (same signatures/return types) rather than new functions, per the spec, so no caller-side changes were needed.
- Reused `public.is_task_workspace_member(target_task_id uuid)` (defined in 20260818040214_create_comments.sql) rather than duplicating the join logic — it already checks `wm.user_id = auth.uid()` and `wm.status = 'active'`, matching exactly what the spec asked for.
- `start_timer_atomic(p_task_id)`: the membership check runs as the very first statement in the body, before any SELECT/INSERT/DELETE.
- `stop_timer_atomic()`: has no task_id argument (it operates on the caller's own active timer found via `auth.uid()`). The membership check is performed against `v_active.task_id` immediately after the active-timer row is found (so we know which task/workspace to check) and before any write. If the caller has no active timer, the function still returns its pre-existing "no active timer" empty result — there's nothing to authorize against, and that path was never the vulnerability.
- Added a new test file rather than editing tests/integration/start-stop-timer.test.ts, since the spec is "call the RPCs directly bypassing the Server Action" — a distinct scenario from the existing action-level tests, and worker-file scope rules say don't touch files outside the feature's stated scope unless necessary. Re-ran the existing F111 test file alongside the new one to confirm the hardening doesn't break any legitimate (member) flow through the Server Actions.
- The new test seeds an active_timers row directly via the admin client (bypassing start_timer_atomic) before testing stop_timer_atomic's rejection, so stop's own membership check is proven in isolation rather than only ever being reachable after start's check already passed.

## Out-of-scope work needed
None identified. This closes the only gap M9-scrutiny flagged for M9 (F108–F117).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
None — the spec's fix approach (explicit membership assertion via is_task_workspace_member, RAISE EXCEPTION before any other work, direct-RPC-bypass test) was unambiguous and followed as written.

## Notes for the next worker
- Milestone 9 (F108–F117) is now fully complete and hardened: all 16 scrutiny assertions (AS-161–AS-176) passed at the M9-scrutiny pass, and the one hardening gap that pass flagged (defense-in-depth-only RPC authorization on start_timer_atomic/stop_timer_atomic) is now closed with an explicit in-RPC membership check plus a direct-RPC-bypass regression test. No further follow-up work is outstanding for M9.
- Error message text raised by both functions is `'not an active member of this task''s workspace'` — if any future caller wants to distinguish this failure mode from a generic FK/not-found error, match on that substring (case-insensitively) as the new test does.
- No MCP tools were used for this feature; the Supabase CLI (`supabase db push`) applied the migration to the linked project directly, per mcp-registry.md's stated preference (CLI primary path, MCP optional for introspection only).
