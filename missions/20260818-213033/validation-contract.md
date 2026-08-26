# Validation contract

_Mission: 20260818-213033 (v2)_ _Numbering continues from mission 20260817-230717, whose contract ended at AS-176. This contract starts at AS-201 so no ID ever collides with an assertion already referenced in existing code, tests, or commit messages._

_Locked at APPROVED — never modify or delete an assertion; only append new numbers._

## A. Profiles, avatars & theme (AS-201–AS-214)

- AS-201: Every authenticated user has a profile row created automatically on first sign-in, without any manual step.
- AS-202: A user can set their display name, and that name is shown instead of their email everywhere a person is rendered.
- AS-203: A user can upload an avatar image, and it replaces their initials avatar across the app after upload.
- AS-204: A user without an avatar is rendered as initials on a colour derived deterministically from their user id, so the same person always gets the same colour.
- AS-205: An avatar upload larger than the configured size limit is rejected with a message naming the limit.
- AS-206: An avatar upload of a non-image file type is rejected.
- AS-207: A user can set their timezone, and due-date/overdue calculations use it instead of the server timezone.
- AS-208: A user cannot edit another user's profile, including via a direct API call.
- AS-209: Profile display names and avatars are visible to other members of workspaces the user belongs to.
- AS-210: A user who is not in any shared workspace cannot read another user's profile row.
- AS-211: The app has a visible theme toggle offering light, dark, and system.
- AS-212: The selected theme persists across a page reload and a new tab.
- AS-213: The theme applies without a flash of the wrong theme on first paint.
- AS-214: Avatars appear on task cards, in the members list, on comments, and in assignee pickers.

## B. Roles, permissions & project-level access (AS-215–AS-238)

- AS-215: A workspace member can hold one of four roles: owner, admin, member, or viewer.
- AS-216: A viewer can read every project and task in the workspace but cannot create, edit, move, or delete anything.
- AS-217: A viewer's write attempt is rejected server-side, not merely hidden in the UI.
- AS-218: An owner or admin can change any member's role, including promoting to admin.
- AS-219: The sole-owner guard from mission 1 still holds under the expanded role set: the last owner cannot be demoted to any other role.
- AS-220: A guest is a workspace member with access only to the specific projects they have been added to.
- AS-221: A guest cannot see projects they have not been added to, including via a guessed project URL.
- AS-222: A guest cannot see the workspace members list or workspace settings.
- AS-223: A guest can comment on and be assigned tasks inside a project they were added to.
- AS-224: A project can have an explicit member list, and adding a member to a project grants them access to that project.
- AS-225: Removing a member from a project revokes their access to that project's tasks on their next request.
- AS-226: A project marked private is visible only to its explicit project members plus workspace owners and admins.
- AS-227: A project marked workspace-wide is visible to every non-guest workspace member without an explicit project membership row.
- AS-228: Row Level Security enforces project-level visibility, so a direct Supabase query for a private project the caller cannot access returns zero rows.
- AS-229: Only owners and admins can change a project's visibility between private and workspace-wide.
- AS-230: A permission check helper is the single source of truth used by both the UI gating and the server-side re-check for every role-gated action.
- AS-231: Every action a user's role forbids is hidden or disabled in the UI, so the user is never shown a control that will fail.
- AS-232: A role change takes effect on the affected user's next request without them signing out.
- AS-233: An owner can transfer ownership to another member, after which the previous owner becomes an admin.
- AS-234: Ownership transfer is rejected if the target is not an active member of the workspace.
- AS-235: A guest cannot be promoted to admin or owner.
- AS-236: The project members list shows each person's project role and who added them.
- AS-237: A member removed from the workspace entirely loses access to all its projects, including those they were an explicit project member of.
- AS-238: An invite can specify the role the invited person will receive on acceptance.

## C. Workspace settings, audit log & archive (AS-239–AS-256)

