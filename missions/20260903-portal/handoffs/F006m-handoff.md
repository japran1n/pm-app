# Handoff: F006m — Guest phase seeding parity

## Status
COMPLETE

## Assertions covered
No assertion IDs were assigned to F006m (it is an M1-scrutiny remediation of an internal-consistency bug, not new product behaviour tied to the validation contract). No `AS-NNN` lines apply.

## Files changed
supabase/migrations/20260922010000_f006m_seed_default_phases_guest_parity.sql
tests/integration/f002-phase-management.test.ts

## Commands run
`npm run db:apply -- supabase/migrations/20260922010000_f006m_seed_default_phases_guest_parity.sql` (0)
`npx vitest run tests/integration/f002-phase-management.test.ts tests/integration/portal-phases-rls.test.ts` (0 — 44/44 passed)
`npx tsc --noEmit` (0)
`npx eslint tests/integration/f002-phase-management.test.ts` (0)

## Decisions made
- Read `lib/actions/phases.ts:188` (`requireVisibility: true`) and traced it to `withAuthz` (`lib/actions/authz.ts:173-183`), which calls `isProjectVisibleToCaller` (`lib/actions/project-visibility.ts:16-31`). That function returns `true` for **any** role when `context.visibility === "workspace"`, `true` for owner/admin regardless of visibility, and otherwise requires an explicit `project_members` row. This is the Server Action's actual gate — not the SQL `is_project_visible_to` function F006i had called, which excludes `guest` from its workspace-visibility branch (`supabase/migrations/20260908010000...sql:37-64`, confirmed by reading the function body directly).
- Rewrote `seed_default_phases`'s visibility check inline to replicate `isProjectVisibleToCaller`'s exact three branches (workspace-visible → any role; owner/admin → any project; else → explicit `project_members` row), rather than calling the stricter `is_project_visible_to` SQL helper. This keeps the RPC and the Server Action's gate identical by construction, per the spec's explicit instruction to match `lib/actions/phases.ts`'s gate rather than pick an independently-reasonable bar.
- Preserved F006i's actual fix unmodified in effect: a `member`/`guest` with no `project_members` row on a `visibility = 'private'` project is still rejected, because the workspace-visibility branch only short-circuits when `v_visibility = 'workspace'`. Added a dedicated test (`F006m: a guest ... on a PRIVATE project is still rejected ...`) proving this survives, using a fresh project (not the shared `privateProjectId` fixture) so the before/after "nothing inserted" check is genuine.
- Copied the ten-row insert body byte-for-byte from `supabase/migrations/20260918010000_f006i_authz_round_2.sql` (name/`client_description`/position columns and values) rather than inventing placeholder phase names — an earlier draft of this migration used made-up phase names/columns and was corrected before being applied, after diffing against the F006i migration source directly.
- Added a `guest` fixture user to `tests/integration/f002-phase-management.test.ts`'s shared `beforeAll` (workspace role `guest`, active, no `project_members` row on the shared workspace-visible `projectId`) and two new tests: (1) primary success — the guest can both `createPhase` individually on the shared workspace-visible project AND seed all ten via RPC on a fresh workspace-visible project; (2) failure — the same guest is rejected with `42501` and zero rows inserted on a fresh **private** project where only the owner has a `project_members` row, proving F006i's fix wasn't relaxed.
- Did not touch `lib/actions/phases.ts` or `lib/actions/project-visibility.ts`. The spec's own guardrail — "if your reading says the Server Action is the one that is wrong... stop, say so... and do not change either" — did not apply here: nothing in this investigation suggested the Server Action's admission of guest on workspace-visible projects is itself wrong; it is consistent with `project_phases_insert_team`'s RLS policy (`is_project_workspace_writer`, which also admits guest, per M1-scrutiny-3's own trigger analysis), so the RPC was the one out of step and was the one fixed.

## Out-of-scope work needed
- M1-scrutiny-3's Q1/Q3 findings (AS-002, AS-007 B1-B5) are unrelated pre-existing failures in `decide_approval_atomic`, `get_open_task_counts`, `addComment`, `getAttachmentSignedUrl`, `project_statuses`/`task_types` RLS, and the Approvals badge query — all explicitly out of scope for F006m and belong to the FA/FB/FD follow-up features the scrutiny report already proposes. Not touched here.
- Follow-up FC ("Reconcile the SQL and application definitions of 'project visible to a guest'") from the same scrutiny report is now effectively resolved for the one call site it names (`seed_default_phases`), but the underlying divergence between `is_project_visible_to` (SQL, excludes guest) and `isProjectVisibleToCaller` (app, admits guest on workspace-visible projects) still exists as two separate functions that other future RPCs could pick the wrong one from. No other current RPC or RLS policy references `is_project_visible_to` in a way this feature's scope covers checking; a full audit of every `is_project_visible_to` call site for the same divergence was not performed (out of scope — F006m names only `seed_default_phases`).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to inline the `isProjectVisibleToCaller` rule directly into the PL/pgSQL function body rather than introduce a new SQL helper function callable from both `is_project_visible_to` sites and this one. Reasoning: the spec scopes this feature narrowly to `seed_default_phases`, and inlining avoids widening blast radius onto other RPCs/policies that intentionally still use the stricter `is_project_visible_to` (e.g. `project_phases_select_team`'s sibling checks noted in the scrutiny report as "already empty for guests, so the UI is consistent"). A shared-helper refactor is exactly the kind of larger reconciliation the scrutiny report's follow-up FC calls out as a separate decision.

## Notes for the next worker
- `lib/auth/permissions.ts:171-173` — `canWrite(ctx)` returns `true` for every role except `viewer` and client roles; guest passes. This is why a guest can create phases individually today (confirmed via `project_phases_insert_team`'s `is_project_workspace_writer` RLS policy, `supabase/migrations/20260909010000_portal_foundations.sql:162-167`, which does not exclude guest either).
- The migration file is `supabase/migrations/20260922010000_f006m_seed_default_phases_guest_parity.sql`, applied via `npm run db:apply -- <path>` (not the bare `npm run db:apply`, which just prints usage and needs the file path as an argument).
- No MCP tools were used — the mission's Supabase MCP is not authorised for this worker per the task instructions; the CLI migration runner (`scripts/apply-migration.mjs`) was used instead, per the explicit instruction in the task prompt.
- Full vitest suite was deliberately NOT run, per the task instructions — only `tests/integration/f002-phase-management.test.ts` (contains this feature's new tests, plus F006d/F006i/F006j's pre-existing tests for the same RPC) and `tests/integration/portal-phases-rls.test.ts` (the other file referencing `seed_default_phases`) were run, alongside `tsc --noEmit` and `eslint` on the changed test file.
