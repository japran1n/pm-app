# Validation Contract — Mission 20260830-223927

_Locked on approval. New assertions may be appended; existing IDs never edited or deleted._

---

## Optimistic UI — List view cells

AS-001: Changing a task's priority in the list view updates the priority cell immediately without waiting for a server response.
AS-002: If the server rejects a priority change, the priority cell reverts to its prior value and an error toast appears.
AS-003: Changing a task's due date in the list view updates the date cell immediately without waiting for a server response.
AS-004: If the server rejects a due-date change, the date cell reverts to its prior value and an error toast appears.

## Optimistic UI — Task detail sheet

AS-005: Changing a task's status in the task detail sheet updates the status badge immediately.
AS-006: If the server rejects a status change in the detail sheet, the badge reverts and an error toast appears.
AS-007: Changing a task's priority in the task detail sheet updates the priority badge immediately.
AS-008: If the server rejects a priority change in the detail sheet, the badge reverts and an error toast appears.
AS-009: Editing the task title in the detail sheet shows a visual saving indicator while the mutation is in flight.
AS-010: If the title save fails, the displayed title reverts to its pre-edit value and an error toast appears.
AS-011: Saving a title change in the detail sheet commits the edit without requiring the user to open a separate dialog.

## Optimistic UI — My Tasks

AS-012: Checking a task done in My Tasks marks it visually complete before the server confirms.
AS-013: If a My Tasks completion toggle fails, the checkbox reverts to its prior state and an error toast appears.
AS-014: Unchecking a completed task in My Tasks marks it incomplete immediately without waiting for the server.

## Realtime — My Tasks

AS-015: When another user assigns a task to the current user, the task appears in My Tasks without a page refresh.
AS-016: When a task in My Tasks has its status changed by another user, the My Tasks row updates live.
AS-017: When a task is un-assigned from the current user by another user, it disappears from My Tasks without a page refresh.
AS-018: My Tasks realtime only delivers events for tasks the current user is permitted to see (respects project-level RLS).

## Realtime — Calendar

AS-019: When a task's due date is changed by another user, the task moves to the new date column on the calendar without a page refresh.
AS-020: When a new task with a due date is created by another user, it appears on the calendar on the correct day without a page refresh.
AS-021: When a task's due date is removed by another user, the task disappears from the calendar without a page refresh.
AS-022: Calendar realtime only delivers events for tasks the current user is permitted to see.

## Realtime — Search / Command palette

AS-023: When a task title is changed by another user while the command palette is open, the search results reflect the new title without re-opening the palette.
AS-024: When a task is deleted while the command palette is open, it is removed from search results without re-opening the palette.