- AS-239: A workspace settings page exists and is reachable from the sidebar for owners and admins.
- AS-240: An owner or admin can rename a workspace, and the new name appears in the switcher immediately.
- AS-241: Changing a workspace slug redirects existing URLs using the old slug to the new one rather than 404ing.
- AS-242: A slug already in use by another workspace is rejected with a specific error.
- AS-243: An owner can upload a workspace logo, shown in the workspace switcher.
- AS-244: Only an owner sees the delete-workspace control on the settings page.
- AS-245: Every mutating action on workspaces, projects, members, and roles writes an audit log entry recording actor, action, target, and timestamp.
- AS-246: The audit log is readable by owners and admins only.
- AS-247: A regular member requesting audit log rows directly is rejected by RLS.
- AS-248: The audit log can be filtered by actor and by action type.
- AS-249: Audit log entries are append-only: no UI path or Server Action updates or deletes an existing entry.
- AS-250: An archived project no longer appears in the active project list.
- AS-251: An archive view lists archived projects with the date they were archived and who archived them.
- AS-252: An archived project can be restored, after which it reappears in the active project list with its tasks intact.
- AS-253: Restoring an archived project is rejected for members without admin rights.
- AS-254: An archived project's tasks stay excluded from the dashboard, search results, and My Tasks while archived.
- AS-255: A restored project's tasks reappear in search and dashboard counts.
- AS-256: The archive view is empty-stated when nothing has been archived.

## D. Task keys (AS-257–AS-262)

- AS-257: Every project has a short key (e.g. `PM`), unique within its workspace.
- AS-258: Every task displays a human-readable identifier combining the project key and a per-project sequential number, e.g. `PM-142`.
- AS-259: Task numbers are assigned atomically, so two tasks created at the same moment never receive the same number.
- AS-260: Task numbers are never reused after a task is deleted.
- AS-261: Existing tasks created before this mission receive keys retroactively, in creation order.
- AS-262: Searching for a task key finds that exact task.

## E. Subtasks & checklists (AS-263–AS-275)

- AS-263: A task can have child tasks, and a child task shows a link back to its parent.
- AS-264: A parent task displays its children with their status, and shows a completion count.
- AS-265: A task cannot be its own parent, and a parent/child cycle is rejected.
- AS-266: Nesting is limited to one level: a child task cannot itself have children.
- AS-267: Deleting a parent task soft-deletes its children too.
- AS-268: A child task can be promoted to a top-level task, detaching it from its parent.
- AS-269: A task can have a checklist of items with text and a checked state.
- AS-270: Checking or unchecking a checklist item persists immediately and survives a reload.
- AS-271: A checklist item can be renamed, reordered, and deleted.
- AS-272: A task's completion percentage is derived from its checklist items and child tasks, and is displayed on the task card.
- AS-273: A task with no checklist items and no children shows no completion percentage rather than showing 0%.
- AS-274: Checklist items are scoped by the same workspace RLS as their task; a non-member cannot read or write them.
- AS-275: Child tasks appear on the board as ordinary cards, not hidden inside their parent.

## F. Task dependencies (AS-276–AS-285)

- AS-276: A task can be marked as blocked by another task in the same workspace.
- AS-277: The blocking task shows the tasks it blocks, and the blocked task shows what blocks it.
- AS-278: A dependency that would create a cycle is rejected with a message naming the conflict.
- AS-279: A task cannot depend on itself.
- AS-280: Moving a blocked task to a done status warns the user that a blocker is still open, and requires confirmation.
- AS-281: A task whose blockers are all complete shows no blocked warning.
- AS-282: A dependency can be removed by either side of the relationship.
- AS-283: A blocked task shows a visible indicator on its card, using an icon plus text rather than colour alone.
- AS-284: Deleting a task removes the dependency rows referencing it, leaving no dangling links.
- AS-285: A dependency cannot be created against a task in a different workspace, including via a direct API call.

## G. Multiple assignees & watchers (AS-286–AS-297)

