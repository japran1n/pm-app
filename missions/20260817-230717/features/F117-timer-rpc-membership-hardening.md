# F117: timer rpc membership hardening

**Milestone:** M9 — Time tracking (follow-up)
**Estimated worker time:** 20 minutes
**Depends on:** F111

## Assertion IDs covered
- AS-175, AS-176 (hardening, not a fix for a failing assertion — defense-in-depth)

## Draft scope
- scrutiny-validator (M9-scrutiny.md) found start_timer_atomic/stop_timer_atomic are SECURITY DEFINER but rely entirely on the calling Server Action's requireActiveMembership pre-check for workspace scoping, rather than asserting membership inside the RPC body itself. No exploit found today (every current caller is guarded), but this makes safety contingent on every future caller routing through the guarded action — a direct RPC call (e.g. from a future feature that forgets the check) would bypass workspace isolation entirely since the function runs with elevated privileges.
- Fix: add an explicit membership assertion inside both RPC bodies (raise an exception if the calling auth.uid() is not an active member of the task's workspace), so the RPCs are safe to call directly, not just safe-by-convention.
- Add a test calling the RPCs directly (bypassing the Server Action layer) as a non-member, asserting it's rejected.

## Files (approximate)
supabase/migrations/ (new), tests/integration/

## Notes for clarification
Source: M9-scrutiny.md. Severity: low/hardening (not currently exploitable, but closes a real gap in defense-in-depth for money-adjacent data).
