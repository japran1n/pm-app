# Handoff: F020 — Migration + team UI: metrics and improvements

## Status
COMPLETE

## Assertions covered
AS-039: PASS — `project_metrics` holds `name`, `unit`, `target_value`, `source` (closed enum `gsc|ga4|lighthouse|crux|manual|other`), `baseline_value`/`baseline_at`, and `direction` (`higher|lower`). Live test (`tests/integration/f020-metrics-snapshots-improvements-baseline-freeze.test.ts`, "AS-039" describe block) inserts one and reads it back as both a team member and an eligible client; a bad `source` value is rejected by the CHECK constraint.
AS-040: PASS — same file, "AS-040" describe block: before freezing, `baseline_value` is editable; after `projects.baseline_frozen_at` is set, an UPDATE to `baseline_value` — and separately to `baseline_at` — is rejected with `42501` by the `prevent_frozen_baseline_update` trigger, and the row's other fields (`name`, `client_visible`, `target_value`) remain freely editable on the same frozen row. A `metric_snapshots` insert succeeds after freezing, in the same describe block.
AS-041: PASS — `deriveMetricMeasurementStatus` (`lib/queries/metrics.ts`) is the one place this decision is made; "AS-041" describe block proves: no snapshot → `not_measured`; a snapshot but no baseline → `not_measured`; and, for each `direction`, the value movement that is an improvement for a `lower`-is-better metric is a regression for a `higher`-is-better metric with the same numbers, and vice versa.

## Files changed
supabase/migrations/20261013010000_f020_metrics_snapshots_improvements_baseline_freeze.sql
lib/queries/metrics.ts
lib/actions/metrics.ts
lib/validation/metrics.ts
components/project/measurement-panel.tsx
components/project/project-settings-nav.tsx
components/project/phase-list.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/measurement/page.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/phases/page.tsx
tests/integration/f020-metrics-snapshots-improvements-baseline-freeze.test.ts
lib/supabase/database.types.ts (regenerated)

## Commands run
`npm run db:apply -- supabase/migrations/20261013010000_f020_metrics_snapshots_improvements_baseline_freeze.sql` (0)
`npm run db:gen-types` (0)
`npm run migrations:check` (0, no drift)
`npx vitest run tests/integration/f020-metrics-snapshots-improvements-baseline-freeze.test.ts` (0, 24/24 passing)
`npx vitest run tests/integration/f016i-anon-execute-catalog.test.ts tests/integration/f016l-public-table-rls-catalog.test.ts` (0, 11/11 passing — side-effect verification: confirms both new trigger functions have anon EXECUTE swept and all three new tables have RLS enabled)
`npx tsc --noEmit` (0)
`npx eslint lib/queries/metrics.ts lib/actions/metrics.ts lib/validation/metrics.ts components/project/measurement-panel.tsx components/project/phase-list.tsx components/project/project-settings-nav.tsx "app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/measurement/page.tsx" "app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/phases/page.tsx" tests/integration/f020-metrics-snapshots-improvements-baseline-freeze.test.ts` (0 errors, 0 warnings)
Full vitest suite deliberately NOT run, per instructions.