- AS-286: A task can have more than one assignee.
- AS-287: All assignees of a task are shown on the task card as a stacked avatar group.
- AS-288: A task with more assignees than the card can display shows an overflow count.
- AS-289: An assignee can be removed from a task without affecting other assignees.
- AS-290: Only workspace members with access to the task's project can be assigned to it.
- AS-291: Assignee filters in list, board, and dashboard match tasks where the selected person is any of the assignees.
- AS-292: Tasks assigned before this mission keep their single assignee after migration, with no data loss.
- AS-293: A user can watch a task they are not assigned to.
- AS-294: A watcher receives notifications for the task's activity.
- AS-295: A user is added as a watcher automatically when they comment on a task.
- AS-296: A user can stop watching a task, after which they stop receiving its notifications.
- AS-297: The task detail view shows the current watcher list.

## H. Estimates vs logged time (AS-298–AS-305)

- AS-298: A task can carry a time estimate in hours or minutes.
- AS-299: A negative or zero estimate is rejected.
- AS-300: The task detail view shows estimate versus actual logged time.
- AS-301: A task whose logged time exceeds its estimate is visibly flagged as over-estimate.
- AS-302: A task with no estimate shows logged time only, with no over-estimate flag.
- AS-303: A project header shows the sum of estimates against the sum of logged time.
- AS-304: Estimate totals exclude soft-deleted tasks.
- AS-305: Only users who can edit a task can change its estimate.

## I. Rich-text descriptions (AS-306–AS-313)

- AS-306: A task description supports bold, italic, headings, bullet and numbered lists, code blocks, and links.
- AS-307: A rich-text description renders with its formatting after a reload.
- AS-308: Pasting formatted content from another app preserves supported formatting and drops unsupported markup.
- AS-309: Description content is sanitised, so a script tag pasted into a description never executes when rendered.
- AS-310: Existing plain-text descriptions from mission 1 render unchanged after migration.
- AS-311: A description can contain a checkbox list that can be toggled inline.
- AS-312: Comments support the same rich-text formatting as descriptions.
- AS-313: The editor is keyboard-operable, including exiting the editor with Escape without losing content.

## J. Recurring tasks (AS-314–AS-323)

- AS-314: A task can be given a recurrence rule of daily, weekly, monthly, or a custom interval of N days.
- AS-315: When a recurring task is completed, the next occurrence is created automatically with the due date advanced by the rule.
- AS-316: The new occurrence copies the title, description, assignees, priority, checklist, and estimate, but not comments, attachments, or logged time.
- AS-317: A recurring task shows a recurrence indicator on its card.
- AS-318: A recurrence rule can be edited or removed without deleting the task.
- AS-319: Removing the recurrence rule stops further occurrences from being generated.
- AS-320: Completing an occurrence twice does not create two next occurrences.
- AS-321: A recurring task in an archived project generates no new occurrences.
- AS-322: A scheduled job generates due occurrences for date-based recurrences without anyone opening the app.
- AS-323: A recurrence with an end date stops generating occurrences after that date.

## K. Duplicate & templates (AS-324–AS-333)

- AS-324: A task can be duplicated, producing a new task with the same title prefixed to mark it a copy.
- AS-325: A duplicated task copies description, priority, assignees, tags, checklist, and estimate.
- AS-326: A duplicated task does not copy comments, attachments, logged time, or the original's task key.
- AS-327: A duplicate is created in the same project and status as the original, positioned directly after it.
- AS-328: A task can be saved as a reusable template with a name.
- AS-329: Templates are scoped to the workspace and visible to all its non-guest members.
- AS-330: Creating a task from a template pre-fills the new task with the template's fields.
- AS-331: A template can be renamed and deleted by an admin or its creator.
- AS-332: Deleting a template does not affect tasks previously created from it.
- AS-333: A project can be created from a template that also creates the template's tasks.

## L. Bulk actions (AS-334–AS-342)

- AS-334: Multiple tasks can be selected in the list view via checkboxes.
- AS-335: A select-all control selects every task currently matching the active filters, and only those.
- AS-336: The number of selected tasks is displayed, along with a clear-selection control.
- AS-337: Selected tasks can have their status changed in one action.
- AS-338: Selected tasks can have their assignee, priority, or due date set in one action.
- AS-339: Selected tasks can be deleted in one action, after a confirmation naming the count.
- AS-340: A bulk action that partially fails reports which tasks failed and leaves the rest applied.
- AS-341: A bulk action a user's role forbids is rejected server-side for every task in the selection.
- AS-342: The selection is cleared after a bulk action completes.

