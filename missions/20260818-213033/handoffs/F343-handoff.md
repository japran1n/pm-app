# Handoff: F343 — Fix extension context route project-visibility leak (M19 scrutiny BLOCKER-4)

## Status
COMPLETE

## Assertions covered
AS-557: PASS — `app/api/extension/context/route.ts` now filters the workspace's projects through the same rule as `isProjectVisibleToCaller` (workspace-visible, OR caller is workspace owner/admin, OR caller has an explicit `project_members` row) before returning them. Verified live against the real linked Supabase project via `tests/integration/extension-context.test.ts` — 7/7 passing, including 3 new intra-workspace private-project cases (plain member excluded, owner included, explicit project_members row included) plus the 4 pre-existing cross-workspace cases.

## Files changed
app/api/extension/context/route.ts
tests/integration/extension-context.test.ts
missions/20260818-213033/handoffs/F343-handoff.md

## Commands run
`npx vitest run tests/integration/extension-context.test.ts` (0) — 7 passed, run live against real Supabase project (not mocked)
`npx tsc --noEmit` (0)
`npx eslint app/api/extension/context/route.ts tests/integration/extension-context.test.ts` (0)
`npx eslint .` (0, 6 pre-existing unused-var warnings identical to M19-scrutiny.md's recorded set)
`npx vitest run tests/unit` (1 — 168 files / 1339 tests all passed; exit 1 solely from the pre-existing `tests/unit/user-avatar.test.tsx` unhandled-rejection artefact already documented in M18/M19 scrutiny reports, not a real failure)
`npx next build` (0) — full route manifest emitted, including `ƒ /api/extension/context`

## Decisions made
- Selected `visibility` alongside `id, name` in the existing `projects` query (no extra round trip) so the filter can run against data already fetched.
- Batched the private-project membership check into a single `project_members` query (`.in("project_id", privateProjectIds)`) rather than one `isProjectVisibleToCaller` call per project, per the milestone report's explicit preference for avoiding N+1 queries. The filter predicate applied inline (`visibility === "workspace"` OR caller role is owner/admin OR caller's id is in the batched membership set) is the exact same rule `isProjectVisibleToCaller` encodes — I did not reimplement a different policy, just inlined it against a pre-fetched set instead of calling the per-row helper, to keep this route to two total round trips (projects+members, then the batched project_members check) instead of 1+N.
- Considered calling `isProjectVisibleToCaller` directly via `Promise.all` over each project row (true reuse, zero risk of drift) and rejected it only because it reintroduces the N+1 the report asked to avoid; the inline predicate is a direct, deliberately narrow copy of the helper's three-branch rule with a code comment pointing back at the helper and its callers (`lib/tasks/create.ts`, `lib/attachments/upload.ts`) for audit purposes.
- Left the two sibling assignment blocks (member list, workspace list) untouched — the leak was scoped to the projects query only, per the report.

## Out-of-scope work needed
None for this feature. The M19 scrutiny report's other blockers (BLOCKER-1/2/3/5, various majors/minors) are separate follow-ups (FU-1, FU-2, FU-4, FU-5, FU-6, FU-7) not assigned to F343.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to inline the visibility predicate against a batched `project_members` query rather than calling `isProjectVisibleToCaller` per-row, per the report's explicit "prefer a single batched project_members lookup ... to avoid N+1 queries" guidance in FU-3, while keeping the predicate logic byte-for-byte equivalent to the helper's three branches and commenting the equivalence for auditability.

## Notes for the next worker
- The private test project/users are cleaned up in `afterAll` in the new `describe` block; run against the real Supabase project (no service outage risk — inserts/deletes are scoped to freshly created rows with a random suffix).
- No MCP tools were used for this fix — it's pure application-code logic plus an existing integration test file that already establishes the real-Supabase pattern (`createClient` with `SUPABASE_SECRET_KEY`, `.env` loaded via `loadDotEnv()`).
- `membership.role` come from `requireActiveMembership`, which is the same role value `createTaskForUser` passes into `isProjectVisibleToCaller` — no additional membership lookup was needed since the route already resolves it at line ~155 before this fix's code runs.
