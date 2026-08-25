# Handoff: F263 — project favourites

## Status
COMPLETE

## Assertions covered
AS-510: PASS — `tests/unit/project-favorites-sidebar-pin.test.tsx` (4 tests: favourite renders above the rest of the list, multiple favourites sort alphabetically within the pinned group, no pinned group when nothing is favourited, star toggle calls the action + rolls back on failure), `tests/unit/favorites-action.test.ts` (6 tests: unauth rejected, invalid-uuid rejected, invisible-project rejected even though `project_favorites` RLS is own-row-only, success paths for favourite/unfavourite), and `tests/integration/rls-project-favorites.test.ts` (7 tests, run against the real linked Supabase project via each user's own signed-in session — insert, composite-PK duplicate rejection, delete, cross-user SELECT invisibility, cross-user DELETE no-op, cross-user INSERT-spoof rejection, `ON DELETE CASCADE`). All 17 new tests pass; see Commands run below.

## Files changed
supabase/migrations/20260831010000_project_favorites.sql (new)
lib/validation/favorites.ts (new)
lib/actions/favorites.ts (new)
lib/queries/projects.ts (added `getFavoriteProjectIds`)
components/project-favorite-button.tsx (new — shared star toggle)
components/nav/project-nav-list.tsx (pinned favourites group + star button per row)
app/(workspace)/w/[workspaceSlug]/layout.tsx (fetches favourite ids alongside the existing project list query, threads `isFavorite` into `SidebarProjectItem`)
app/(workspace)/w/[workspaceSlug]/projects/page.tsx (star button per project card, server-fetched favourite ids)
lib/supabase/database.types.ts (regenerated via `supabase gen types typescript --linked`)
tests/unit/project-favorites-sidebar-pin.test.tsx (new)
tests/unit/favorites-action.test.ts (new)
tests/integration/rls-project-favorites.test.ts (new)

## Commands run
`supabase db push` (0 — migration `20260831010000_project_favorites.sql` applied to the linked project `qcipqonnqajmazdbysow`)
`supabase gen types typescript --linked > lib/supabase/database.types.ts` (0, `project_favorites` present in the regenerated types)
`npx tsc --noEmit` (0, clean)
`npx eslint .` (0 errors; 6 pre-existing warnings in files this feature does not touch)
`npx vitest run tests/unit/project-favorites-sidebar-pin.test.tsx tests/unit/app-sidebar-project-nav-list.test.tsx` (0, 10/10 passed)
`npx vitest run tests/unit/favorites-action.test.ts` (0, 6/6 passed)
`npx vitest run tests/integration/rls-project-favorites.test.ts` (0, 7/7 passed against the real linked Supabase project)
`npx vitest run` full suite (exit 1: 47 failed files / 61 failed tests / 2242 passed / 153 skipped out of 2456). Compared against a `git stash -u` baseline (this feature's changes fully removed, including its new test files): baseline full-suite run was 95 failed tests — strictly MORE failures than with this feature's changes present. Spot-re-ran 3 of the "failed" files in isolation (`rls-workspaces.test.ts`, `create-workspace-owner.test.ts`, `rls-project-favorites.test.ts` itself) immediately after the full-suite run: all 21 tests passed cleanly outside the full-suite's concurrency. This matches NEXT-SESSION.md's documented "known infra conditions" (auth/network flakiness against the live Supabase project under full-suite concurrency, e.g. `AuthRetryableFetchError`/"Something went wrong" from rate-limited auth calls) — not a regression this feature introduced. Full logs at /tmp/vitest-final.log and /tmp/vitest-baseline.log (not committed).
`npx next build` (0, Turbopack build succeeded, all routes compiled including `/w/[workspaceSlug]/projects`)

## Decisions made
- RLS on `project_favorites` is own-row only (`user_id = auth.uid()`), NOT gated on `is_project_visible_to(project_id)`, per the feature spec's explicit "own-row policy, not project-scoped" instruction. Read-side leak prevention (an orphaned favourite for a project the user can no longer see must never render as pinned) is handled in the READ QUERY instead: `getFavoriteProjectIds` (lib/queries/projects.ts) re-derives visibility by re-selecting the favourited project ids through the same RLS-scoped `projects` table the sidebar already uses (`.is("deleted_at", null)`, scoped to the workspace), rather than encoding visibility into the favorites table's own RLS. This was an explicit design question the spec raised ("consider whether an orphaned favorite... should be filtered out in the read query") — resolved as described, recorded here per the clarification's ambiguity-resolution convention.
- The Server Action (`favoriteProject`) independently re-checks project visibility via a plain RLS-backed `projects` select before writing the favourite row. This is NOT just defense-in-depth: because `project_favorites`' own RLS has no project-visibility predicate by design (see above), this application-layer check is the ONLY thing preventing a caller from favouriting a project they cannot see. Documented in the action file's own header comment so a future worker doesn't "simplify" it away thinking it's redundant with RLS.
- Ordering within the pinned favourites group: alphabetical by project name, per the clarification's explicit "manual ordering is not in scope" answer. The non-favourite group keeps its existing order (`getWorkspaceProjects`' `created_at desc`) unchanged — favouriting only changes WHERE a project renders, not the relative order of the rest of the list.
- One shared `ProjectFavoriteButton` component (components/project-favorite-button.tsx) is used by BOTH the sidebar row and the `/projects` page card, per the clarified "same underlying action" instruction — no second optimistic-toggle implementation. It calls `event.preventDefault()`/`stopPropagation()` when used inside a project row `<Link>` (sidebar) so clicking the star doesn't also trigger navigation.
- `SidebarProjectItem.isFavorite` is typed OPTIONAL (`isFavorite?: boolean`, defaulting to `false` when read) rather than required, specifically so every pre-F263 test/caller building a `SidebarProjectItem` literal without this field keeps compiling and rendering unfavourited — matches this file's existing backward-compatible-optional-prop convention (see F262's own handoff notes on the same file). Verified: F262's own pre-existing test file (`tests/unit/app-sidebar-project-nav-list.test.tsx`) needed zero changes.
- `ProjectNavList`'s pinned-group re-sort only commits on the CONFIRMED server result (via `ProjectFavoriteButton`'s `onChange` callback, fired only in the success branch), not while a toggle is still optimistically pending — a row doesn't visually jump between the pinned/unpinned groups mid-flight, only once the write actually lands (or reverts silently in place on failure, since the button's own local optimistic state already rolled back and `onChange` is never called on failure).
- The star button is visually subordinate in the sidebar row (opacity-0, shown on row hover/focus/pressed via `group-hover`/`focus-visible`/`aria-[pressed=true]`) so it doesn't compete with the project name/key for attention in the compact nav row — same "visually subordinate" pattern this mission's F165 Watchers toggle established for a comparable secondary per-row affordance. On the `/projects` page card it's a plain always-visible icon button alongside the other card actions (Save as template, Edit, Archive) since that page's cards already show a row of icon-only actions.