## M. Trash & undo (AS-343–AS-352)

- AS-343: A deleted task goes to a trash view rather than disappearing permanently.
- AS-344: A deleted task can be restored from trash to its original project and status.
- AS-345: Deleting a task shows an undo affordance that restores it without visiting the trash view.
- AS-346: A deleted comment can be restored from trash by its author or an admin.
- AS-347: The trash view shows what was deleted, by whom, and when.
- AS-348: An admin can permanently purge an item from the trash, after a confirmation.
- AS-349: A purged item is gone for good and no longer appears in trash.
- AS-350: Items in trash are excluded from board, list, search, dashboard, and My Tasks.
- AS-351: Restoring a task whose project has since been archived restores it into the archived project without unarchiving the project.
- AS-352: Trash is scoped to the workspace, so a member cannot see another workspace's deleted items.

## N. Activity log & history (AS-353–AS-361)

- AS-353: Every task shows a chronological activity feed of changes made to it.
- AS-354: The activity feed records who made each change and when.
- AS-355: Status, assignee, priority, due date, estimate, and title changes each produce an activity entry showing the old and new value.
- AS-356: Comment additions and deletions appear in the same feed as field changes.
- AS-357: Activity entries cannot be edited or deleted by anyone through the app.
- AS-358: The activity feed loads the most recent entries first and can be expanded to show older ones.
- AS-359: A non-member cannot read a task's activity entries via a direct API call.
- AS-360: Automated changes made by the recurrence job are attributed to the system rather than to a user.
- AS-361: The activity feed is grouped by day with readable relative timestamps.

## O. Comment editing & reactions (AS-362–AS-370)

- AS-362: A comment's author can edit their own comment.
- AS-363: An edited comment is marked as edited with the time it was last changed.
- AS-364: A user cannot edit another user's comment, including via a direct API call.
- AS-365: A user can add an emoji reaction to a comment.
- AS-366: A reaction shows a count and the names of everyone who reacted.
- AS-367: Clicking a reaction the user already added removes their reaction.
- AS-368: A user can only react once per emoji per comment.
- AS-369: Reactions appear live for other viewers of the same task without a reload.
- AS-370: Reactions on a deleted comment are removed with it.

## P. @mentions (AS-371–AS-378)

- AS-371: Typing `@` in a comment opens a picker listing members with access to the task's project.
- AS-372: The mention picker filters as the user types a name.
- AS-373: A selected mention is rendered as a highlighted chip in the posted comment.
- AS-374: A mentioned user receives a notification linking directly to the comment.
- AS-375: A mentioned user who is not already a watcher becomes one.
- AS-376: Mentioning a user who lacks access to the project is not offered in the picker and is rejected if forced.
- AS-377: A mention of a user who is later removed from the workspace renders as plain text rather than breaking.
- AS-378: Mentions also work in task descriptions.

## Q. In-app notification centre (AS-379–AS-392)

- AS-379: A notification bell in the app header shows the count of unread notifications.
- AS-380: A user receives a notification when a task is assigned to them.
- AS-381: A user receives a notification when they are mentioned.
- AS-382: A watcher receives a notification when a task they watch changes status or gets a comment.
- AS-383: A user receives a notification when a task assigned to them becomes overdue.
- AS-384: A user does not receive notifications for their own actions.
- AS-385: Opening the notification panel lists notifications newest first with the actor, the action, and the task.
- AS-386: Clicking a notification navigates to the relevant task and marks that notification read.
- AS-387: A mark-all-as-read control clears the unread count.
- AS-388: The unread count updates live without a reload when a new notification arrives.
- AS-389: A user can only read their own notifications; a direct query for another user's notifications returns zero rows.
- AS-390: Notifications for a deleted task no longer navigate to a broken page.
- AS-391: A user can configure which notification types they receive.
- AS-392: Notifications older than the retention window are not shown in the panel.

## R. Email notifications & digest (AS-393–AS-402)

