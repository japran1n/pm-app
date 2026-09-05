# Discovery Round 2

_Captured: 2026-08-30T22:50:00Z_
_Answers derived from codebase inspection (components/, lib/, supabase/migrations/, tests/)._

Based on round-1 answers and codebase state, these gaps need clarifying.

---

**1. Which pages/views currently LACK realtime sync and need it added?**
- (a) My Tasks only
- (b) My Tasks + Calendar
- (c) My Tasks + Calendar + Timeline
- (d) My Tasks + Calendar + Timeline + Search results ← chosen

_Rationale: board, task list (project list view), chat, comments, notifications already have realtime hooks. My Tasks (personal-todo-list.tsx — 149 lines, no realtime import), Calendar, Timeline, and Search have none._

**2. Where are optimistic updates currently MISSING (server round-trip blocks UI)?**
- (a) Only in task detail sheet field edits
- (b) Task detail sheet + bulk status action
- (c) Task detail sheet + inline title edit in list + My Tasks toggles ← chosen
- (d) Everywhere — no optimistic updates exist yet

_Rationale: list-status-select, list-priority-select, list-assignee-cell all use manual useState-based optimistic (but not React.useOptimistic). list-due-date-cell appears to lack even that. Task detail sheet field edits (title, description, status, priority inline) and My Tasks checkbox toggles wait for server._

**3. Inline task create in the list view (without opening the full dialog) — scope?**
- (a) Not needed — 'n' shortcut opening the dialog is enough
- (b) One inline row at bottom of list, title only
- (c) Inline row with title + status + priority picker ← chosen
- (d) Inline row with all fields, same as the dialog

_Rationale: Linear-style quick-add row at the bottom of each status group is the highest-value UX win. Title + status + priority is the minimum useful set; all fields would duplicate the dialog._

**4. Keyboard navigation scope for the task list — what should work?**
- (a) j/k to move focus between rows only
- (b) j/k move + Enter opens detail sheet ← chosen
- (c) j/k move + Enter opens + e to edit inline + all field shortcuts
- (d) Full vim-mode (h/j/k/l, yank/put, marks)

_Rationale: j/k + Enter matches Linear's navigation model and covers the main use case. Full vim-mode is overkill for a PM tool._

**5. Command palette actions to ADD (beyond current: create task, create project, toggle theme)?**
- (a) Navigation only (go to My Tasks, go to Settings, etc.)
- (b) Navigation + go-to-project shortcuts (g+p, g+m, g+c)
- (c) Navigation + task actions (change status, assign, set priority on focused task) ← chosen
- (d) Navigation + task actions + bulk workspace commands

_Rationale: go-to shortcuts (g then p/m/c) are standard in Linear; task actions from palette on the currently-open task would be the next big step. Bulk workspace commands are scope creep._

**6. Realtime filtering — do realtime events need to be filtered by the user's RBAC visibility?**
- (a) No — all workspace members see all task changes
- (b) Yes — project-private tasks must only arrive at users who can see the project ← chosen
- (c) Yes, and also filter by assignee (only see tasks assigned to you)
- (d) Not yet needed — all projects are visible to all members

_Rationale: the app has project-level visibility (is_project_visible_to helper used in RLS). Realtime events must go through the same filter so a member can't observe private-project task changes via the WS channel._

**7. My Tasks realtime — what events should trigger a live update?**
- (a) Only tasks assigned to me created/deleted
- (b) Tasks assigned to me: create/delete/status-change ← chosen
- (c) Tasks assigned to me + @mentions in comments
- (d) All of the above + due-date reminders in real time

_Rationale: create/delete/status-change is the minimum that makes the My Tasks list feel live. @mentions are handled by the existing notifications realtime. Due-date reminders are a separate notification concern._

**8. Calendar realtime — what should update live?**
- (a) Due-date changes only (task moves between days)
- (b) Due-date changes + new tasks appearing on the calendar ← chosen
- (c) Due-date + status changes (e.g. completed tasks grey out live)
- (d) Full task update — any field change refreshes the calendar card

_Rationale: the calendar is due-date driven; moving a task to a new day and new tasks appearing are the most disruptive things to miss. Status greyout in real time would be nice but can be a follow-up._

**9. Optimistic rollback UX — what happens when a server action fails?**
- (a) Silent revert (UI snaps back, no message)
- (b) Toast error + revert ← chosen
- (c) Inline error badge on the cell that failed + revert
- (d) Retry dialog

_Rationale: board-optimistic-rollback-toast.test.ts already establishes the "toast + revert" pattern for the board. Inline cell errors are more precise but much more complex to implement; toast is consistent with existing patterns._

**10. Quick-add inline row in list view — where does it appear?**
- (a) Always at the very bottom of the full task list
- (b) At the bottom of each status group (like Kanban columns but in list form) ← chosen
- (c) Triggered by clicking a "+" icon in the table header
- (d) Floating action button fixed at bottom-right

_Rationale: the list view already groups tasks by status (task-list-table.tsx has collapse/expand per group). A per-group quick-add row matches that mental model and is consistent with how board quick-add (components/board/quick-add.tsx) works._

**11. Keyboard shortcut for "go to" navigation — which target keys?**
- (a) g+m (my tasks), g+p (projects list)
- (b) g+m, g+p, g+c (chat), g+s (settings) ← chosen
- (c) g+m, g+p, g+c, g+s, g+d (docs), g+t (time)
- (d) No go-to shortcuts — palette navigation is enough

_Rationale: My Tasks, Projects, Chat, Settings are the 4 destinations users navigate to most often. Docs and Time are secondary. The palette already covers discovery; go-to shortcuts are for muscle-memory fast paths._

**12. Task detail sheet — which fields should support inline keyboard editing?**
- (a) Title only (most disruptive to miss)
- (b) Title + status + priority ← chosen
- (c) Title + status + priority + assignee + due date
- (d) All fields (same as list inline editors)

_Rationale: title is the highest-frequency edit. Status and priority follow. Assignee/due-date are less frequent and the existing popover UX works fine for them; keyboard shortcuts for those can be a follow-up._

**13. Search full-text — is pg_trgm currently indexed on tasks.title?**
- (a) Yes, GIN index on tsvector column
- (b) No index — ILIKE query on title ← chosen
- (c) Indexed with pg_trgm trigram index
- (d) Unknown — haven't checked migrations

_Rationale: inspecting supabase/migrations/ shows no CREATE INDEX with tsvector or trgm on tasks. The palette-search server action likely does ILIKE. A GIN index on to_tsvector(title) would be a free win alongside the UX improvements._

**14. Inline title editing in the task list — optimistic or server-confirmed?**
- (a) No inline title editing in list — click row to open sheet
- (b) Double-click cell → inline edit → optimistic update while saving ← chosen
- (c) Single-click → immediate inline edit
- (d) F2 key → inline edit

_Rationale: double-click is standard for inline edit (Excel, Notion, Linear). F2 is a nice alias. Single-click is too easy to trigger accidentally on a row that also opens the sheet on click._

**15. Scope boundary — Kanban board is explicitly excluded. What else is out of scope?**
- (a) Only Kanban board excluded; all other views in scope
- (b) Kanban + Timeline (complex drag, different data shape)
- (c) Kanban + Timeline + Client Portal (different auth context) ← chosen
- (d) Kanban + Timeline + Client Portal + Docs editor

_Rationale: Timeline (Gantt) has its own drag-reorder model that would need separate realtime/optimistic treatment. Client Portal runs under a different auth context (guest/client role) and realtime filtering for it is a separate concern. Docs editor already has Tiptap autosave and is out of scope for this mission._
