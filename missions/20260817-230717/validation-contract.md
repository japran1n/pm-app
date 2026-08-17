# Validation contract

_Mission: 20260817-230717_ _Locked at APPROVED — see rules in the `validation-contracts` skill: never modify or delete an assertion; only append new numbers._

## Auth & workspace access (AS-001–AS-024)

- AS-001: A visitor with no session is redirected to the sign-in page when visiting any `/w/*` route.
- AS-002: A user can request a magic link by submitting their email on the sign-in page.
- AS-003: Clicking a valid magic link signs the user in and redirects them to their default workspace.
- AS-004: An expired or already-used magic link shows an error and offers to resend a new one.
- AS-005: On first sign-in with no existing workspace membership, the user is prompted to create a workspace.
- AS-006: Creating a workspace makes the creating user its owner.
- AS-007: A workspace owner can invite a user by email, creating a `workspace_members` row with status `invited`.
- AS-008: An invited email that signs in via magic link is granted `active` membership in the workspace it was invited to, without a separate signup token.
- AS-009: An invited email that has not yet signed in does not appear as `active` in the members list.
- AS-010: A user who is not a member of a workspace cannot view that workspace's projects, tasks, or members, even with a guessed URL.
- AS-011: A user who is not a member of a workspace and requests its data via a direct Supabase client call is rejected by RLS, not just hidden by the UI.
- AS-012: A signed-in user belonging to multiple workspaces sees a workspace switcher listing all their workspaces.
- AS-013: Switching workspaces via the switcher changes the active workspace in the URL and reloads workspace-scoped data.
- AS-014: A workspace owner can change a member's role between `member` and `admin`.
- AS-015: A `member` role cannot change another member's role; the action is unavailable in the UI and rejected server-side if attempted directly.
- AS-016: A workspace owner can remove a member from the workspace.
- AS-017: A removed member immediately loses access to that workspace's data on their next request.
- AS-018: A workspace cannot be left without an owner — the sole owner cannot demote themselves or be removed while they are the only owner.
- AS-019: An `admin` can invite and remove members but cannot delete the workspace itself.
- AS-020: Only the owner can delete a workspace.
- AS-021: Deleting a workspace soft-deletes it and all its projects and tasks (does not hard-delete).
- AS-022: A signed-out user's session is fully cleared on sign-out; navigating back does not show cached workspace data.
- AS-023: The invite list shows pending invites separately from active members.
- AS-024: A workspace owner can revoke a pending (not-yet-accepted) invite.

## Projects (AS-025–AS-042)

- AS-025: A workspace member can create a project with a name (required) and description (optional).
- AS-026: A project's name cannot be empty; the create form rejects an empty submission client-side and the database rejects it server-side.
- AS-027: A workspace member can view the list of all non-deleted projects in the active workspace.
- AS-028: A member of workspace A cannot view a project belonging to workspace B, even via direct API/RLS access.
- AS-029: A project can be edited (name, description, start date, end date) by any workspace member.
- AS-030: A project can be archived (soft delete) by an admin or owner.
- AS-031: An archived project no longer appears in the default project list.
- AS-032: An archived project's tasks remain intact and viewable when navigating directly to the archived project.
- AS-033: A regular `member` cannot archive a project; the action is unavailable in the UI and rejected server-side if attempted directly.
- AS-034: The project list shows, per project, a count of open (non-completed) tasks.
- AS-035: A project's end date, if set, cannot be earlier than its start date; the form rejects this combination.
- AS-036: Creating a project sets `created_at` and `created_by` automatically.
- AS-037: Editing a project updates `updated_at` automatically.
- AS-038: A project detail page shows tabs/views for Board and List (Table optional; Timeline explicitly out of scope for v1).
- AS-039: Navigating to a project that does not exist (deleted or invalid ID) shows a not-found state, not an error page.
- AS-040: Navigating to a project belonging to a different workspace than the active one redirects to that workspace's context or shows not-found, never partial data.
- AS-041: A project with zero tasks shows an empty state on the Board view with a prompt to create the first task.
- AS-042: The project list is scoped to the active workspace only — switching workspaces changes the visible project list.

