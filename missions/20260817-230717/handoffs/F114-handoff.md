# Handoff: F114 — project time totals

## Status
COMPLETE

## Assertions covered
AS-172: PASS — project header renders "Xh logged (Yh billable)" sourced from `getProjectTimeTotals`, verified via `npx tsc --noEmit` + `npm run build` compiling the Server Component, and the RPC-level split is asserted directly in `tests/integration/project-time-totals.test.ts`.
AS-174: PASS — `tests/integration/project-time-totals.test.ts` ("AS-174: soft-deleting a task drops its logged time from the project total") seeds a task with 100 billable minutes, soft-deletes it, and confirms the RPC's total drops from 140 to 40 billable minutes.

## Files changed
supabase/migrations/20260818160000_rpc_project_time_totals.sql
lib/supabase/database.types.ts
lib/queries/time-entries.ts
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx
tests/integration/project-time-totals.test.ts

## Commands run
`supabase db push --linked` (0)
`supabase gen types typescript --project-id qcipqonnqajmazdbysow > lib/supabase/database.types.ts` (0)
`npx tsc --noEmit` (0)
`npm run lint` (0 — 1 pre-existing unrelated warning in lib/queries/search.ts, no errors)
`npx vitest run tests/integration/project-time-totals.test.ts` (0 — 2/2 passed)
`npx vitest run` (0 — 94 files / 499 tests passed, full suite)
`npm run build` (0)

## Decisions made
- `get_project_time_totals(p_project_id uuid)` follows F071/F072's exact template: `language sql stable security invoker`, no elevated privilege — RLS on `time_entries` (time_entries_select_active_members) and the join through `tasks` apply exactly as they would to a direct SELECT by the caller. A non-member of the project's workspace gets zero rows, not an error.
- Used `sum(...) filter (where billable)` / `filter (where not billable)` with `coalesce(..., 0)` so a project with zero time entries returns `{0, 0}` instead of `{null, null}` — avoids a null-handling branch in the query layer.
- `getProjectTimeTotals` (lib/queries/time-entries.ts) reads `data?.[0]` rather than `.maybeSingle()` — the generated RPC type for an array-returning `security invoker` function doesn't narrow cleanly under `.maybeSingle()` in this Supabase JS client version (TS2339 on the row properties), so a plain array index is used instead, matching how `search_tasks` is consumed elsewhere in the codebase.
- The header stat only renders when `totalMinutes > 0`, so untouched projects don't show a "0h logged" line; this wasn't specified in the clarified spec but follows the same empty-state convention as other project header elements (e.g. no description falls back to "No description." text, not a blank row).
- Hours are formatted as an integer when exact (e.g. "32h") and to one decimal otherwise (e.g. "32.5h"), matching the spec's own example string "32.5h logged · 18h billable" (rendered here as "32.5h logged (18h billable)" — parenthetical rather than a middle-dot separator, to match the existing header's plain-text style rather than introducing a new typographic character).

## Out-of-scope work needed
- AS-173 (per-person time report scoped to a workspace, selectable date range) is not covered by this feature — it's explicitly a separate assertion belonging to a different feature (not in F114's "Assertion IDs covered" list).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose "(Yh billable)" parenthetical phrasing over the spec's literal "32.5h logged · 18h billable" middle-dot example, since the surrounding header (description line, "Archived" badge) uses plain ASCII punctuation only — kept the new stat visually consistent with that rather than introducing a new separator character.
AUTONOMOUS_DECISION: Render the stat only when total logged minutes > 0, to avoid a permanent "0h logged (0h billable)" line on every project with no time tracked yet.

## Notes for the next worker
- The RPC is at `supabase/migrations/20260818160000_rpc_project_time_totals.sql`, applied to the linked remote Supabase project via `supabase db push --linked`.
- `lib/supabase/database.types.ts` was regenerated after the push and now includes `get_project_time_totals` in the `Functions` block (Args: `{ p_project_id: string }`, Returns: `{ billable_minutes: number; non_billable_minutes: number }[]`).
- If a future feature (e.g. AS-173's per-person report) needs a similar RPC, `get_project_time_totals` is a ready template for the `filter (where ...)` billable/non-billable split pattern — reuse rather than reinvent.
- `tests/integration/project-time-totals.test.ts` follows `tests/integration/rls-time-entries.test.ts` (F108) for the admin-client workspace/project/task/entry seeding + `afterAll` cleanup shape.