## Decisions made
- **Migration timestamp collision, caught and fixed before applying.** I first wrote this migration as `20261012010000_f020_...`, but `npm run db:apply` reported "already applied — nothing to do" — a live catalog query (`supabase_migrations.schema_migrations`) showed that exact version string already belongs to a DIFFERENT, previously-applied migration file present in this repo (`20261012010000_f018_budget_threshold_sweep.sql`, from a prior worker run). Renamed my file to the next free slot, `20261013010000`, before applying — confirmed via `git status` that no content was lost (the original write never touched an existing file; only the new, still-untracked file was renamed).
- **Freeze trigger guards `baseline_value`/`baseline_at` BY NAME, not the whole row** — directly following F011b's lesson (`20260924010000`, grep-verified: that migration's header documents choosing "check the four guarded fields explicitly" over blocking every column via a status check, because the latter broke an unrelated FK referential action). Applied here even though `project_metrics` has no such FK today: the mission's own instruction was explicit ("guard the baseline fields specifically, not every column of the row"), and the live test proves the practical benefit directly — `client_visible`, `name`, and `target_value` all stay editable on a frozen metric.
- **No RPC for freezing.** Design constraint 6 ("multi-table writes go through an RPC") does not apply: freezing writes exactly one column (`projects.baseline_frozen_at`) on one table. `freezeBaseline` (`lib/actions/metrics.ts`) goes through the ordinary `withAuthz` + `ctx.admin` write path, gated with `.is("baseline_frozen_at", null)` so it is a true one-way flip (a second call is a no-op that reports "already frozen", never a silent re-stamp).
- **`metric_snapshots` has no `client_visible` column of its own; visibility follows the parent metric's `client_visible` via a join** in both its team and client SELECT policies (and its INSERT policy's writer check). A snapshot of a hidden metric would otherwise be independently visible even though the metric itself is hidden — verified by a dedicated test ("metric_snapshots: visibility follows the parent metric's client_visible, not a flag of its own").
- **No UPDATE policy on `metric_snapshots`** — a mis-entered measurement is deleted and re-added (`deleteSnapshot` exists; no `updateSnapshot`), keeping every snapshot an honest, append-only record, matching AS-040's own "later measurements are recorded as separate snapshots" wording literally (a snapshot is recorded, not edited).
- **Storage: reused the existing `task-attachments` bucket** (per the spec's own "Images through the existing attachments bucket and policies," 20260818050100) rather than creating a second bucket, applying that bucket's own established technique one level over: `improvements/{project_id}/{uuid}-{filename}` path convention, an INSERT policy that parses `project_id` out of the path's second segment (mirroring `attachments_objects_insert_active_members`'s first-segment `task_id` parse), and a SELECT policy that joins back to `project_improvements` (mirroring `attachments_objects_select_active_members`'s join back to `attachments`) — except this SELECT policy authorizes BOTH the team's own two-tier check and an eligible client's, because F021's portal Results view needs to read the same object a team member uploaded.
- **Phase-2 exit check matches by phase NAME (`"Audit & baseline"`), not position.** `seed_default_phases` (F001, `20260909010000`) seeds that exact name at position 2, but `project_phases.position` is a plain, PM-editable integer with no uniqueness constraint pinning "phase 2" to any specific phase — matching by name is the more literal reading of the spec's own parenthetical ("phase 2 (\"Audit & baseline\")") and degrades honestly (a renamed phase simply stops matching, rather than a repositioned unrelated phase silently starting to match). Fires only on the actual not-done → done transition (compares the closure's stale `state` against `next.state`), not on every unrelated field edit to that phase.
- **The warning is a `toast.warning(...)`, not a blocking confirm dialog** — the spec is explicit ("warn — do not block... respect the human's decision"). `toast.warning` is an existing, established pattern in this codebase (grep-verified: `components/task/bulk-delete-action.tsx`, `bulk-status-action.tsx`, `bulk-phase-action.tsx` all use it already), not a new UI primitive.
- **`uploadImprovementImage` reuses `ALLOWED_ATTACHMENT_MIME_TYPES`/`MAX_ATTACHMENT_SIZE_BYTES`** (`lib/validation/attachments.ts`) rather than defining a second allow-list/size-limit pair for improvement images — same closed vocabulary, same 10MB ceiling, no drift risk between the two upload paths.
- **`updateMetric`'s own error path distinguishes the trigger's 42501 rejection from a generic failure** and surfaces an honest, specific message ("This project's baseline is frozen...") rather than the generic error — the UI never pretends a rejected baseline edit silently succeeded or silently no-oped; the PM sees exactly why.

## Out-of-scope work needed
- F021 (Portal: Results view, AS-041, AS-042) needs to build the actual client-facing chart that reads `getProjectMetricsWithLatestSnapshot`/`deriveMetricMeasurementStatus`/`getProjectImprovements` (all exported from `lib/queries/metrics.ts` specifically so F021 can call them directly rather than re-deriving the same logic) and render before/after images via signed URLs against the `task-attachments` bucket paths this migration establishes (`improvements/{project_id}/{...}`). Not built here, per this feature's own scope (migration + team UI only).
- Automatic collection from GSC/GA4/Lighthouse remains explicitly out of scope, per this feature's own spec — no API client was added.
- The "Remove" control on a metric's latest measurement (`components/project/measurement-panel.tsx`) only clears the LOCALLY-HELD latest snapshot reference after a successful delete; if an earlier snapshot exists for that metric, this component does not re-fetch and display it as the new "latest" until the page is reloaded (a real but minor UX gap in a feature whose in-scope definition-of-done tests don't cover snapshot deletion at all — flagged here rather than fixed silently, since fixing it would mean adding a re-fetch call not asked for by the spec).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: matched the phase-2 exit check by phase name (`"Audit & baseline"`) rather than position — see "Decisions made" above for the full reasoning; the spec's own wording names both ("phase 2 (\"Audit & baseline\")") but only the name survives a PM reordering the phase list.
AUTONOMOUS_DECISION: no RPC for the freeze action (see "Decisions made" — design constraint 6 only requires an RPC for multi-table writes, and this is single-table).
AUTONOMOUS_DECISION: chose `toast.warning` (existing pattern) over a second confirmation-dialog primitive for the non-blocking phase-2 warning, since the spec's own "warn — do not block" instruction rules out anything requiring an extra click to dismiss.

## Notes for the next worker
- No MCP tools were used — the Supabase MCP is not authorised for this mission's workers (this feature's own instruction, repeated in `worker-mcp-usage`); all schema work went through `npm run db:apply`/`npm run db:gen-types` against the CLI-linked project, and post-apply verification used the same live-session integration-test technique every other migration feature in this mission uses.
- **Migration filename collision gotcha, worth remembering:** `npm run db:apply` silently reports "already applied — nothing to do" when a migration's version prefix (derived from the filename) collides with an ALREADY-APPLIED migration that happens to share that exact timestamp, even if the file CONTENTS are completely different and the file you're applying was never itself run. It does not error or warn about the mismatch — it just no-ops. Always check `ls supabase/migrations | tail -5` (and, if in doubt, query `supabase_migrations.schema_migrations` live) for the actual highest applied version before picking a new migration's timestamp, rather than trusting a locally-computed "next" timestamp.
- The two trigger functions this migration creates (`prevent_frozen_baseline_update`, `set_updated_at` usage is via the pre-existing shared trigger, not new) are automatically covered by F016i's event trigger (`20261007010000`) sweeping anon EXECUTE — verified live via `tests/integration/f016i-anon-execute-catalog.test.ts`, no manual grant/revoke statement was needed or written.