## Tasks — CRUD (AS-043–AS-066)

- AS-043: A workspace member can create a task within a project with at minimum a title.
- AS-044: A task's title cannot be empty; rejected client-side and server-side.
- AS-045: A new task defaults to status `todo` if no status is specified at creation.
- AS-046: A task can optionally have a description, priority, assignee, and due date at creation.
- AS-047: A task's status must be one of exactly: `todo`, `in_progress`, `in_review`, `done`.
- AS-048: Attempting to set a task's status to a value outside the fixed set is rejected at the database level (CHECK constraint), not only in the UI.
- AS-049: A task's priority must be one of exactly: `urgent`, `high`, `medium`, `low`, `backlog`.
- AS-050: Attempting to set a task's priority outside the fixed set is rejected at the database level.
- AS-051: A task can be assigned to exactly one member of the task's workspace (single-assignee model).
- AS-052: A task cannot be assigned to a user who is not a member of the task's workspace.
- AS-053: A task can be unassigned (assignee set to null) by any workspace member.
- AS-054: A task can be edited (title, description, priority, assignee, due date) by any workspace member.
- AS-055: A task can be soft-deleted by any workspace member; it is removed from all views immediately.
- AS-056: A soft-deleted task does not appear in board, list, search, or dashboard views.
- AS-057: A soft-deleted task's comments and attachments are not individually recoverable through the UI (no orphan-comment view).
- AS-058: Creating a task sets `created_at` and `created_by`/author automatically.
- AS-059: Editing a task updates `updated_at` automatically.
- AS-060: A task belongs to exactly one project; moving a task between projects is not supported in v1 (out of scope, not silently broken).
- AS-061: A member viewing a task they did not create and are not assigned to can still view and edit it (no per-task ownership restriction beyond workspace membership).
- AS-062: A user not a member of the task's workspace cannot read that task via direct API access, even with a valid session in another workspace.
- AS-063: A task's due date, if set, accepts any valid date including past dates (no restriction — overdue tracking is a feature, not a validation error).
- AS-064: An overdue task (due date in the past, status not `done`) is visually distinguished in list and board views.
- AS-065: A task can have zero, one, or multiple tags stored as a text array; tags are optional.
- AS-066: Removing all tags from a task is possible and results in an empty (not null) tag list.

## Kanban board & ordering (AS-067–AS-084)

- AS-067: The board view renders exactly 4 columns corresponding to the 4 fixed status values, in a fixed left-to-right order: To Do, In Progress, In Review, Done.
- AS-068: Each column shows only tasks with that column's status, scoped to the current project.
- AS-069: Dragging a task card to a different column updates its status to that column's status.
- AS-070: Dragging a task card to a new position within the same column updates its stored position without changing its status.
- AS-071: A task's position is persisted using a fractional index (numeric `position` column), not an integer sequence requiring rewrites of sibling rows.
- AS-072: Moving a card between two existing cards assigns it a position value strictly between its new neighbors.
- AS-073: Moving a card to the top of a column assigns it a position less than the current first card's position.
- AS-074: Moving a card to the bottom of a column assigns it a position greater than the current last card's position.
- AS-075: After a drag-and-drop reorder, reloading the page shows the cards in the exact order they were left in.
- AS-076: Two users viewing the same board see a card move to its new column within a few seconds of the other user's drag action, without a manual refresh (Realtime).
- AS-077: A card's optimistic UI position during drag reverts correctly if the server update fails (e.g. network error).
- AS-078: Within a column, cards are ordered by their `position` value ascending.
- AS-079: A newly created task is appended to the end of its column's position order.
- AS-080: Dragging a task does not change its `updated_at`-driven "recently edited" indicators unless status also changed.
- AS-081: The board view does not show soft-deleted tasks even momentarily during a drag operation.
- AS-082: Repeated drag operations on the same card in rapid succession do not corrupt its position (no duplicate or NaN position values).
- AS-083: The board's column task counts update immediately after a drag-and-drop move.
- AS-084: A workspace member with only `member` role (not admin/owner) can perform drag-and-drop reordering — board interaction is not permission-gated beyond workspace membership.

