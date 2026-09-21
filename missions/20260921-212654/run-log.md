# Run log — baseline (captured before F001 edits)

_2026-09-21_

## `npx tsc --noEmit`
Exit code: 0
No errors.

## `npx eslint .`
Exit code: 1
216 problems (66 errors, 150 warnings) on HEAD, all pre-existing. Full list at
`/tmp/baseline-eslint.txt` (not committed — ephemeral). Most errors are in
`.claude/worktrees/**` scratch dirs and pre-existing test files unrelated to
F001 (e.g. `jsx-a11y/aria-role` in `tests/unit/f251-inline-edit-permissions-realtime.test.tsx`,
`tests/unit/permission-aware-ui-gating.test.tsx`; `no-explicit-any` in an
`.claude/worktrees/...` spec file; unused-var warnings). None touch
`components/nav/app-sidebar.tsx` or the settings page.

## `npx vitest run`
Exit code: non-zero (pre-existing).
Test Files: 654 failed | 1162 passed | 4 skipped (1820 total) on HEAD.
The large failure count is dominated by integration/RLS test suites that
require live network/Supabase access unavailable in this sandboxed run
(e.g. `tests/integration/rls-*.test.ts`, `tests/integration/f126-auth-pool.test.ts`,
`tests/integration/db-task-keys.test.ts`) plus scratch files under
`.claude/worktrees/**`. Full failing-file list (299 non-worktree files)
captured for before/after diffing during F001's own test run.

## `npm run migrations:check`
Exit code: 0
"No migration drift — all migrations present on remote."

## Purpose
This baseline is used by SB-002 (typecheck not worse) and the Definition of
Done's "no new failing test files vs baseline" check for F001. F001 only
touches `components/nav/app-sidebar.tsx` and verifies
`app/(workspace)/w/[workspaceSlug]/settings/page.tsx` already links to
Members (no edit needed there — link already present).
