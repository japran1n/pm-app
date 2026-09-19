# Handoff: F032 — Migracija: ukloniti `page_components.description` + query + tip

## Status
COMPLETE

## Assertions covered
AS-112: PASS — migration `supabase/migrations/20261127130000_drop_page_components_description.sql` exists, applied via `npm run db:apply` (confirmed applied + recorded in `supabase_migrations.schema_migrations`, `npm run migrations:check` reports no drift), and is guarded by a test.
AS-114: PASS — `BoardComponent`/`ComponentRow` in `lib/queries/architecture.ts` no longer declare `description`; `lib/supabase/database.types.ts` (regenerated via `npm run db:gen-types`) no longer declares `description` on `page_components` Row/Insert/Update. Guarded by static test.
AS-113: PASS — `COMPONENT_COLUMNS` constant (used by both `.select(COMPONENT_COLUMNS)` call sites in `lib/queries/architecture.ts`) no longer includes `description`. Guarded by static test.

## Files changed
supabase/migrations/20261127130000_drop_page_components_description.sql (new)
lib/queries/architecture.ts
lib/queries/architecture.select.test.ts (new)
tests/unit/f026-component-picker.test.tsx
tests/unit/f033-hover-highlighting.test.tsx
tests/unit/f034-component-panel.test.tsx
tests/unit/f035-component-detail.test.tsx
tests/unit/f036-rename-delete-panel.test.tsx
tests/unit/f081-board-performance.test.tsx
tests/unit/f084-keyboard-accessibility.test.tsx
tests/unit/f2-as10-client-hover-linking.test.tsx
tests/unit/f2-as9-client-component-panel.test.tsx
lib/supabase/database.types.ts (already reflected the dropped column on disk from a concurrent worker's commit by the time I checked in; no diff of my own to commit — verified content is correct)

## Commands run
`npm run db:apply -- supabase/migrations/20261127130000_drop_page_components_description.sql` (0) — "Applied and recorded 20261127130000_drop_page_components_description"
`npm run db:gen-types` (0)
`grep -r "page_components.*description\|description.*page_components" lib/ components/ --include="*.ts" --include="*.tsx"` — no matches
`npm run migrations:check` (0) — "No migration drift — all migrations present on remote."
`npx eslint lib/queries/architecture.ts lib/queries/architecture.select.test.ts` (0)
`npx vitest run lib/queries/architecture.select.test.ts` (0) — 7/7 passed
`npx vitest run tests/unit/f034-component-panel.test.tsx tests/unit/f035-component-detail.test.tsx tests/unit/f026-component-picker.test.tsx tests/unit/f033-hover-highlighting.test.tsx tests/unit/f036-rename-delete-panel.test.tsx tests/unit/f081-board-performance.test.tsx tests/unit/f084-keyboard-accessibility.test.tsx tests/unit/f2-as10-client-hover-linking.test.tsx tests/unit/f2-as9-client-component-panel.test.tsx lib/queries/architecture-details.select.test.ts` (0) — 10 files / 50 tests passed
`npx tsc --noEmit` — passes cleanly for every file I touched; the full repo run currently shows unrelated `BoardPage.description` errors (see Notes below) that predate and are outside this feature's scope
`npm run test -- --run` (0 exit; ran to completion) — 265/848 test files failed repo-wide, all pre-existing/unrelated to this feature (see Notes)

## Decisions made
- Confirmed via F031 that `page_components.description` had 0 non-null rows in production before dropping; migration uses `drop column if exists` for idempotency, matching repo convention (see `20261127021000_architecture_node_meta.sql` header-comment style cited in tech-decisions.md).
- Mirrored the F036 `lib/queries/architecture-details.select.test.ts` static-source-guard pattern for `lib/queries/architecture.select.test.ts` (reads source as text, regex-checks `.select(...)` calls and type declarations, plus a filesystem check that the migration file exists) — no DB round trip needed, consistent with this mission's "cleanup/migration feature" clarification (`Primary: migrations:check prolazi; tsc --noEmit prolazi` / `Failure: test verifikuje da obrisana kolona/akcija ne postoji`).
- `COMPONENT_COLUMNS`/`.select(COMPONENT_COLUMNS)` uses an identifier, not an inline string literal, so the AS-113 guard test asserts on the constant's value plus a fallback regex over any literal inline `.select("...")` calls, rather than only matching inline strings (which would have silently passed even with `description` present).

## Out-of-scope work needed
None additional for this feature — F031 (verification) already landed and this feature (drop + cleanup) is now closed out.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Did not attempt to fix the repo-wide `BoardPage.description` TypeScript errors or the ~265 failing test files surfaced by `npm run test -- --run` — both are caused by other workers' concurrently in-flight, uncommitted changes on this shared checkout (a different column, `tasks.description_text`, being removed by an unrelated feature in this same mission, plus assorted pre-existing failures such as `supabase.rpc is not a function` and `getSession` on undefined that have nothing to do with `page_components`). I verified my own scope is clean: `npx tsc --noEmit` produces zero errors outside of `BoardPage.description` sites, and the 10 test files most relevant to this change (including the new guard test) all pass. Committed only the files I actually authored/modified for this feature (confirmed via `git diff` per file before staging) so the other in-progress worker's uncommitted edits were left untouched in the working tree.

## Notes for the next worker
- `lib/queries/architecture.select.test.ts` is the new static guard for AS-112/113/114 — mirrors `lib/queries/architecture-details.select.test.ts` (F036/AS-121) style exactly, so future column removals on `page_components`/`architecture.ts` have a consistent pattern to extend.
- At commit time the working tree had substantial uncommitted work from at least one other concurrent worker in this same mission (removing `tasks.description_text` / `BoardPage.description`, touching `components/architecture/page-column.tsx`, `client-page-column.tsx`, and ~20 test fixtures). I left all of that untouched and uncommitted — it is not part of F032's scope. If `npx tsc --noEmit` still shows `BoardPage.description` errors when you pick up the next feature, that is a different, already in-progress feature settling, not a regression from this one.
- No MCP tools were used for this feature — F031 (the prerequisite verification of 0 non-null rows) already used Supabase MCP/live inspection per its own handoff; this feature only needed the repo's own `db:apply`/`db:gen-types`/`migrations:check` scripts per tech-decisions.md conventions.