## List / table view (AS-085–AS-093)

- AS-085: The list view shows all non-deleted tasks in the current project as rows with title, status, priority, assignee, and due date columns.
- AS-086: The list view can be filtered by status.
- AS-087: The list view can be filtered by priority.
- AS-088: The list view can be filtered by assignee.
- AS-089: Filters can be combined (e.g. status=in_progress AND priority=high) and narrow results accordingly (AND semantics).
- AS-090: Clearing all filters restores the full unfiltered task list.
- AS-091: The list view can be sorted by due date ascending or descending.
- AS-092: An empty filtered result set shows an explicit "no tasks match" state, not a blank area.
- AS-093: Editing a task's status from a dropdown in the list view persists and is reflected on the board view without a full page reload.

## Comments (AS-094–AS-104)

- AS-094: A workspace member can add a text comment to a task.
- AS-095: An empty comment cannot be submitted; the submit action is disabled or rejected.
- AS-096: Comments on a task are displayed in chronological order, oldest first.
- AS-097: Each comment shows its author and a relative timestamp.
- AS-098: A comment's author can delete their own comment.
- AS-099: A user who is not the comment's author and not a workspace admin/owner cannot delete another member's comment; the action is unavailable in the UI and rejected server-side if attempted directly.
- AS-100: A workspace admin or owner can delete any comment in their workspace.
- AS-101: Deleting a comment soft-deletes it; it disappears from the task's comment list for all viewers, including those with an open live view (Realtime).
- AS-102: A soft-deleted comment does not reappear after a page reload.
- AS-103: New comments appear in real time for other users viewing the same task without a manual refresh.
- AS-104: A user viewing a task in one workspace cannot see comments belonging to a task in a different workspace, even via direct API access.

## Attachments (AS-105–AS-115)

- AS-105: A workspace member can upload a file attachment to a task.
- AS-106: An uploaded attachment is stored in a private Supabase Storage bucket, not a publicly listable one.
- AS-107: A user who is not a member of the attachment's workspace cannot generate a working signed URL for that file, even with the file's storage path guessed.
- AS-108: An attachment's download link is a time-limited signed URL, not a permanent public URL.
- AS-109: A task shows a list of its attachments with file name and uploader.
- AS-110: An attachment can be deleted by its uploader or a workspace admin/owner.
- AS-111: A member who is neither the uploader nor an admin/owner cannot delete another member's attachment.
- AS-112: Uploading a file larger than the configured size limit is rejected with a clear error before the upload completes.
- AS-113: Uploading a file of a disallowed MIME type is rejected with a clear error.
- AS-114: Deleting a task also removes (or orphan-safely detaches) its attachments' storage objects — no permanently orphaned unreferenced files accumulate silently without at least being logged.
- AS-115: The attachment list updates immediately in the UI after a successful upload, without requiring a page reload.

## Search (AS-116–AS-124)

- AS-116: A workspace member can search for tasks by typing into a search box.
- AS-117: Search matches against task title and description (full-text).
- AS-118: Search results are scoped to the active workspace only.
- AS-119: A search query matching no tasks shows an explicit empty state, not a blank screen.
- AS-120: Search results link directly to the matching task's project/board context.
- AS-121: Search excludes soft-deleted tasks.
- AS-122: A search for a term that only appears in a task belonging to a different workspace returns no results for the searching user.
- AS-123: Search is case-insensitive.
- AS-124: Search results are ranked with exact title matches appearing before partial description-only matches.

## Dashboard & aggregates (AS-125–AS-136)