- AS-393: An email is sent when a user is assigned a task, if that user has email notifications enabled.
- AS-394: An email is sent when a user is mentioned, if enabled.
- AS-395: Every notification email contains a direct link to the task and an unsubscribe or preferences link.
- AS-396: A user can turn email notifications off entirely, and then receives none.
- AS-397: A daily digest email summarises the recipient's tasks due today, overdue tasks, and unread notifications.
- AS-398: The digest is not sent to a user with nothing to report.
- AS-399: The digest is scheduled and sent without anyone opening the app.
- AS-400: The digest is sent at a time that respects the recipient's timezone setting.
- AS-401: A failed email send is logged and retried, and never blocks or fails the user action that triggered it.
- AS-402: No email is ever sent to an address that has not confirmed sign-in to the workspace.

## S. Custom board columns / statuses (AS-403–AS-417)

- AS-403: A project's board columns are defined per project rather than fixed to the original four.
- AS-404: An admin can add, rename, reorder, and remove a board column.
- AS-405: Each column has a colour and a category of not-started, in-progress, or done.
- AS-406: Removing a column requires choosing a destination column for its tasks; no task is orphaned.
- AS-407: A new project starts with the default four columns, matching the previous behaviour.
- AS-408: Existing tasks migrate to the default columns with their current status preserved exactly.
- AS-409: Dragging a task to a column sets its status to that column.
- AS-410: A task counts as complete for progress, overdue, and dependency purposes when its column category is done.
- AS-411: The list view's status filter and inline status editor list the project's actual columns.
- AS-412: The dashboard's status chart reflects custom columns rather than the original four.
- AS-413: Column changes appear for other viewers of the same board without a reload.
- AS-414: A non-admin cannot add, rename, or remove columns.
- AS-415: A project cannot be left with zero columns.
- AS-416: Column order persists across reloads for all viewers.
- AS-417: Search results display each task's actual column name.

## T. Grouping & swimlanes (AS-418–AS-425)

- AS-418: The board can be grouped into swimlanes by assignee, priority, or tag.
- AS-419: With no grouping selected, the board renders exactly as it does today.
- AS-420: Dragging a card between swimlanes updates the grouped field, e.g. dropping into another assignee's lane reassigns the task.
- AS-421: Each swimlane shows its own per-column task counts.
- AS-422: A swimlane can be collapsed and stays collapsed across reloads.
- AS-423: Tasks with no value for the grouped field appear in an explicit "None" lane.
- AS-424: The chosen grouping persists per user per project.
- AS-425: Drag-and-drop ordering within a column still works while grouped.

## U. Saved views (AS-426–AS-434)

- AS-426: A set of filters, sort order, and grouping can be saved as a named view.
- AS-427: A saved view can be personal or shared with the workspace.
- AS-428: Opening a saved view restores its filters, sort, and grouping exactly.
- AS-429: A shared view is visible to every member with access to its project.
- AS-430: Only a view's creator or an admin can edit or delete a shared view.
- AS-431: A saved view can be set as the user's default for a project.
- AS-432: A saved view has a shareable URL that reproduces the same result for another member.
- AS-433: A saved view referencing a deleted status or member degrades gracefully instead of erroring.
- AS-434: A personal view is not visible to other members, including via a direct query.

## V. My tasks (AS-435–AS-441)

- AS-435: A My Tasks page lists tasks assigned to the current user across all projects in the workspace.
- AS-436: My Tasks groups tasks into overdue, today, this week, and later.
- AS-437: My Tasks excludes tasks in archived projects and in trash.
- AS-438: A task can have its status changed directly from My Tasks.
- AS-439: My Tasks shows which project each task belongs to.
- AS-440: A user with no assigned tasks sees a purposeful empty state rather than a blank page.
- AS-441: My Tasks can optionally include tasks the user watches.

## W. Calendar view (AS-442–AS-450)

