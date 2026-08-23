# Handoff: F210 — notifications for deleted targets

## Status
PARTIAL

## Assertions covered
AS-390: PASS — `test_AS_390_notification_for_a_soft_deleted_task_degrades_to_non_clickable_instead_of_a_broken_link` and `test_AS_390_notification_for_a_task_whose_project_became_inaccessible_degrades_the_same_way` in `tests/integration/notification-deleted-target.test.ts`, run against the real linked Supabase project, both pass.

## Files changed
lib/queries/notifications.ts
tests/integration/notification-deleted-target.test.ts

## Commands run
`npx vitest run tests/integration/notification-deleted-target.test.ts tests/integration/notification-mark-read.test.ts tests/unit/notification-bell-panel.test.tsx` (0) — 19/19 passed
`npx tsc --noEmit` (0)
`npx eslint lib/queries/notifications.ts tests/integration/notification-deleted-target.test.ts` (0)
`npm run test` (1) — full suite: 126 test files failed / 114 passed, 105 tests failed / 1036 passed / 493 skipped. See Blockers — this is a pre-existing, environment-level flakiness spanning features this worker never touched (F027, F031, F114, F126, F177, F179, F184, F192, F202, project-members, etc.), not caused by this diff. A second full run in the same session was worse than the first (17 failed files -> 126 failed files), consistent with Supabase rate-limiting/connection exhaustion from repeated heavy integration-test runs today, not a code regression from this feature.
`npx playwright test` — not run (full suite gate already failing for unrelated reasons above; running Playwright on top would not change the truthful status).

## Decisions made
- Extended the existing `lib/queries/notifications.ts` (F208) rather than creating a new query file, per this feature's own briefing note that the spec's Files list is approximate for this mission.
- No new component: reused notification-panel.tsx's existing `taskLabel`/`taskHref` non-clickable fallback (already built by F208 for the soft-deleted-task case) by making the query synthesize the SAME degraded task shape (`{ id, key: null, title: null, projectId: null }`) whenever a task id is referenced by a notification but doesn't come back from the `tasks` lookup query — whether because it was hard-deleted, soft-deleted, or (new in this feature) because its project is no longer visible to the recipient.
- Access lost without deletion (project made private): per the clarified Notes ("treat both the same way") and the "simpler option, no new dependency" ambiguity-resolution rule, this reuses the fact that the `tasks` SELECT in `getNotificationsForWorkspace` already runs on the caller's own session (`createClient()`, not the admin client) — `public.is_task_visible_to()` / `is_project_visible_to()` (the RLS sweep from `20260821140526_project_visibility_rls_sweep.sql`, the same rule `lib/comments/mentions.ts`'s `resolveVisibleMentionIds` generalises) already filters such a task out of the query result at the database layer. No second visibility check was written in application code — the query just treats "task id referenced but not returned" as the one degraded case, regardless of why.
- Unread count: previously a separate `head: true` exact-count query with no accessibility filtering. Changed to fetch all unread rows' `id, task_id` (not just the paginated page), reuse the same batched task lookup (merged into the existing `taskIds` set — still one query, no N+1), and subtract rows whose `task_id` is set but not accessible. `lib/actions/notifications.ts`'s `getNotificationSnapshot` (F209's realtime/tab-focus reconciliation) calls straight through to `getNotificationsForWorkspace`, so this fix applies to both the initial SSR badge and the realtime-reconciled badge with no separate change needed there.

## Out-of-scope work needed
- None identified specific to this feature. The full-suite flakiness described above (Blockers) is out of scope for a single-feature worker to fix — it looks like an infra/rate-limit issue affecting the whole integration-test suite, not a bug in any specific feature's code.

## Blockers
BLOCKER: `npm run test` (full suite) fails with 105 individual test failures / 126 failed test files, spanning many unrelated, previously-passing features (F027, F031, F114, F126, F177, F179, F184, F192, F202, etc.) that this worker did not touch. AS-390's own tests, plus the directly adjacent F208/F209 notification suite, pass cleanly in isolation.
TRIED: Ran the isolated notification test files (pass, 19/19). Ran the full suite twice in this session; the second run was markedly worse than the first (17 failed test files -> 126 failed test files) with no code changes in between, and includes an unrelated `cookies() was called outside a request scope` unhandled rejection from `getMentionCandidates` inside a `user-avatar.test.tsx` render (a file this feature never touches). This pattern (worsening across repeated runs, spread across unrelated old features) points to environment-level flakiness against the real hosted Supabase project — most plausibly rate-limiting or connection exhaustion from many `auth.admin.createUser` calls across a very large integration suite run back-to-back — rather than a regression introduced by this diff.
NEEDED: A maintenance pass (not a new product feature) that either (a) throttles/pools the integration suite's Supabase admin-client user creation, or (b) confirms with the Supabase project dashboard whether rate limits were hit around this session's timestamps, before the next full-suite gate can be trusted to reflect real regressions vs. infra noise.
SUGGESTED FOLLOWUP: Add a feature to investigate and stabilize the integration test suite's interaction with the real Supabase project under full-suite load — e.g. review `auth.admin.createUser` call volume across `tests/integration/*.test.ts`, check Supabase project rate-limit/quota settings via the Supabase MCP or dashboard, and consider a shared test-user pool or `vitest` `--pool=forks --poolOptions.forks.maxForks` throttling so a full `npm run test` run against the live project is reliably green rather than progressively degrading across repeated runs in the same session.

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to represent "hard-deleted task" and "task whose project is no longer visible" with the identical degraded shape (`title: null`, `projectId: null`, `key: null`) already used by F208 for a soft-deleted task, rather than adding a new field distinguishing the three cases — per the clarified spec's explicit "treat both the same way" instruction and the ambiguity-resolution rule (simpler option, no second source of truth). The panel's existing rendering ("a deleted task", non-clickable) already covers all three without any component change.

## Notes for the next worker
- `lib/queries/notifications.ts` now issues one extra query (`unreadRows`, unread `id, task_id` with no `limit`) beyond F208's original two, still batching the `tasks` lookup into a single query across both `rows` and `unreadRows` task ids — no N+1 introduced.
- No MCP tools were needed for this feature's own implementation (registry: "MCP at run: none" for F210) — the visibility rule was verified by reading the RLS migration SQL directly (`supabase/migrations/20260821140526_project_visibility_rls_sweep.sql`) rather than a live MCP introspection call, since no schema/policy change was needed, only application-code reuse of an already-verified rule.
- If picking up the SUGGESTED FOLLOWUP above: start by counting `auth.admin.createUser` invocations across `tests/integration/*.test.ts` (very high — most integration test files create 2-3 fresh users each) and check whether Supabase's free/dev tier has a per-minute auth admin rate limit that a ~240-file suite run would exceed.
