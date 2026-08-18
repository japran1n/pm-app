# Handoff: F031 — project notfound handling

## Status
COMPLETE

## Assertions covered
AS-039: PASS — `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx` calls `getProjectById(workspace.id, projectId)` and `notFound()` when it returns null; an invalid/nonexistent id returns null (not a thrown error). Verified in `tests/integration/project-notfound.test.ts`, test "AS-039: an invalid/nonexistent project id resolves to null (-> notFound()), not a thrown error".
AS-040: PASS — a real project id belonging to a different workspace than the one resolved from `workspaceSlug` also returns null from `getProjectById` (its query filters `.eq("workspace_id", workspaceId)`), hitting the identical `notFound()` branch as AS-039 — never partial data, never a distinguishable error/redirect. Verified in two tests: "AS-040: a real project id belonging to a different workspace resolves to null, not partial data" and "AS-040 (non-leakage): nonexistent id and wrong-workspace id are indistinguishable results" (asserts `wrongWorkspaceResult` is `toEqual` `nonexistentResult`, i.e. both are exactly `null`).

## Files changed
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx
tests/integration/project-notfound.test.ts
missions/20260817-230717/handoffs/F031-handoff.md

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npx vitest run tests/integration/project-notfound.test.ts` (0) — 4/4 passed standalone
`npm test` (0) — full suite (28 files / 149 tests) passed
`npm run build` (0)

## Decisions made
- **Security check requested in the task brief, result: no gap found.** The brief asked me to verify that `getProjectById` (lib/queries/projects.ts), which uses the Supabase admin client and therefore bypasses ALL RLS (not just the `deleted_at IS NULL` filter it's intentionally working around per F030/AS-032), still re-checks workspace membership before rendering. Traced the full chain:
  1. `getProjectById`'s own query includes `.eq("workspace_id", workspaceId)` as a literal filter clause (not a post-fetch check, but equivalent — it's baked into the WHERE), so it will never return a row for the wrong workspace no matter what `projectId` is guessed.
  2. The `workspaceId` passed to it (`workspace.id` in the layout) is never caller-supplied directly — it comes from a `supabase.from("workspaces").select(...).eq("slug", workspaceSlug).maybeSingle()` call made with the normal (non-admin) client, which is RLS-scoped by `workspaces_select_active_members` (restricts to non-deleted workspaces where the caller is an active member).
  3. That same membership gate is enforced a second time, independently, by the outer `app/(workspace)/w/[workspaceSlug]/layout.tsx` (F010/F023) before this layout is ever reached.
  So there is no path by which a non-member can get a `getProjectById` call executed with a workspace id they don't belong to — the admin client's RLS bypass is scoped by an application-level filter that is itself only ever fed a value sourced from an RLS-scoped query, checked twice. **No fix was needed.** Added an explicit test ("security: a non-member cannot reach getProjectById scoped to another workspace by guessing a valid project UUID" in `tests/integration/project-notfound.test.ts`) proving this end-to-end: an outsider with zero memberships in either seeded workspace gets `null` from the RLS-scoped slug lookup for workspace B's real slug, which is the layout's only source of the `workspaceId` argument — so no project UUID they could guess would ever be checked against workspace B, regardless of the admin client's bypass.
- The layout's existing `if (!project) notFound()` branch (written by F030, before this feature's assertions AS-039/AS-040 existed) already satisfied both assertions as-is — `getProjectById` returning `null` for "doesn't exist" and "wrong workspace" alike, collapsing to one `notFound()` call, was already the F030 implementation. This feature's work was therefore: (1) the security verification above, (2) writing assertion-referencing tests that didn't exist yet (F030's tests covered AS-038 only, not AS-039/AS-040 by name), and (3) updating the layout's inline comment to document AS-039/AS-040 explicitly rather than only AS-038's original 144-mirroring note. No behavioral code change was required or made.
- Modeled `tests/integration/project-notfound.test.ts` on `tests/integration/workspace-not-found-scope.test.ts` (F023/AS-144)'s pattern of asserting exact result-shape equality between the two "hidden" cases, rather than just "both falsy" — this is what actually proves non-leakage (AS-040's "never... a different error" requirement) rather than merely proving both cases 404 by coincidence of different code paths.

## Out-of-scope work needed
- (carried over from F030, still true) No `page.tsx` exists at the bare `/w/[workspaceSlug]/projects/[projectId]` segment — only `board/` and `list/` children. Out of scope for this feature (AS-039/AS-040 concern the layout's own project-resolution 404 behavior, not routing to a default tab).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Treated the task brief's requested security check as a verification task, not an assumed-fix task — since tracing the code showed the membership re-check already exists (as a query filter fed only by RLS-scoped values, checked at two layout layers), I did not add a redundant explicit post-fetch membership query inside `getProjectById` itself, which would have required an extra round-trip for a property the existing filter already guarantees. Documented the reasoning above and backed it with a new test instead.

## Notes for the next worker
- `tests/integration/project-notfound.test.ts` seeds two workspaces (A, B) with an owner user who is a member of both, plus a separate "outsider" user who is a member of neither — reuse this fixture shape for any future cross-workspace-isolation test rather than duplicating F030's owner-only fixture.
- If a future feature adds a page-level redirect from the bare `[projectId]` segment to `.../board` (flagged as out-of-scope by F030's handoff, still unaddressed), make sure that redirect also runs after — not before — the `getProjectById`/`notFound()` check in this layout, or it would reintroduce a leak: redirecting before the check would happen even for nonexistent/wrong-workspace ids.