- AS-442: A calendar view shows tasks positioned on their due dates in a month grid.
- AS-443: The calendar can move to the previous and next month, and jump back to today.
- AS-444: Clicking a task in the calendar opens its detail view.
- AS-445: Dragging a task to a different day changes its due date.
- AS-446: Tasks with no due date do not appear in the calendar, and their absence is explained.
- AS-447: A day with more tasks than fit shows an overflow control revealing the rest.
- AS-448: The calendar respects the active filters, e.g. assignee.
- AS-449: The calendar renders usably on a phone-width viewport.
- AS-450: Calendar dates are computed in the user's timezone.

## X. Timeline / Gantt (AS-451–AS-458)

- AS-451: A timeline view shows tasks as horizontal bars spanning start date to due date.
- AS-452: A task without a start date renders as a single-day marker on its due date.
- AS-453: A task can be given a start date, which must not be after its due date.
- AS-454: Dragging a bar's edge changes the task's start or due date.
- AS-455: Dependencies are drawn as connectors between bars.
- AS-456: The timeline can switch between week, month, and quarter zoom levels.
- AS-457: Today is marked with a visible line on the timeline.
- AS-458: The timeline scrolls horizontally without breaking the surrounding layout.

## Y. Command palette & keyboard (AS-459–AS-472)

- AS-459: Pressing Cmd+K (Ctrl+K on Windows/Linux) anywhere in the app opens a command palette.
- AS-460: The palette searches projects, tasks, and members, and lists results grouped by type.
- AS-461: Selecting a palette result navigates to it.
- AS-462: The palette offers actions such as create task, create project, and toggle theme.
- AS-463: The palette is fully keyboard-operable and closes on Escape.
- AS-464: The palette does not open while the user is typing in a text field, except via the explicit shortcut.
- AS-465: The palette shows recent items when the query is empty.
- AS-466: A palette search with no results shows an explicit no-results state.
- AS-467: Pressing `n` creates a new task in the current project context.
- AS-468: Pressing `/` focuses search.
- AS-469: Pressing `?` opens a keyboard shortcut reference dialog.
- AS-470: Single-key shortcuts do not fire while focus is inside an input, textarea, or rich-text editor.
- AS-471: Escape closes the topmost open dialog, sheet, or popover, one layer at a time.
- AS-472: Every shortcut in the reference dialog performs the action it documents.

## Z. Task deep links & routing (AS-473–AS-478)

- AS-473: Every task has its own URL that opens the task directly.
- AS-474: A task URL opened in a fresh tab renders the task, not a blank page or a redirect to the board.
- AS-475: Opening a task from the board updates the URL without a full page reload.
- AS-476: Closing the task returns the user to the view they came from, with scroll and filters preserved.
- AS-477: A task URL for a task the user cannot access returns a not-found response rather than revealing its existence.
- AS-478: The browser back button closes an open task rather than leaving the app.

## AA. Quick add & inline editing (AS-479–AS-489)

- AS-479: Each board column has a quick-add control that creates a task in that column from a single title input.
- AS-480: Quick add keeps focus in the input after submitting, so several tasks can be added in a row.
- AS-481: A quick-add task appears immediately and is reconciled with the server result.
- AS-482: Submitting quick add with an empty title does nothing and shows no error toast.
- AS-483: Escape cancels quick add without creating a task.
- AS-484: The list view allows editing assignee, priority, due date, and status inline in the row.
- AS-485: An inline edit saves without a page reload and shows a failure state if the save is rejected.
- AS-486: An inline edit rejected by permissions reverts the displayed value to the server value.
- AS-487: Inline editing is operable by keyboard alone.
- AS-488: An inline edit made by another user appears live for other viewers.
- AS-489: Inline controls are not rendered for a viewer or a user without edit rights.

## BB. Empty states, onboarding & loading (AS-490–AS-500)

- AS-490: Every primary view has an empty state that explains what the view is for and offers the main action.
- AS-491: A first-time user is offered a short guided tour of the sidebar, board, and task creation.
- AS-492: The tour can be dismissed at any step and does not reappear after being completed or dismissed.
- AS-493: The tour can be replayed from the profile or help menu.
- AS-494: A brand-new workspace offers to create a sample project so the app is not empty on first login.
- AS-495: Every route that fetches data shows a skeleton matching the final layout rather than a spinner or blank screen.
- AS-496: A skeleton is replaced by content without a visible layout shift.
- AS-497: Every mutation shows either an optimistic result or a pending state within 100ms of the user's action.
- AS-498: A failed mutation rolls the optimistic state back and explains what failed.
- AS-499: A slow action shows a pending indicator on the control that triggered it, and that control cannot be double-submitted.
- AS-500: An error in one view does not blank the entire app shell.

