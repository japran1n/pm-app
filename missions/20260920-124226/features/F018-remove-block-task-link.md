# F018: remove block task link

**Milestone:** M4 — Tasks out
**Estimated worker time:** 30 minutes
**Depends on:** F009

## Assertion IDs covered
- AS-037: The calendar block form offers no way to link a block to a task.

## Draft scope
- Remove the task picker from the block form.
- Remove task_id from the Server Action and its Zod schema.
- Remove taskId from the CalendarBlock type and its row mapper.

## Files (approximate)
- `components/calendar/calendar-block-popover-form.tsx`
- `lib/actions/calendar-blocks.ts`
- `lib/validation/calendar-blocks.ts`
- `lib/queries/calendar-blocks.ts`

## Notes for clarification
Must land together with F009 or the types and the schema disagree.
