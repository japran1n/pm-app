# Handoff: F023 — not member notfound handling

## Status
COMPLETE

## Assertions covered
AS-144: PASS — `tests/integration/workspace-not-found-scope.test.ts` "AS-144: a nonexistent slug and an existing-but-not-a-member slug resolve identically for a non-member", run against the real linked Supabase project: for a signed-in user with no membership row anywhere, the layout's slug-resolution query (`workspaces` select, RLS-scoped, `.maybeSingle()`) returns an identical `{ data: null, error: null, status }` shape for (a) a slug that doesn't exist at all and (b) a slug belonging to a real workspace the user isn't a member of — proving the layout's `if (!activeWorkspace) notFound()` branch fires identically in both cases and a non-member cannot distinguish the two from the response.

## Files changed
app/(workspace)/w/[workspaceSlug]/layout.tsx
tests/integration/workspace-not-found-scope.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npm run test` (0) — 17 files / 85 tests passed (vitest picks up both tests/unit and tests/integration; the new AS-144 test ran against real Supabase creds, not skipped)
`npm run build` (0) — `/w/[workspaceSlug]` still compiles as a dynamic (ƒ) route; `/_not-found` route present for the `notFound()` call

## Decisions made
- **Replaced the `redirect("/onboarding")` placeholder with `notFound()` from `next/navigation`**, called from the single `if (!activeWorkspace)` branch that already covers all three underlying cases (workspace doesn't exist, is soft-deleted, or caller isn't an active member) — no new branching needed since RLS (`workspaces_select_active_members`, from F012) already collapses those three cases into "no row returned" at the query level. This is exactly what AS-144 needs: one code path, one response, for both "doesn't exist" and "exists but not a member."
- **Did not add a per-case distinction** (e.g. a separate check for "workspace exists at all" via an admin/service-role client to show a different message for members-removed vs never-existed). Doing so would require a privileged lookup solely to decide which message to show, and showing any different message per case is precisely the leak AS-144 prohibits. The clarified spec and AS-144's own text ("does not leak any data about that workspace's existence") rule this out, not just an oversight.
- **No custom `not-found.tsx` UI file added.** The feature spec's DoD says a generic not-found is the requirement; Next's default `notFound()` behavior (nearest `not-found.tsx` boundary, or the framework default 404 if none exists) already satisfies "generic, not distinguishing" without adding new surface area to review. `npm run build`'s route table shows the framework-level `/_not-found` route is present and used.
- **Test asserts on the full query result shape (`data`, `error`, `status`) being `.toEqual` between the two cases**, not just "both are falsy" — matching the task instruction that the actual AS-144 guarantee is indistinguishability, not merely "returns 404." Since the layout renders purely off this query's result, identical query results guarantee identical rendered output (and therefore identical HTTP response) for both cases.

## Out-of-scope work needed
None identified. This closes the last open item from F014's handoff (`TODO(F023)` in the layout, and F014's "Out-of-scope work needed" note about this exact gap).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — the clarified spec and AS-144's assertion text were unambiguous about the required behavior)

## Notes for the next worker
- **Milestone 2 (Auth & Workspace) is now fully complete — 18/18 features.** F023 was the last open item, closing the `TODO(F023)` placeholder left in `app/(workspace)/w/[workspaceSlug]/layout.tsx` by F014. The orchestrator should move to Milestone 3 (Projects) next.
- Verification of the actual rendered 404 page in a browser was not performed (no browser automation tool in this worker session, same constraint F014 noted) — reliance is on `npm run build`'s route table confirming `/_not-found` exists and is wired, plus the integration test proving the exact data-layer signal the layout branches on is identical between the two AS-144 cases. Per this milestone's DoD ("manual verification: none beyond the automated test"), this is judged sufficient.
- MCP used: none (no Supabase MCP tool access available in this worker's session; verification used the real integration test suite against the linked project via `.env` credentials, same workaround noted by F013 and F014).
