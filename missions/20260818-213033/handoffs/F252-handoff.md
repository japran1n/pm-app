# Handoff: F252 — empty states across every view

## Status
COMPLETE

## Assertions covered
AS-490: PASS — every primary view has a purposeful empty state that explains itself and offers its main action (or, correctly, no action for a permission-limited/non-actionable surface). Audited exhaustively (list below); one real gap found and fixed (audit log). New tests: `test_AS_490_audit_no_entries_yet_shows_purposeful_empty_state`, `test_AS_490_audit_no_matches_for_filters_shows_filtered_empty_state`, `test_AS_490_audit_table_renders_rows_when_present_not_empty_state` in `tests/unit/audit-table-empty-state.test.ts`, all passing.

## Enumeration of every surface checked (disposition)

- **Board** (`components/board/board-empty-state.tsx`) — already compliant (F032/F042): icon, headline, sentence, "Create task" + "New from template" actions, permission-aware via the actual `NewTaskDialog`.
- **Board column (per-column, non-empty project)** (`components/board/board-column.tsx`) — already compliant: distinct lightweight "No tasks" inline message (correctly not the full BoardEmptyState, reserved for whole-project-empty).
- **Board swimlanes** (`components/board/swimlane.tsx`) — reuses BoardColumn's per-column empty message per (lane, column) pair; no separate empty-state logic needed. Already compliant.
- **List view** (`components/task/task-list-table.tsx`, list page) — already compliant (F056 + M16 filtering follow-up): explicit split between "No tasks yet in this project" and "No tasks match your filters", with a `clearFiltersHref` affordance for the latter.
- **My Tasks** (`app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx`) — already compliant (F230/F231, AS-440): purposeful empty state, copy varies by "assigned to you" vs "assigned to or watched by you" scope.
- **Calendar** (`app/.../calendar/page.tsx`) — already compliant (F235, AS-446): deliberately NOT the generic EmptyState pattern per that feature's own documented reasoning ("poor fit for 'no tasks this month'" — a routine, expected state, not a call to action); has its own `data-testid="calendar-empty-message"`.
- **Timeline** (`app/.../timeline/page.tsx`) — already compliant, same reasoning as calendar (`data-testid="timeline-empty-message"`).
- **Search results** (`app/.../search/page.tsx`) — already compliant (AS-116/AS-119): three explicit states — neutral prompt (no query), "No results for ..." (no match), populated — never a blank screen.
- **Command palette** (`components/command/command-palette.tsx`) — already compliant: `<CommandEmpty>` distinguishes "Type to search..." (empty query) from "No results found." (query with no matches).
- **Dashboard** (`components/dashboard/dashboard-content.tsx`, workspace home) — already compliant (F074, AS-130): explicit error/empty/populated three-way branch, `data-testid="dashboard-empty-state"`. No tables on this page beyond the charts — nothing further to check.
- **Projects list** (`app/.../projects/page.tsx`) — already compliant: "No projects yet" state.
- **Templates** (`app/.../templates/page.tsx`) — already compliant (AS-330 UI half): purposeful empty state, deliberately no primary action (a template can't be created from this empty state per that feature's own note).
- **Trash** (`app/.../trash/page.tsx`) — already compliant (F188): distinguishes "Trash is empty" (nothing deleted) from "No matching items" (type filter active but no match), via `allItems.length === 0` vs `items.length === 0`.
- **Archive** (`app/.../archive/page.tsx`) — already compliant (AS-256): same structural pattern as board's empty state.
- **Members** (`app/.../settings/members/page.tsx`) — already compliant: "No active members yet." and "No pending invites." as two separate, correctly-scoped empty messages.
- **Notifications** (bell popover + full page, `components/notifications/notification-panel.tsx`) — already compliant (F208): "You're all caught up. No notifications yet."
- **Attachments** (`components/task/attachment-list.tsx`) — already compliant: "No attachments yet. Upload a file to get started."
- **Comments** (`components/task/comment-list.tsx`) — renders nothing extra when empty (a task detail sheet with zero comments just shows the composer); this matches the existing convention for this section and isn't an assigned regression — left as-is, not a primary "view" in the AS-490 sense (a task-detail sub-section, same tier as checklist/dependencies below, all of which DO have explicit empty copy so comments' silent-empty was checked deliberately and judged acceptable: the composer itself is the affordance, and inventing a "no comments yet" line above an already-visible composer add no value). Recorded here rather than silently changed, per this feature's audit-and-fix pattern.
- **Activity feed** (`components/task/activity-feed.tsx`) — already compliant: "No activity yet."
- **Checklist** (`components/task/checklist.tsx`) — already compliant: "No checklist items yet. Add one below."
- **Subtasks** (`components/task/subtask-list.tsx`) — already compliant: "No subtasks yet. Add one below."
- **Dependencies** (`components/task/dependencies.tsx`) — already compliant: "Not blocked by any task." / "Doesn't block any task." per-section, plus "No matching tasks." in the picker.
- **Time entries** (`components/task/time-tracking.tsx`) — already compliant: "No time logged yet."
- **Saved views** (`components/views/view-switcher.tsx`) — already compliant (F229): "No saved views yet. Set your filters, then use 'Save view' to..."
- **Audit log** (`components/audit/audit-table.tsx`, `app/.../settings/audit/page.tsx`) — **GAP FOUND AND FIXED**. The table rendered the identical string "No audit log entries match the current filters" both when the workspace genuinely had zero audit entries (no filters applied) and when a filter combination matched nothing — failing to distinguish "nothing yet" from "nothing matches your filters" as this feature's spec explicitly calls out. Fixed: `AuditTable` now takes a `hasActiveFilters` boolean (computed by the page from `actorIdParam`/`actionParam`) and renders one of two purposeful `EmptyState` variants — "No audit activity yet" (nothing filtered) vs "No matching entries" with a "try a different actor or action" hint (filtered). No primary action is offered either way — audit entries are system-generated, not user-created, so there is nothing to "create" from this empty state; correctly matches the clarified "must not offer an action a user cannot perform" rule by offering none.

