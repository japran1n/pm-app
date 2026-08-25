# Handoff: F271 — documentation update (README/docs v2)

## Status
COMPLETE

## Assertions covered
AS-529: PASS — README.md now documents every new feature area shipped M10–M19 (identity/profiles, roles & permissions, audit log & archive, task keys/subtasks/checklists/dependencies/multi-assignee/watchers, rich text/recurrence/templates/bulk actions/trash, activity/comments/reactions/mentions/notifications, custom statuses/swimlanes/saved views/my-tasks/calendar/timeline, command palette/shortcuts/deep-links/quick-add/inline-edit, empty-states/onboarding/skeletons/error-boundaries, attachments/sidebar/mobile/header-search, and the QA feedback browser extension), every env var actually read via `process.env.` in application/test code (verified by repo-wide grep, not by copying the stale table), and the two real `cron.schedule()` jobs found by grepping `supabase/migrations/` (with their actual `0 * * * *` hourly schedules and function names) — plus a role/permission matrix sourced from the real predicates in `lib/auth/permissions.ts` and a "what changed since v1" section. Verified by direct read-through of the rewritten README (no automated test applies to prose; this assertion is structural, per the feature's own Definition of done: "a written enumeration of what was inspected").

## Files changed
README.md

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 6 pre-existing warnings in lib/queries/search.ts, tests/unit/invite-member-pagination.test.ts, tests/unit/palette-actions-recents.test.tsx — unrelated to this change)
`npx vitest run tests/unit` (0 — 167/167 test files, 1305/1305 tests pass; one stray unhandled-rejection log line attributed to `tests/unit/user-avatar.test.tsx` is pre-existing test-environment noise, not a failed assertion — file untouched by this feature)
`npx next build` (0 — production build succeeds, route manifest confirms calendar/timeline/my-tasks/trash/audit/templates/extension routes all exist as documented)

## Decisions made
- Grepped `process.env.` across the whole repo (excluding node_modules/.next/dist) rather than trusting the existing README table or `.env.example`, per the "audit, don't assume" instruction. Found `SUPABASE_ACCESS_TOKEN` and `PLAYWRIGHT_PORT` are real env vars read by code but are dev/test-tooling-only (Playwright port override, Supabase Management API token for integration tests) — documented them in prose rather than adding them to `.env.example`'s app-runtime table, since they aren't consumed by the running app itself.
- Grepped `supabase/migrations/` for `cron.schedule(` calls rather than trusting the spec's assumption of three jobs (recurrence, overdue sweep, digest). Found only **two** real jobs — `generate-due-recurring-occurrences` and `notify-overdue-task-assignees`, both hourly (`0 * * * *`). The digest job does not exist because F213–F217 (email/Resend) are `[SKIPPED]` per `plan.md` and `mcp-registry.md` confirms Resend is "Not connected." Documented this explicitly (no third cron job, no digest) rather than inventing one to match the spec's phrasing — this is the "already resolved by the simpler option, no invented dependency" clarification rule (Round B follow-up 2).
- Read `lib/auth/permissions.ts` directly (not from memory/spec) to build the role/permission matrix: workspace roles are `owner`/`admin`/`member`/`viewer`/`guest`, project role is `lead`/`member`/null. Matrix rows map 1:1 to real exported predicates (`canManageMembers`, `canViewAudit`, `canManageColumns`, `canChangeProjectVisibility`, `canManageProjectMembers`, `canWrite`, `canEditTask`, `canDeleteTask`, `canManageTemplate`, `canManageSavedView`, `canPurge`, `canDeleteWorkspace`).
- Corrected two stale claims in the pre-existing "Known limitations (v1)" section rather than leaving them: "No Timeline/Gantt view" is now false (M16 shipped `/w/[workspaceSlug]/timeline`, confirmed in the `next build` route manifest) and "Single assignee per task only" is now false (M13 added a `task_assignees` join table and multi-assignee support, confirmed via grep of `lib/actions/templates.ts` and `lib/actions/tasks.ts`). Fixing stale-but-adjacent claims inside the file this feature already owns (README.md) is in scope per the feature's own file list; I did not touch code to "fix" the limitations, only the doc claiming they still exist.
- Did not modify `.env.example` — verified it already lists every env var the running app itself reads (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_PROJECT_REF`, `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `EXTENSION_HANDOFF_SECRET`, `EXTENSION_ID`); it was already accurate, just not fully reflected in the README's table, which I fixed instead.
- Did not touch `DOCS.md` despite it being in the feature's approximate file list — read it fully first and confirmed it documents the *Claude Missions orchestration framework itself* (phases, roles, skills), not the pm-app product; it has no product feature/env-var/cron content to update for AS-529. Left it untouched rather than force an edit into a file where the assertion doesn't apply.

## Out-of-scope work needed
- Saved views are not wired into board/calendar/timeline (only list view) — already tracked as a known follow-up in `NEXT-SESSION.md`; documented as a limitation in README rather than fixed here (out of this feature's file scope).
- No code changes were made or needed — this was a pure documentation audit; no functional gap requiring a follow-up feature was found within AS-529's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Where the spec's draft scope said "three pg_cron jobs (recurrence, overdue sweep, digest)" but the codebase only has two real jobs (digest was skipped with the rest of email), documented the true state (two jobs, digest explicitly absent and why) rather than describing a nonexistent third job — this is what AS-529 ("documents ... scheduled jobs" — plural, accurate) actually requires, and matches the clarification's Round B rule to take the simpler, real option over inventing a second source of truth.

## Notes for the next worker
- `lib/auth/permissions.ts` is the single source of truth for role/permission logic — read it directly for any future permission-matrix or role-related doc/feature work rather than trusting a stale README table.
- The real pg_cron jobs are defined in `supabase/migrations/20260822160000_recurrence_scheduled_generation.sql` and `supabase/migrations/20260823050000_overdue_notification_sweep.sql`; both run `0 * * * *` (hourly). `tests/integration/overdue-notification-sweep.test.ts` is the regression check for job registration via the Supabase Management API (needs `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF`; skips gracefully in CI without them).
- MCP usage: none — this feature's registry entry says "MCP at run: none," and no live schema/policy introspection was needed since all facts (env vars, cron schedules, role predicates) were verifiable directly from repo source.
