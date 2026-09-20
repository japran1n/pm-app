# Validation contract — Team Planner

_Mission: 20260920-124226_  _Written: 2026-09-20_

Immutable once `APPROVED` exists. New requirements get new IDs appended;
no existing assertion is ever edited, renumbered, or deleted.

---

## A. Default view and URL state

AS-001: Opening the Planner with no query parameters shows only the signed-in member's own calendar blocks.
AS-002: Opening the Planner with no query parameters renders the full-day week grid, covering all 24 hours across 7 days.
AS-003: `?people=me` resolves to the signed-in member.
AS-004: `?people=all` resolves to every active member of the workspace.
AS-005: `?people=<memberId>` shows that member's blocks and no one else's.
AS-006: A comma-separated list of member ids in `?people=` shows exactly those members' blocks.
AS-007: An id in `?people=` that is not an active workspace member is dropped, and the remaining valid ids still take effect.
AS-008: A `?people=` value whose ids are all invalid falls back to the signed-in member's own planner rather than showing an error or an empty page.
AS-009: The sequence of ids in `?people=` is preserved exactly as given; it is neither alphabetised nor reordered by the parser.
AS-010: An id repeated in `?people=` produces exactly one selected person.
AS-011: Navigating to the previous, next, or current week preserves the `?people=` value.
AS-012: Changing the selected people preserves the `?week=` value.
AS-013: No Planner view state is written to `localStorage` or `sessionStorage`.
AS-014: A Planner URL opened by a second member with the same access rights renders the same selection of people and the same week.
AS-015: The Planner honours no `?view=` parameter; supplying one changes nothing about what is rendered.

## B. Which layout is shown

AS-016: When exactly one person is selected, the Planner renders the full-day week grid.
AS-017: When two or more people are selected, the Planner renders the stacked layout instead of the week grid.
AS-018: The stacked layout renders the hours 08:00 to 16:00 only.
AS-019: The stacked layout renders Monday through Friday only, as five day columns.
AS-020: A block lying entirely outside 08:00–16:00 is not rendered in the stacked layout.
AS-021: A block falling on a Saturday or Sunday is not rendered in the stacked layout.
AS-022: A block that partly overlaps 08:00–16:00 is rendered in the stacked layout clipped to the visible window.
AS-023: Narrowing the selection to a single person from the stacked layout returns the Planner to the full-day week grid for that person.
AS-024: A selected person with no blocks in the visible week still gets their own labelled row in the stacked layout.

## C. Visibility and database access

AS-025: An active workspace member can read another active member's calendar blocks.
AS-026: A calendar block attached to a project the viewer cannot otherwise see is still readable by any active member of that workspace.
AS-027: Another member's block displays its real title, not a placeholder such as "Busy".
AS-028: Someone who is not an active member of the workspace cannot read any of its calendar blocks.
AS-029: The set of people is applied as a database-level restriction on the blocks query, not by discarding rows after fetching them.
AS-030: A member who has been deactivated or removed from the workspace does not appear in the people switcher.
AS-031: A deactivated member's blocks are not rendered even when their id is present in `?people=`.
AS-032: A member cannot insert, update, or delete a calendar block owned by another member; the database rejects the write.

## D. Tasks leave the Planner

AS-033: The Planner renders no task strips and no task chips.
AS-034: Loading the Planner issues no query for tasks.
AS-035: The Planner shows no status, priority, assignee, or project filter controls.
AS-036: Stale `?status=`, `?priority=`, `?assigneeId=`, or `?projectId=` values in a Planner URL are ignored without producing an error.
AS-037: The calendar block form offers no way to link a block to a task.
AS-038: The `calendar_blocks` table has no `task_id` column.
AS-039: Every calendar block that existed before the `task_id` removal still exists afterwards.
AS-040: The My Tasks page continues to show the signed-in member's tasks exactly as before this mission.
AS-041: Deleting a task deletes no calendar block.

## E. Other members' blocks are read-only

AS-042: A block owned by another member exposes no resize handles.
AS-043: A block owned by another member cannot be dragged to a new time.
AS-044: Clicking a block owned by another member opens a read-only detail view.
AS-045: The read-only detail view for another member's block offers no save and no delete control.
AS-046: The signed-in member's own blocks remain fully editable while another member's blocks are on screen.
AS-047: No create affordance is offered on a day column or stacked row belonging to another member.
AS-048: Dragging over empty space in another member's day column or stacked row creates nothing.
AS-049: Creating a block by clicking or dragging still works on the signed-in member's own grid.
AS-050: A write aimed at another member's block is rejected by the server even when issued directly, bypassing the interface.

## F. The people switcher

AS-051: The people switcher appears in the Planner header row alongside the previous/today/next week controls.
AS-052: The switcher lists active workspace members with their avatar and name.
AS-053: Typing in the switcher narrows the listed members.
AS-054: The switcher allows several members to be selected at once.
AS-055: The switcher's closed state shows the current selection as a group of avatars with an overflow count when it does not fit.
AS-056: The switcher offers a "just me" shortcut that returns the Planner to the signed-in member alone.
AS-057: The switcher offers a "whole team" shortcut that selects every active member.
AS-058: The "whole team" shortcut orders the signed-in member first, then the remaining members alphabetically by name.
AS-059: Deselecting every member leaves the Planner showing the signed-in member rather than an empty view.
AS-060: The switcher can be opened, searched, and have a member toggled using the keyboard alone.
AS-061: The people switcher is reachable and usable at mobile viewport width.

## G. The stacked layout

AS-062: Each stacked row is labelled with the name of the member it belongs to.
AS-063: Stacked rows appear in the same order as the ids in `?people=`.
AS-064: A stacked row can be dragged to a new position among the other rows.
AS-065: Reordering stacked rows rewrites `?people=` so the new order survives a page reload.
AS-066: Approved time off for a member is shown as a strip above that member's stacked row.
AS-067: A block in the stacked layout keeps its own colour; no per-person colour is substituted.
AS-068: Selecting many members makes the stacked layout scroll rather than compressing the rows until they are unreadable.
AS-069: The Planner displays no hours total, no capacity figure, and no utilisation percentage anywhere.
AS-070: When the single selected person is someone other than the signed-in member, the header states whose planner is being shown.
AS-071: No per-person colour tint is applied to any block in any layout.

## H. Quality gates

AS-072: The pure helpers for parsing the people selection, clipping to the stacked window, and ordering rows are covered by unit tests.
AS-073: `npx tsc --noEmit` reports no errors.
AS-074: `npx eslint . --max-warnings=0` reports no errors and no warnings.
AS-075: The unit test suite passes.
AS-076: `npm run migrations:check` reports no drift against the remote database.
AS-077: An end-to-end test proves the Planner opens on the signed-in member's own blocks.
AS-078: An end-to-end test proves selecting a second member switches the Planner to the stacked layout.
AS-079: An end-to-end test proves another member's block cannot be dragged.
AS-080: Tests covering task behaviour inside the Planner are deleted rather than skipped or commented out.
AS-081: No unreachable task-fetching or task-filtering code remains on the Planner route.
AS-082: The stacked layout remains usable at mobile viewport width.
AS-083: The stacked layout exposes its rows as a labelled region so a screen reader announces whose planner each row is.
AS-084: The mission adds no new runtime or development dependency to `package.json`.