## CC. Attachments UX (AS-501–AS-508)

- AS-501: A file can be attached by dragging it onto the task detail view.
- AS-502: The drop target is visibly highlighted while a file is dragged over it.
- AS-503: Multiple files dropped at once are all uploaded.
- AS-504: Upload progress is shown per file.
- AS-505: An image attachment shows a thumbnail preview instead of a generic file icon.
- AS-506: Clicking an image attachment opens a full-size preview that can be closed with Escape.
- AS-507: A rejected upload, e.g. too large or a disallowed type, reports why and does not leave a partial attachment row.
- AS-508: An image can be pasted from the clipboard into a comment and is uploaded as an attachment.

## DD. Navigation, mobile & header search (AS-509–AS-522)

- AS-509: The sidebar lists the workspace's projects, not just a link to the projects page.
- AS-510: A project can be marked a favourite, and favourites are pinned above the rest of the sidebar project list.
- AS-511: The sidebar project list highlights the project currently open.
- AS-512: The sidebar project list is scrollable and does not push navigation items out of view when there are many projects.
- AS-513: A workspace with no projects shows a create-project action in the sidebar.
- AS-514: The board is usable on a phone-width viewport, with columns reachable by horizontal swipe.
- AS-515: A task can be moved between columns on touch devices without a mouse.
- AS-516: The task detail view is full-screen on phone-width viewports rather than a cramped side sheet.
- AS-517: No primary view scrolls horizontally on a phone-width viewport except deliberately scrollable containers such as the board and timeline.
- AS-518: Tap targets in the mobile navigation meet a minimum 44px touch size.
- AS-519: A search input in the app header is available from every workspace page.
- AS-520: Typing in header search shows matching tasks and projects as a dropdown without leaving the page.
- AS-521: Selecting a header search result navigates directly to that item.
- AS-522: Pressing Enter in header search opens the full search page with the same query.

## EE. Final QA (AS-523–AS-530)

- AS-523: Every new interactive control is reachable and operable by keyboard alone.
- AS-524: Every new icon-only control has an accessible name.
- AS-525: Every new status, priority, and indicator conveys meaning with an icon or text, not colour alone.
- AS-526: New surfaces meet WCAG AA contrast in both light and dark themes.
- AS-527: The whole project passes type-check with no errors and no new `any` used to bypass a type error.
- AS-528: The whole project passes the linter with no errors.
- AS-529: The README documents every new feature area, environment variable, and scheduled job added by this mission.
- AS-530: The full test suite, unit and end-to-end, passes on a clean checkout.

## FF. QA feedback browser extension (AS-531–AS-572) — M19

_Appended 2026-08-19. The contract is append-only; these are new IDs, nothing above was edited._

