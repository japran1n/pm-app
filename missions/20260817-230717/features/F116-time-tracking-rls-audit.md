# F116: time tracking rls audit

**Milestone:** M9 — Time tracking (final feature)
**Estimated worker time:** 25 minutes
**Depends on:** F108, F109, F110, F111, F112, F113, F114, F115

## Assertion IDs covered
- AS-175, AS-176

## Draft scope
- Audit pass (same style as F079/F081): confirm RLS is enabled on both time_entries and active_timers, confirm every Server Action in lib/actions/time-entries.ts re-checks membership server-side (defense in depth, not RLS-only), confirm the two new RPCs (F114, F115) are SECURITY INVOKER not SECURITY DEFINER, and add/confirm a real cross-workspace isolation test — a non-member of a workspace cannot read or write that workspace's time entries via direct API access, even with a valid session in a different workspace.

## Files (approximate)
supabase/migrations/ (audit, fix if needed), lib/actions/time-entries.ts (audit)

## Clarified implementation
- This is the final M9 feature — after this, the milestone should be ready for a scrutiny-validator pass, same process as every prior milestone in this mission.

## Definition of done
- A passing cross-workspace isolation integration test is the primary evidence; audit findings (if any gap found and fixed) documented in the handoff.
