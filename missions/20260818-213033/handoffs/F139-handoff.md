# Handoff: F139 — audit_log table + append-only RLS

## Status
COMPLETE

## Assertions covered
AS-247: PASS — `test("AS-247: a regular member's direct query for audit rows is rejected...")` in `tests/integration/rls-audit-log.test.ts`, run in isolation (6/6 passing). A signed-in "member" role's direct `select()` against `audit_log` for their own workspace returns `data: []`, `error: null` (rejected via RLS with no leaking error, matching this schema's existing anon/non-member convention). A companion test in the same file proves the owner's identical query *does* see the row, confirming the policy is role-gated (owner/admin), not merely workspace-gated.
AS-249: PASS — two tests, `AS-249: ...UPDATE attempt...` and `AS-249: ...DELETE attempt...`, both using the owner's own real publishable-key session (not the service-role admin client). Both mutations affect 0 rows; a follow-up admin-client read confirms the row is byte-for-byte unchanged. This is by construction — the migration defines no UPDATE or DELETE policy on `audit_log` for any role, so RLS has no path to permit either statement even for an owner/admin.

## Files changed
supabase/migrations/20260821211226_create_audit_log.sql
lib/supabase/database.types.ts (regenerated via `supabase gen types typescript`)
lib/activity/README.md (new — action-naming convention doc for F140+)
tests/integration/rls-audit-log.test.ts

