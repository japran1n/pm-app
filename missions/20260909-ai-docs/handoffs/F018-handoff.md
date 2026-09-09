# Handoff: F018 — Migration: ai_threads + ai_messages

## Status
COMPLETE

## Assertions covered
AS-080: PASS — `ai_threads`/`ai_messages` tables exist with the specified schema; verified via `npm run db:gen-types` output including both tables with all listed columns.
AS-081: PASS — RLS enabled on both tables; active workspace members (role not 'client'/'viewer' per `can_read_workspace_docs`/`can_write_workspace_docs`) can select/insert; verified policy definitions applied cleanly via `npm run db:apply` and `npm run migrations:check` reporting no drift.
AS-084: PASS — Portal clients (role 'client') are denied via `can_read_workspace_docs`/`can_write_workspace_docs` role exclusion on the base policies, plus an explicit `as restrictive` `ai_threads_deny_portal_clients` / `ai_messages_deny_portal_clients` policy asserting the denial outright rather than by omission, per spec instruction to make it explicit.

## Files changed
supabase/migrations/20261118010000_ai_threads_ai_messages.sql
lib/supabase/database.types.ts (regenerated via `npm run db:gen-types`)

## Commands run
`npm run db:apply -- supabase/migrations/20261118010000_ai_threads_ai_messages.sql` (0)
`npm run migrations:check` (0) — "No migration drift — all migrations present on remote."
`npm run db:gen-types` (0) — wrote `lib/supabase/database.types.ts`, confirmed `ai_threads`/`ai_messages` present
`npx tsc --noEmit` (1, but only the 4 pre-existing errors: app/layout.tsx LayoutProps, components/ui/status-badge.tsx overload, 2x tests/unit/docs-markdown-editor-export-import.test.tsx — none introduced by this migration)
`npm test` — NOT run per standing instruction ("do not run full test suite")

## Decisions made
- Reused `public.can_read_workspace_docs` / `public.can_write_workspace_docs` (from `20260905030000_docs_rls_role_restrictions.sql`) instead of writing new `can_read/write_workspace_ai_threads` helpers — these predicates already express exactly "active member AND role <> 'client'" (read) / "role not in ('viewer','client')" (write), and the AI sidebar is docs-adjacent with no spec requirement to diverge from that role gate.
- `ai_threads` insert policy requires `can_write_workspace_docs` (not the looser `can_read_workspace_docs`) since a thread is user-generated content, matching the spec's "insert only into own workspace, as themselves" plus the codebase's existing write/read split for docs.
- Added explicit `as restrictive ... for all` deny-portal-clients policies on both tables, joined through `is_project_client`, in addition to the role exclusion already baked into `can_read_workspace_docs`/`can_write_workspace_docs`. Spec explicitly required the portal-client denial be asserted, not left implicit — this makes it survive even if a future edit to those two helper functions loosens the client exclusion.
- `ai_messages` has no UPDATE policy — messages are append-only, same "no edit, only add/remove" convention used by `attachments` and `project_scope_documents` in this schema.
- Migration filename/timestamp `20261118010000` follows the existing sequential-timestamp convention (latest prior migration was `20261117010000`).

## Out-of-scope work needed
None — this feature was scoped to the migration only. Application code (server actions, API routes, UI for the AI sidebar) consuming `ai_threads`/`ai_messages` is out of scope per the "Files" section of F018.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to add the restrictive portal-client-deny policies as `for all` (covering select/insert/update/delete) rather than one per command, since PostgreSQL restrictive policies AND together with all applicable policies regardless of command, and a single `for all` restrictive policy is simpler to audit as "the one place client denial lives" — matches the spec's ask to assert the denial explicitly and singularly rather than scatter it.

## Notes for the next worker
- Reference migration studied: `supabase/migrations/20260904010000_docs_system.sql` (base docs/doc_folders shape) and `supabase/migrations/20260905030000_docs_rls_role_restrictions.sql` (the role-gate hardening this migration reuses via `can_read_workspace_docs`/`can_write_workspace_docs`).
- No MCP tools used — this is a pure Supabase CLI/migration-file feature; `mcp-registry.md` was not consulted since no live-state introspection was needed beyond the existing `db:apply`/`migrations:check`/`db:gen-types` npm scripts, which already talk to the remote Supabase project via `.env` credentials.
- `ai_threads.project_id`/`doc_id` are nullable per spec ("context at creation") — the portal-client-deny policy on `ai_threads` treats a null `project_id` as "not a client's project" via `coalesce(project_id, '00000000-...')` which `is_project_client` will correctly resolve to false for (no such project exists), so workspace-level threads with no project are still visible to normal team members and still denied to any caller whose role is 'client' via the base `can_read_workspace_docs` exclusion regardless.
