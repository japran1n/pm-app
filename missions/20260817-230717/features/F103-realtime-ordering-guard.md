# F103: realtime ordering guard

**Milestone:** M5 — Board & drag-and-drop (follow-up)
**Estimated worker time:** 20 minutes
**Depends on:** F049
**Parent:** F049

## Assertion IDs covered
- AS-076

## Draft scope
- scrutiny-validator (M5-scrutiny.md, Finding 3, medium confidence/architectural) found reconcileTask always overwrites local state with whatever row arrives via Realtime, with no comparison against updated_at/version — two out-of-order events for the same task (plausible under reconnect/replay or rapid double-drag) could let a stale row overwrite newer local state.
- Fix: add an updated_at-based "only apply if the incoming row is newer than (or equal to, to still apply same-timestamp corrections) what's currently held locally" guard in reconcileTask.
- Add a unit test with two out-of-order events for the same task id, asserting the older one arriving second does not overwrite the newer state already applied.

## Files (approximate)
lib/board/reconcile-realtime-task.ts, tests

## Notes for clarification
Source: M5-scrutiny.md, Finding 3. Severity: medium, not confirmed reproducible in practice but cheap and correct to guard against.
