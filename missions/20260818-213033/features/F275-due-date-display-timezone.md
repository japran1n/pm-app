# F275: format due dates in the user's timezone

**Milestone:** M10 (follow-up from M10 scrutiny)
**Estimated worker time:** 45 minutes
**Depends on:** F124
**Parent feature:** F124 (inherits its clarification)

## Assertion IDs covered
- AS-207: due-date and overdue calculations use the user's timezone, not the server's

## Why this exists
M10 scrutiny FAIL, reproduced: F124 converted the overdue *logic* but not the *displayed date*. `formatDueDate` in `components/task/task-card.tsx:64` and `components/task/task-list-table.tsx:64` calls `Intl.DateTimeFormat` with no `timeZone` option, so a task with `due_date "2026-08-20"` renders "Aug 19, 2026" under `TZ=America/New_York`. A card can therefore show yesterday's date while correctly flagging the task as not overdue. See `missions/20260818-213033/milestones/M10-scrutiny.md` § AS-207.

## Draft scope
- Replace both local `formatDueDate` copies with one shared helper in `lib/time/user-timezone.ts` that takes the timezone explicitly, so a third copy cannot appear.
- Make the `timezone` prop required across the board/list/dashboard component chain instead of defaulting to "UTC", so a page that forgets it is a type error rather than a silent UTC render.
- Add a CHECK constraint or validated-set gate on `profiles.timezone`.

## Files (approximate)
lib/time/user-timezone.ts, components/task/task-card.tsx, components/task/task-list-table.tsx, components/board/*, supabase/migrations/ (timezone constraint)

## Clarified implementation
- Inherits F124's clarification (archetype: logic). Timezone is always an explicit argument.

## Definition of done
- A test asserts the rendered due-date string for a zone west of UTC.
- A cross-layer agreement test seeds tasks and asserts `get_overdue_count(ws, tz)` equals the count of `isOverdueInTimeZone` over the same rows, for a zone on each side of UTC.
- `npm run test`, `npx tsc --noEmit`, `npx eslint .` clean.