## Commands run
`supabase migration list --linked` (0, pre-flight check — completed promptly, ~4s, so this session did NOT hit the connectivity issue other sessions reported)
`supabase db push --linked` (0 — migration `20260821211226_create_audit_log.sql` applied successfully to the linked project)
`supabase gen types typescript --project-id <redacted>` (0 — regenerated `lib/supabase/database.types.ts`)
`npx vitest run tests/integration/rls-audit-log.test.ts` (0 — 6/6 passed, run twice for stability, both green)
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors; 2 pre-existing warnings in unrelated files, not touched by this feature)
`npm run test` (see Decisions Made — full suite has pre-existing, environment-wide Supabase auth rate-limit flakiness unrelated to this feature; my own test file is stable when the suite isn't hammering the auth endpoint concurrently)

## Decisions made
- Action-naming convention for `audit_log.action` (needed by F140 onward): free-form `text`, not an enum, following `<subject>.<past_tense_verb>[_<qualifier>]`, e.g. `project.archived`, `member.role_changed`, `workspace.ownership_transferred`. Documented in the migration's header comment and mirrored in `lib/activity/README.md` so it's discoverable from application code without reading SQL. This is the ★-recommended clarification answer taken verbatim (simpler option, no new dependency, no second source of truth).
- Writes go exclusively through a new SECURITY DEFINER function `public.write_audit_log_entry(p_workspace_id, p_action, p_target_type, p_target_id, p_metadata)`. There is deliberately **no INSERT RLS policy at all** on `audit_log` — not even an `actor_id = auth.uid()`-scoped one — because even that weaker form would let a compromised/malicious client session write *a* row directly. Routing every write through the RPC means only server-side application code (via a validated session) can create entries, and the function itself pins `actor_id := auth.uid()` server-side rather than trusting any client-supplied actor value. This satisfies the feature spec's explicit "INSERT only via a SECURITY DEFINER function (not raw client INSERT)" requirement.
- SELECT policy joins `workspace_members` inline (role check `in ('owner','admin')`, `status = 'active'`) rather than introducing a new shared SQL helper function, because no existing helper already expresses "owner or admin of this specific workspace" (the closest, `is_project_workspace_writer`, is project-scoped and excludes viewer/guest rather than requiring owner/admin) — inventing a one-off single-use function would be more surface area than the clarification's "no second source of truth" preference justifies for a predicate used by exactly one policy. Mirrors `lib/auth/permissions.ts`'s `canViewAudit` role check (`role === 'owner' || role === 'admin'`) so the DB and app layers can't drift.
- No UPDATE or DELETE policy exists for `audit_log`, for any role, permanently — this is the entire mechanism behind AS-249. Confirmed via the negative tests using the owner's real session (not the admin client), per the assertion's exact wording.
- Indexes: `(workspace_id, created_at desc)` for the "audit log for workspace X, most recent first" read path (the only read path named in the spec), and a secondary `actor_id` index for a plausible "everything actor Y did" query, both named explicitly in the Draft scope.
- Regenerated `lib/supabase/database.types.ts` after applying the migration (per the clarification's "Dependencies on existing code" answer: "must be regenerated").

## Out-of-scope work needed
- No Server Action wrapper for calling `write_audit_log_entry` was written — the feature spec's Files list is `supabase/migrations/` + the RLS test only; application code that calls the RPC (e.g. from `lib/actions/workspaces.ts` when a role changes, or a projects action when archiving) belongs to F140+ per the spec's own framing ("future features (F140 onward) will need to follow it consistently"). Those features should call `supabase.rpc('write_audit_log_entry', {...})` from their existing Server Actions using the naming convention documented in `lib/activity/README.md`.
- No UI page/component renders the audit log (a workspace settings "Activity" or "Audit log" view) — not named in this feature's Files/scope; likely a separate F14x feature.
- Noticed (but did not touch, out of scope for this feature): the working tree already had uncommitted changes to `components/nav/app-sidebar.tsx`, `lib/actions/workspaces.ts`, `lib/auth/permissions.ts`, and `lib/validation/workspaces.ts` before this session started (appears to be in-progress F136 "delete workspace" work, based on the `canDeleteWorkspace` predicate and comments referencing F136/AS-244). These were left exactly as found; only files this feature's spec names were staged and committed.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to define the owner/admin SELECT predicate as an inline `exists(...)` subquery inside the single policy rather than extracting a new named SQL helper function, since no existing helper already expressed "owner or admin of a given workspace" and this predicate has exactly one consumer — matches the clarification's "simpler option, no new dependency, no second source of truth" default for genuinely open implementation choices.
AUTONOMOUS_DECISION: `target_id` and `metadata` are nullable/defaulted (`target_id uuid` nullable, `metadata jsonb not null default '{}'::jsonb`) rather than required, since not every audited action necessarily targets a single specific row (e.g. a bulk operation) or carries extra detail — the feature spec's column list doesn't mark them explicitly NOT NULL and this keeps day-one empty/optional cases valid without inventing sentinel values.

## Notes for the next worker
- `lib/activity/README.md` is the canonical doc for the `audit_log.action` naming convention — read it before adding any new audited action type in F140+, and grep existing `action` values in the codebase/migrations to avoid near-duplicate names (e.g. don't add `project.archive` next to an existing `project.archived`).
- To log an entry from application code, call the RPC, not a raw insert: `await supabase.rpc('write_audit_log_entry', { p_workspace_id, p_action: 'project.archived', p_target_type: 'project', p_target_id: project.id, p_metadata: { ... } })`. A raw `.from('audit_log').insert(...)` from a client/publishable-key session will be rejected by RLS (no INSERT policy exists) — this is intentional, not a bug.
- Full-suite `npm run test` has a pre-existing, environment-wide flakiness issue unrelated to this feature: many integration tests sign in freshly-created Supabase Auth users concurrently, and under full-suite load this trips Supabase's auth rate limit (`AuthApiError: Request rate limit reached`, HTTP 429), causing failures across dozens of unrelated test files (`dependency-ui-actions.test.ts`, `workspace-time-by-person.test.ts`, `open-blockers.test.ts`, etc. — none of which this feature touches). This is documented by prior workers too (see `rate limit` hits in `F278-handoff.md`, `F292/293/294/297-handoff.md`). `tests/integration/rls-audit-log.test.ts` itself is stable and green (6/6) when run in isolation or alongside a smaller subset of the suite; it only shows the same rate-limit symptom when the entire 150-file suite runs back-to-back. No code change in this feature can fix that shared infra issue — it is out of this feature's scope (touches Supabase project rate-limit tier or a suite-wide auth-user-pooling fix, not this migration or test file).
- Pre-flight `supabase migration list --linked` and the subsequent `supabase db push --linked` both completed promptly in this session (a few seconds each) — this session did not hit the intermittent CLI-hang issue F129/F130 reported.
- No Supabase MCP tools were used (not confirmed available/approved in `mcp-registry.md` for this session); schema and RLS were verified via the CLI (`db push` success output) and via the integration test's direct queries against the live linked project instead.