- AS-531: The extension loads in Chrome as a Manifest V3 extension and shows its popup when the toolbar icon is clicked.
- AS-532: A user already signed in to the pm-app web app can connect the extension to that session without typing credentials into the extension.
- AS-533: A user not signed in anywhere is told to sign in and given a link that opens the web app's sign-in page.
- AS-534: The extension's session survives the browser being closed and reopened.
- AS-535: The extension's session survives its service worker going idle and restarting.
- AS-536: An expired session is refreshed silently on open, and if the refresh fails the user is signed out and told why.
- AS-537: Signing out of the extension clears its stored session, and the next open requires reconnecting.
- AS-538: The extension never stores or transmits the Supabase secret key; only the publishable key is present in the shipped bundle.
- AS-539: Clicking the extension's capture control takes a screenshot of the visible area of the current tab.
- AS-540: The user can capture a selected region instead of the whole visible area.
- AS-541: A capture on a page the extension has no permission for fails with an explanatory message rather than a silent no-op.
- AS-542: The captured image can be annotated with at least an arrow, a rectangle, freehand drawing, and text.
- AS-543: An annotation can be undone and redone.
- AS-544: A region of the capture can be blurred, so sensitive data can be hidden before the report is sent.
- AS-545: The annotated image is what gets attached to the task, not the unannotated original.
- AS-546: The user can point at an element on the page and have the report record which element it was.
- AS-547: The recorded element reference includes a CSS selector and the element's position and size.
- AS-548: Every report automatically records the page URL, browser name and version, operating system, viewport size, and device pixel ratio.
- AS-549: Every report automatically records the reporter's identity and the moment of capture.
- AS-550: Console errors and warnings produced by the page are captured and attached to the report.
- AS-551: Console capture is bounded, so a page that logs continuously cannot produce an unbounded payload.
- AS-552: Console capture states plainly that it only covers messages produced after the capture script was injected.
- AS-553: Failed network requests visible to the page are captured and attached to the report.
- AS-554: A user can turn off console and network capture for a given report before sending it.
- AS-555: The extension's form lets the reporter pick the workspace, project, and status the task will be created in.
- AS-556: The extension's form lets the reporter set a title, a description, an assignee, a priority, and a due date.
- AS-557: The workspace, project, assignee, and status choices offered are only those the signed-in user actually has access to.
- AS-558: Submitting the form creates a real task in pm-app, visible on that project's board.
- AS-559: The created task carries the annotated screenshot as an attachment.
- AS-560: The created task's description contains the captured technical metadata in a readable form.
- AS-561: The created task is attributed to the signed-in reporter as its creator, not to a service account.
- AS-562: A submission by a user without permission to create tasks in the chosen project is rejected by the server.
- AS-563: After a successful submission the extension shows the new task's key and a link that opens it in pm-app.
- AS-564: The extension remembers the last used workspace and project and preselects them on the next report.
- AS-565: A submission attempted while offline reports the failure and does not lose the user's typed input or annotations.
- AS-566: A screenshot larger than the accepted upload size is rejected with a message naming the limit, before the task is created.
- AS-567: A failed attachment upload does not leave a task with a broken or missing image reference.
- AS-568: The extension requests the narrowest permissions that support its features, and every requested permission is justified in the store listing.
- AS-569: The extension works on a page it has never been used on before without a prior configuration step.
- AS-570: The extension's popup is operable by keyboard alone.
- AS-571: The extension is packaged into a distributable artifact by a repeatable build command.
- AS-572: The task-creation endpoint rejects a request whose session token is missing, expired, or belongs to a different user than the payload claims.

---

## Scope reductions (append-only; the assertions above are never edited or deleted)

Per the mission's hard rule ("The validation contract is immutable once APPROVED exists. New requirements get new assertion IDs; existing assertions are never edited or deleted."), the following assertions from the M19 section above no longer describe features the shipped extension has, by deliberate, authorized decision after they were implemented and verified. This section records the withdrawal; it does not remove the assertion text above.

- **AS-550, AS-551, AS-552 (console log capture), AS-553 (network-error capture), AS-554 (capture privacy toggles)** — withdrawn 2026-08-26. Implemented and independently verified (F289, F290, F291), then deleted in its entirety by commit `439403d`, whose own message states: "per explicit user request — this capability is not needed and should be gone, not just hidden." No re-implementation is planned. Note: because nothing is captured, AS-554's underlying privacy concern (a user believing capture is off while it still runs) cannot occur — the withdrawal fails safe. Source: `missions/20260818-213033/milestones/M19-scrutiny.md`, BLOCKER-3.
- **AS-539 (whole-visible-area capture control)** — withdrawn 2026-08-26. The dedicated whole-tab capture control was replaced by a region-first capture flow in commit `fbe8a3f` ("select-portion-first capture flow, replacing capture-then-crop"). The underlying `captureVisibleTab` capability still exists internally as the crop source, but no UI control invokes it standalone any longer, and the extension's own test suite now asserts the whole-tab control's absence. Source: `missions/20260818-213033/milestones/M19-scrutiny.md`, MAJ-1.

