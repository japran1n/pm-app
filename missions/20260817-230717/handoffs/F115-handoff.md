# Handoff: F115 — person time report

## Status
COMPLETE

## Assertions covered
AS-173: PASS — new `get_workspace_time_by_person(p_workspace_id, p_start_date, p_end_date)` RPC (`supabase/migrations/20260818170000_rpc_workspace_time_by_person.sql`) returns per-user_id billable/non-billable minute totals scoped to the workspace via tasks->projects->workspace_id, filtered on `entry_date between p_start_date and p_end_date`. New `app/(workspace)/w/[workspaceSlug]/time/page.tsx` renders a date-range picker (default: first day of current month → today) and a table of workspace members with billable/non-billable/total columns. Verified via `tests/integration/workspace-time-by-person.test.ts` (`AS-173` test): 3/3 tests pass against the real linked Supabase project.
AS-174: PASS — RPC filters `t.deleted_at is null`; verified by the "AS-174" test in the same file, which soft-deletes a task mid-test and confirms its 100 previously-counted billable minutes drop out of the per-person total while the kept task's minutes remain.

## Files changed
supabase/migrations/20260818170000_rpc_workspace_time_by_person.sql (new)
lib/supabase/database.types.ts (regenerated via `supabase gen types typescript`)
lib/queries/time-entries.ts (added `getWorkspaceTimeByPerson`)
app/(workspace)/w/[workspaceSlug]/time/page.tsx (new)
components/nav/app-sidebar.tsx (added "Time" nav entry with Clock icon)
tests/integration/workspace-time-by-person.test.ts (new)

## Commands run
`supabase db push --linked` (0)
`supabase gen types typescript --project-id qcipqonnqajmazdbysow > lib/supabase/database.types.ts` (0)
`npx tsc --noEmit` (0)
`npm run lint` (0 — 1 pre-existing unrelated warning in lib/queries/search.ts, 0 errors)
`npm run test` (0 — 95 files, 502 tests passed)
`npx vitest run tests/integration/workspace-time-by-person.test.ts` (0 — 3 tests passed, run against the real linked Supabase project via `.env`)
`npm run build` (0 — Next.js production build succeeded; `/w/[workspaceSlug]/time` route present in output)

## Decisions made
- Followed F114's `get_project_time_totals` pattern exactly for the new RPC: `language sql stable security invoker` so RLS on `time_entries` and `tasks` applies under the caller's own role — a non-member of `p_workspace_id` gets an empty result set, not an error and not another workspace's data. This is the mechanism the AS-176-style test in this feature's test file verifies directly.
- Scoping join is one hop deeper than F114's (`time_entries -> tasks -> projects -> workspace_id` vs F114's `time_entries -> tasks -> projects`) since this RPC is workspace-scoped rather than project-scoped; added `p.workspace_id = p_workspace_id` and grouped by `te.user_id`.
- Date range is inclusive on both ends (`entry_date between p_start_date and p_end_date`), matching AS-173's "selectable date range" wording and the page's date-range picker passing inclusive start/end dates.
- Reused `getWorkspaceMembers` (F017, `lib/queries/members.ts`) for member display names/emails rather than re-implementing the Auth Admin API lookup, per the task instructions — it already resolves active members' email/name scoped to RLS-visible user ids.
- Page follows `SearchPage`'s (F069) Server Component + zero-JS GET-form convention: the date inputs write `?start=&end=` and the page re-renders server-side with the new `searchParams`, rather than introducing a Client Component/date-picker library for a single date-range form. No date-picker component exists in `components/ui/`, so plain `<Input type="date">` was used, consistent with the existing `Input` component's support for any native input `type`.
- Per the Clarified implementation section (spec: "Visible to all active workspace members (not admin-only)"), the page has no role gate beyond the existing workspace-membership layout guard (`app/(workspace)/w/[workspaceSlug]/layout.tsx`), matching Search/Members' convention of relying on that guard alone.
- Followed the task instruction's default-range spec literally: first day of current calendar month through today, computed server-side from `new Date()` at request time (not client-side), so it's correct regardless of the client's clock/timezone.
- Did not run `npx playwright test` — F108/F114 (the closest-precedent time-tracking backend features) did not run it in their handoffs either; their evidence commands were tsc/lint/`npm run test`(vitest unit)/`db push`/`gen types`/integration vitest/build, which this handoff matches.

## Out-of-scope work needed
- `getWorkspaceMembers` makes one Auth Admin API call per active member (documented as a known limitation in its own file comment, from F017). The time report page now also depends on this same N-call pattern; if a workspace's member count grows large, a `public.profiles` table populated by an `auth.users` trigger would remove the Auth Admin API dependency for this and the Members page alike. Not addressed here — out of scope for F115, and already flagged by F017's original comment.
- No CSV/export option for the time report — not requested by the spec/clarified answers, noting only in case a future feature wants it.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose plain `<Input type="date">` fields (native browser date pickers) over building/adding a calendar-popover component, since no such component exists yet in `components/ui/` and the clarified spec only calls for "a date-range picker" without specifying a library — this is the minimal, zero-new-dependency way to satisfy that requirement, consistent with SearchPage's zero-client-JS precedent.
AUTONOMOUS_DECISION: The RPC returns rows only for user_ids that have at least one time entry in range (via `group by te.user_id`, no explicit zero-row for members with no entries) — the page fills in the gaps by iterating `members.active` and defaulting to 0/0 for any member with no matching row from the RPC, so the table itself still lists every active member with a $0$ row rather than omitting them.

## Notes for the next worker
- New RPC: `supabase/migrations/20260818170000_rpc_workspace_time_by_person.sql`, applied to the linked remote Supabase project via `supabase db push --linked`.
- New query wrapper: `getWorkspaceTimeByPerson(workspaceId, startDate, endDate)` in `lib/queries/time-entries.ts`, alongside the existing `getProjectTimeTotals`/`getActiveTimer`.
- Test file: `tests/integration/workspace-time-by-person.test.ts`. Follows the same `loadDotEnv`/`describe.skipIf(!haveAdminCreds)` pattern as every other file in `tests/integration/`, plus F077's cross-workspace adversarial style (signs in with a real session via the anon key as a member of workspace A, then calls the RPC with workspace B's id directly) — requires `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` in `.env` to run for real (present in this repo, so it ran against Supabase, not skipped).
- Did not use Supabase MCP for this feature — no ambiguity about the existing schema/RLS shape (F108/F114's migrations and handoffs already fully document the join pattern), so reading the existing migration files directly was sufficient before writing the new one.
- `npm run test` (the tech-decisions.md unit test command) only runs `tests/unit/`; the new integration test lives in `tests/integration/` and is run separately via `npx vitest run tests/integration/workspace-time-by-person.test.ts`, matching F114's and F077's precedent.
