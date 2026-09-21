# Handoff: F014 — remove old dashboard components

## Status
COMPLETE

## Assertions covered
AS-090: PASS — All listed old dashboard component files (priority-bar-chart.tsx, status-pie-chart.tsx, dashboard-task-table.tsx, dashboard-content.tsx, dashboard-content-lazy.tsx, dashboard-skeleton.tsx) are deleted from components/dashboard/.
AS-091: PASS — dashboard-retry-button.tsx was checked for remaining imports (only referenced by dashboard-content.tsx, which is also deleted) and removed.
AS-092: PASS — grep for old import names/identifiers (priority-bar-chart, status-pie-chart, dashboard-task-table, dashboard-content, dashboard-content-lazy, dashboard-skeleton, DashboardContent, DashboardTaskTable, PriorityBarChart, StatusPieChart, DashboardContentLazy, DashboardSkeleton, DashboardRetryButton) returns zero hits in real `.ts`/`.tsx` source outside of stale prose comments (no actual imports/JSX usage remain).
AS-093: PASS — `npx tsc --noEmit` exits 0 after deletions.
AS-094: PASS — Unit test files that exclusively tested the deleted components were deleted (dashboard-empty-state.test.ts, dashboard-chart-colors.test.ts, f087-priority-bar-chart-svg-rewrite.test.tsx); user-avatar-call-sites.test.ts, which was NOT exclusive to a deleted component, had only its one dashboard-task-table-specific `it` block removed so it no longer reads a deleted file.

## Files changed
components/dashboard/priority-bar-chart.tsx (deleted)
components/dashboard/status-pie-chart.tsx (deleted)
components/dashboard/dashboard-task-table.tsx (deleted)
components/dashboard/dashboard-content.tsx (deleted)
components/dashboard/dashboard-content-lazy.tsx (deleted)
components/dashboard/dashboard-skeleton.tsx (deleted)
components/dashboard/dashboard-retry-button.tsx (deleted)
tests/unit/dashboard-empty-state.test.ts (deleted)
tests/unit/dashboard-chart-colors.test.ts (deleted)
tests/unit/f087-priority-bar-chart-svg-rewrite.test.tsx (deleted)
tests/unit/user-avatar-call-sites.test.ts (removed one obsolete `it` block referencing dashboard-task-table.tsx)

## Commands run
`grep -r "priority-bar-chart|status-pie-chart|dashboard-task-table|dashboard-content|..." --include="*.ts" --include="*.tsx" .` (0, confirmed only stale comments remain, no imports)
`npx tsc --noEmit` (0)
`npx vitest run tests/unit tests/integration` (background run — see notes below on pre-existing unrelated failures)
`git commit` (0)

## Decisions made
- Deleted `dashboard-retry-button.tsx` because its only consumer, `dashboard-content.tsx`, was also deleted in this feature — confirmed via grep before removing.
- Kept comment-only mentions of deleted file paths in `components/time/*`, `components/architecture/architecture-view-toggle.tsx`, `components/task/task-list-table.tsx`, `components/task/task-card.tsx`, `components/dashboard/kpi-tile.tsx`, `components/onboarding/sample-project-offer.tsx`, `tests/unit/task-key-display-render.test.ts`, `tests/integration/dashboard-task-table-filters.test.ts`, and `tests/integration/f223-status-integration-list-search-dashboard.test.ts` — these are historical/explanatory prose comments referencing old file paths, not actual imports or code dependencies, and editing them was out of this feature's stated scope (deleting files + fixing broken imports/tests, not scrubbing comments).
- `tests/unit/user-avatar-call-sites.test.ts` was not itself exclusively about a deleted component (it verifies `<UserAvatar>` usage across ~9 different surfaces), so per the spec's "check if a file is still imported somewhere unexpected... do NOT delete it" guidance, I did not delete the file. Instead I removed only the single `it` block that read `components/dashboard/dashboard-task-table.tsx` via `readFileSync`, since that surface was already migrated into `TaskListTable` in a prior feature and the assertion it encoded (AS-214, "dashboard table composes shared component") is out of scope for F014 to re-litigate — the surrounding 9 other surface checks in that file were left untouched and still pass.

## Out-of-scope work needed
- `.claude/worktrees/agent-a4d181b015eaa43cf/` is a separate, git-excluded (`.git/info/exclude`) worktree checkout that still contains copies of all the now-deleted dashboard files and their old tests. It is not part of the tracked codebase and `git status`/`git diff` show it as clean/untracked-ignored, but it does get picked up by a bare `vitest run` (no path filter) because vitest globs by filename pattern across the whole working directory, producing ~298 unrelated "failing" test files when running the full suite without an `--exclude` flag. This is pre-existing environment clutter unrelated to F014 (confirmed via `git stash` that the same failures — th-extraction.test.ts, th-preview-pane.test.tsx locale mismatches, etc. — exist independent of this feature's changes) and cleanup of that worktree is out of scope here; a future feature/orchestrator task should remove it or the orchestrator should default `vitest.config.ts` to exclude `.claude/worktrees/**`.
- During this worker's session, an unrelated commit (`ee3e130f feat(preview-as-client): redesign page with sidebar...`, made by a different concurrent process/agent) landed on `main` and happened to include my staged `git rm` deletions for this feature bundled into its own diff. The deletions themselves are correct and match this feature's scope, but the commit message/attribution for those seven component + three test file deletions is not this feature's. No action needed since content is correct, but flagging for the orchestrator in case commit-message provenance for F014's deletions is checked — they physically landed in `ee3e130f`, not in the `feat(F014): ...` commit made afterward (which only contains the `user-avatar-call-sites.test.ts` edit).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Removed only the single dashboard-specific `it` block in `tests/unit/user-avatar-call-sites.test.ts` rather than deleting the whole file, since the file is not exclusive to the deleted components (per DoD instruction to only delete files that "exclusively test deleted components"). This keeps the other 9 avatar-surface assertions intact.
AUTONOMOUS_DECISION: Left prose/comment-only references to deleted file paths in place (they don't affect `tsc`, tests, or runtime behavior) since the spec's grep check targets active imports/usages, not historical comments, and rewriting every comment across ~9 unrelated files was outside this feature's declared scope.

## Notes for the next worker
- Full-repo `npx vitest run` (no path args) currently reports ~298 failing test files, but this is entirely attributable to pre-existing issues: (1) the stale `.claude/worktrees/agent-a4d181b015eaa43cf` checkout being globbed in, and (2) genuinely pre-existing failures unrelated to dashboards (e.g. `th-preview-pane.test.tsx` expecting Croatian-locale text `"Nema pregleda"` against English `"No preview"` output, `th-extraction.test.ts` ordering assertions). Verified via `git stash` that these same failures exist with F014's changes reverted, so none of them were introduced by this feature.
- To scope a test run to just the real repo, use `npx vitest run --exclude ".claude/worktrees/**" tests/unit tests/integration` or target specific files directly by absolute path plus `--exclude`, since vitest otherwise picks up same-named files from the stale worktree even when you pass an explicit relative path.
- `npx tsc --noEmit` is clean (exit 0) after all deletions.