- AS-125: The workspace home dashboard shows a bar chart of task counts grouped by priority, scoped to the active workspace.
- AS-126: The dashboard shows a pie chart of task counts grouped by status, scoped to the active workspace.
- AS-127: Dashboard aggregate counts are computed via a database query (view/RPC), not by fetching the full task list to the client.
- AS-128: Dashboard aggregates exclude soft-deleted tasks.
- AS-129: Dashboard aggregates exclude tasks from archived projects unless explicitly toggled to include them (default: exclude).
- AS-130: A workspace with zero tasks shows an empty-state dashboard, not an error or blank chart.
- AS-131: The dashboard shows a count of overdue tasks (due date in the past, status not `done`).
- AS-132: Switching the active workspace updates all dashboard figures to the new workspace's data.
- AS-133: A member of workspace A querying dashboard aggregates cannot retrieve counts that include workspace B's tasks via direct API manipulation.
- AS-134: The dashboard's task table (if present) supports the same status/priority filters as the list view.
- AS-135: Dashboard chart colors are consistent with the status/priority color coding used elsewhere in the app (board columns, priority badges).
- AS-136: Dashboard data loads within the performance budget defined in tech-decisions.md under normal (v1-scale) data volume.

## Security / RLS cross-cutting (AS-137–AS-148)

- AS-137: Every table containing workspace-scoped data has Row Level Security enabled; RLS is not relied on the application layer alone.
- AS-138: A request using the anon/publishable key without a valid session cannot read any workspace, project, task, comment, or attachment row.
- AS-139: A request using a valid session but no workspace membership cannot read that workspace's rows via any table, including through a join (e.g. selecting tasks by project_id without workspace membership).
- AS-140: The Supabase secret key (service role equivalent) is never present in any client-shipped bundle or exposed to the browser.
- AS-141: All environment variables containing credentials are absent from the git history (verified via `.gitignore` covering `.env*` except `.env.example`).
- AS-142: `.env.example` lists every required environment variable key with no real values.
- AS-143: Server Actions that mutate data re-check workspace membership server-side, not solely relying on RLS as the only guard (defense in depth for clearer error messages).
- AS-144: A malformed or tampered workspace ID in a URL does not leak any data about that workspace's existence to a non-member (returns generic not-found, not a permission-denied that confirms existence).
- AS-145: Rate-limiting or abuse protection is not required for v1 per discovery answers, but the sign-in magic-link request endpoint is not trivially abusable to spam arbitrary emails (Supabase Auth's built-in throttling is relied upon and documented, not reimplemented).
- AS-146: All Server Actions validate their input shape (e.g. via Zod) before touching the database; malformed input returns a validation error, not a raw database error.
- AS-147: SQL injection is not possible through any user-supplied search or filter input — all queries use parameterized Supabase client calls, never raw string-concatenated SQL.
- AS-148: XSS is not possible through task titles, descriptions, or comments — user content is rendered as text, never as raw HTML.

## Quality, performance, accessibility (AS-149–AS-160)

- AS-149: Critical-path automated tests exist for: auth flow, workspace RLS isolation, task CRUD, board drag-and-drop position persistence, and comment CRUD (per discovery Q26: critical paths only).
- AS-150: The board drag-and-drop feature has one Playwright end-to-end test that drags a card and asserts the persisted order survives a reload (per discovery round-2 Q15).
- AS-151: All interactive elements (buttons, form fields, drag handles) are reachable and operable via keyboard alone.
- AS-152: All interactive elements have accessible names (via visible text, `aria-label`, or associated `<label>`).
- AS-153: Color is never the sole means of conveying status or priority — each also has a text label or icon.
- AS-154: The app meets WCAG AA contrast ratios for text on its default light theme.
- AS-155: A page's primary content is server-rendered (visible in initial HTML) for all authenticated workspace, project, and task views — not client-fetched-only.
- AS-156: The 95th-percentile server response time for a project's board data fetch is under 500ms at v1 data volumes (per discovery Q27), measured in a local/staging environment.
- AS-157: The application builds successfully with zero TypeScript errors.
- AS-158: The application has zero ESLint errors (warnings permitted) at every milestone boundary.
- AS-159: The README documents how to run the app locally, run tests, and the required environment variables (per discovery Q30: README + API docs).
- AS-160: Every Server Action and exported utility function referenced by an assertion has type-safe input/output (no `any` used to bypass a type error).