## Files changed
components/empty-state.tsx (new — shared EmptyState building block: icon, headline, sentence, optional action)
components/audit/audit-table.tsx (empty-state branch split into "nothing yet" vs "nothing matches filters", using the new shared component)
app/(workspace)/w/[workspaceSlug]/settings/audit/page.tsx (passes `hasActiveFilters` to AuditTable)
tests/unit/audit-table-empty-state.test.ts (new)

## Commands run
`npx tsc --noEmit` (0, no output)
`npx eslint .` (0 errors, 6 warnings — same 6 pre-existing warnings as baseline: lib/queries/search.ts:280, tests/unit/invite-member-pagination.test.ts:186, tests/unit/palette-actions-recents.test.tsx:55×2,74×2 — none added by this feature)
`npx vitest run tests/unit` (144 files / 1102 tests, all passed — up from baseline 143 files/1099 tests by exactly the 1 new file / 3 new tests this feature added; 1 pre-existing unrelated unhandled-rejection flake logged from tests/unit/user-avatar.test.tsx, `cookies() outside request scope` inside comment-list's mention-candidate effect — unrelated to this feature, does not fail the run)
`npx next build` (0 — "Compiled successfully", all routes generated, no new warnings)

## Decisions made
- Built one shared `EmptyState` component (`components/empty-state.tsx`) per the spec's draft scope, but did NOT retrofit it onto the many already-compliant, already-tested inline empty states (board, trash, archive, templates, my-tasks, etc.) — retrofitting working, tested, already-purposeful markup onto a new shared primitive is a pure refactor with no assertion-visible behavior change and non-zero regression risk against each surface's existing tests/screenshots; the clarified "fix it inside this feature's file scope... gaps outside scope go to Out-of-scope" answer plus "already compliant is a valid documented outcome" both point at only touching the actual gap. Used the new shared component for the one surface that needed a genuine fix (audit log), demonstrating it's ready for reuse by future workers per the spec's intent.
- Comments section: judged the existing "no explicit empty message, composer only" pattern as an acceptable, deliberate design (composer is itself the affordance) rather than a gap — documented rather than silently changed, per the audit-and-fix pattern's own instruction to record findings even when no change is made.
- Audit log empty state offers no primary action in either variant, since audit entries cannot be user-created — satisfies the clarified "must not offer an action a user cannot perform" rule via omission rather than a disabled/guarded button.
- `hasActiveFilters` is derived from `actorIdParam || actionParam` (the same two params `getAuditLogPage` already filters on) rather than introducing a second computed flag inside `AuditTable` itself — keeps one source of truth for "is a filter active" at the page level, consistent with how the page already resolves all query params before rendering.

## Out-of-scope work needed
None identified beyond what's already covered by other milestone features. No new gaps found requiring a follow-up feature.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Left comments' silent-empty state as-is rather than adding a "No comments yet" line, reasoning that the composer already visible below is a sufficient and non-redundant affordance — the simpler option (no change) that adds no new dependency, per the clarified ambiguity-resolution rule.
AUTONOMOUS_DECISION: Did not retrofit the new shared EmptyState component onto pre-existing, already-tested inline empty-state markup across other surfaces — treated as out of this feature's fix-the-gap scope, not a refactor mandate.

## Notes for the next worker
- `components/empty-state.tsx` is now available for any future surface that needs an icon/headline/sentence/action empty state — prefer it over hand-rolled markup going forward.
- The audit log's `AuditTable` component had no existing unit tests before this feature; `tests/unit/audit-table-empty-state.test.ts` is the first coverage for it.
- No MCP tools used — this feature required no live schema/policy changes (pure UI/copy fix), consistent with the spec's "MCP at run: none."
