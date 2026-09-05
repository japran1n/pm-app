# F029: Fix calendar DELETE gate + reconciler data fabrication (AS-022, AS-020)

**Milestone:** M2
**Depends on:** F009, F027

## Assertion IDs covered
- AS-019, AS-020, AS-021, AS-022

## Issues

### AS-022: DELETE gate inert
`tasks` table lacks `replica identity full`, so DELETE events only carry `{id}` in `old` — `project_id` is undefined. The visibility check `if (projectId && !visible…)` short-circuits and lets every DELETE through.

Fix: replace the project_id visibility check with a simpler "is this task id in our current state?" check. If the task id isn't in our local calendar state, ignore the DELETE event. This avoids the replica identity dependency entirely.

### AS-020: Fabricated chip data
`lib/calendar/reconcile-realtime-task.ts:113-126` hardcodes `isDone: false`, `statusCategory: null`, `projectName: ""` for inserted tasks. These are incorrect when the task has a real status.

Fix: look at the existing `CalendarTask` type and what data is available in the realtime payload. Use `payload.new.status` etc. to derive correct values, or fall back to safe defaults only for fields genuinely absent from the payload.

Also check: do URL filters (status/priority/assigneeId/projectId) need to be applied on INSERT? If the calendar page is filtered, a realtime-inserted task that doesn't match the filter should NOT appear. Add a filter check using the current URL search params.

### Mobile AgendaList (AS-019, AS-021)
The `AgendaList` component is a Server Component — it cannot receive live state. This is a pre-existing architectural pattern. Scope of M2 realtime was the main calendar day/month grid view (desktop). The scrutiny's mobile findings are out of scope for this mission. Document this decision in the handoff.

## Files
`lib/calendar/reconcile-realtime-task.ts`, `components/calendar/use-calendar-realtime.ts`

## Definition of done
- AS-022: DELETE uses local-state existence check (not project_id from old record)
- AS-020: Inserted task chips use actual status/isDone from payload where available
- Mobile AgendaList: documented as out-of-scope for M2