## Out-of-scope work needed
- No "Favourites" filter/section exists anywhere except the sidebar's own pinned group — e.g. the `/projects` page itself does not visually group/reorder favourited projects, only marks them with a filled star. Not requested by the spec (which named the pinned sidebar group specifically), flagging in case a future feature wants the `/projects` page to mirror the pinned grouping.
- No bulk "manage favourites" UI (e.g. a dedicated list of just favourited projects) — the spec explicitly scoped manual ordering out, and neither the spec nor clarification asked for a management view.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: filtered orphaned favourites in the READ QUERY (`getFavoriteProjectIds` re-derives visibility via the RLS-scoped `projects` select) rather than adding a project-visibility predicate to `project_favorites`' own RLS policies — the spec explicitly called for "own-row RLS, not project-scoped" while also flagging the orphaned-favourite leak risk as something to "consider"; this resolves both without contradicting either instruction, and is the simpler option (no new RLS helper function, reuses the exact query pattern `getWorkspaceProjects` already uses).
AUTONOMOUS_DECISION: made `SidebarProjectItem.isFavorite` optional (default false) rather than required, to avoid a breaking change to F262's existing test file and any other caller that predates this feature — same backward-compatible-optional-prop convention that file's other props (`initialNotifications`, `projects`, etc. in AppSidebar) already follow.
AUTONOMOUS_DECISION: built one shared `ProjectFavoriteButton` component for both call sites (sidebar row, `/projects` page card) instead of two separate optimistic-toggle implementations, per the clarified "same underlying action" instruction and this mission's "no second source of truth" convention.

## Notes for the next worker
- MCP: Supabase MCP was not available/connected in this sandbox (mcp-registry.md documents it as "Pending approval" — never blocking); used the Supabase CLI directly per the registry's documented fallback: `supabase db push` (applied cleanly, single migration) and `supabase gen types typescript --linked` (regenerated `lib/supabase/database.types.ts`, confirmed `project_favorites` present in the output).
- `getFavoriteProjectIds` and `getWorkspaceProjects` are both called once per relevant page/layout render (workspace layout for the sidebar, `/projects` page for the cards) — if a future feature adds a THIRD place that needs a project's favourite status, reuse `getFavoriteProjectIds` rather than writing a new query; it already returns a plain `Set<string>` of project ids, cheap to check with `.has()`.
- The full-suite vitest run in this sandbox is dominated by pre-existing integration-test flakiness against the live Supabase project under concurrency (documented in NEXT-SESSION.md's "known infra conditions", and independently reproduced by this feature's own `git stash -u` baseline comparison — see Commands run above). Re-running a handful of the "failed" files in isolation immediately afterward is enough to confirm it's infra-related, not a real regression — this is the same pattern F262's handoff documented; worth reusing for any future feature that runs the full suite and sees a large, seemingly-unrelated failure spread.
- `project_favorites` has no UPDATE policy by design (a favourite is add/remove only, nothing on the row is ever mutated in place) — if a future feature wants e.g. a manual sort-order column on this table, it will need a new migration adding both the column and an UPDATE policy; this migration deliberately did not speculatively add either.
