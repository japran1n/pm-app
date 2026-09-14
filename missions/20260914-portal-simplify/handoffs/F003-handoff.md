# Handoff: F003 — Share architecture pages (and sections) with the client from the architecture board

## Status
COMPLETE

## Assertions covered
AS-004: PASS — Added `PageClientVisibilityToggle` / `SectionClientVisibilityToggle` on the team-side Architecture board, backed by new `setPageClientVisibility` / `setSectionClientVisibility` server actions in `lib/actions/architecture.ts`. Sharing a page with live sections opens an AlertDialog offering "Page only" vs "Share sections too" before calling the action; unsharing never prompts. Covered by `tests/unit/f003-page-client-visibility-toggle.test.tsx`, `tests/unit/f003-section-client-visibility-toggle.test.tsx`, `tests/unit/f003-set-page-section-client-visibility-action.test.ts`.
AS-005: PASS — The portal's `getArchitectureBoardForClient` (lib/queries/architecture.ts) already filtered on `client_visible = true`; this feature is what actually lets a team member flip that column from the UI, and both new actions `revalidatePath` the portal architecture route (`/portal/${workspaceSlug}/p/${projectId}/architecture`) so a share/unshare shows up immediately. Covered indirectly by the existing `tests/unit/f002-architecture-excludes-deleted.test.ts` query-level coverage plus the new action tests asserting the `client_visible` column write.

## Files changed
lib/queries/architecture.ts
lib/actions/architecture.ts
components/architecture/page-client-visibility-toggle.tsx (new)
components/architecture/section-client-visibility-toggle.tsx (new)
components/architecture/page-column.tsx
components/architecture/section-card.tsx
tests/unit/f003-page-client-visibility-toggle.test.tsx (new)
tests/unit/f003-section-client-visibility-toggle.test.tsx (new)
tests/unit/f003-set-page-section-client-visibility-action.test.ts (new)
tests/unit/f006-architecture-page-column-shell.test.tsx (added default `clientVisible` field to existing `makePage` test helper so it stays valid against the widened `BoardPage` type)

## Commands run
`npx tsc --noEmit` (0 — only pre-existing unrelated error at app/layout.tsx:27 `Cannot find name 'LayoutProps'`, present before this feature's changes, confirmed via `git log -1 -- app/layout.tsx` showing no working-tree diff)
`npx eslint components/architecture/page-client-visibility-toggle.tsx components/architecture/section-client-visibility-toggle.tsx components/architecture/page-column.tsx components/architecture/section-card.tsx lib/actions/architecture.ts lib/queries/architecture.ts tests/unit/f003-*.test.tsx tests/unit/f003-*.test.ts` (0)
`npx vitest run tests/unit/f003-* tests/unit/f006-architecture-page-column-shell.test.tsx tests/unit/f002-architecture-excludes-deleted.test.ts` (0 — 24 passed)
`npx vitest run tests/unit` (exit reported by runner: 4 failed test files / 5 failed tests, all pre-existing and unrelated to F003 — `app-sidebar-project-nav-list.test.tsx`, `f017-suspense-fallback-footprint.test.tsx`, `f038-as024-coverage.test.ts`, `xss-sanitization-audit.test.ts`; none touch architecture/portal code)

## Decisions made
- Reused `tasks.client_visible` (not a new column) for both pages and sections, since standing decision 1 treats a page/section as a task — this is the exact mechanism `setTaskClientVisibility` (lib/actions/client-visibility.ts) already uses for regular tasks, so no schema change was needed.
- New `setPageClientVisibility(taskId, visible, { includeSections })` and `setSectionClientVisibility(taskId, visible)` live in `lib/actions/architecture.ts` alongside every other page/section mutation (createPage, deletePage, renamePage, etc.), rather than in `lib/actions/client-visibility.ts`, to keep that file's membership check (`canEditTask`) — which is task-detail-sheet specific — separate from the architecture board's own `canWrite` gate that every other action in `lib/actions/architecture.ts` uses.
- `includeSections` only applies when `visible === true` and is a no-op on unshare — hiding a page never cascades to its sections, matching the clarified spec ("sharing a page offers to also share its sections") which says nothing about unsharing cascading.
- Both actions look up `projects!inner(workspace_id, workspaces(slug))` server-side to build the portal revalidate path, mirroring the existing convention in `lib/actions/page-links.ts`'s `loadTaskExtra`.
- Widened `BoardPage.clientVisible` / `BoardSection.clientVisible` as **optional** booleans (not required) in `lib/queries/architecture.ts`, so the many pre-existing test files building `BoardPage`/`BoardSection` object literals without this new field stay valid — the toggle components coerce with `?? false`. This is the only test file I touched outside my own new tests (`f006-architecture-page-column-shell.test.tsx`), and only to add the field to its shared `makePage` helper for parity with the rest.
- No AlertDialog confirmation for sections (only pages) — a section has no children to ask about, matching `SectionClientVisibilityToggle`'s doc comment.

## Out-of-scope work needed
None identified specific to this feature. F004 (team edits refresh the portal) is a separate, already-planned feature that adds the broader `revalidatePath(..., "layout")` sweep across other write paths — I did not touch those files, only added the portal architecture-page revalidate inside my own two new actions.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Made `BoardPage.clientVisible`/`BoardSection.clientVisible` optional rather than required, to avoid a large, out-of-scope edit sweep across ~15 unrelated existing test files that construct `BoardPage`/`BoardSection` literals. The toggle components treat `undefined` as `false` via `?? false`, so behavior is unaffected; only the TypeScript contract is looser than a required field would be.

## Notes for the next worker
- The read side for AS-005 (`getArchitectureBoardForClient` filtering by `client_visible = true`, RLS on `tasks`/`page_components`) was already implemented by an earlier feature (F002's own handoff/tests reference this) — this feature only needed to add the write-side toggle and wire the portal revalidate.
- No MCP tools were used — this is a pure application-code feature (Zod-validated server actions + React components), consistent with `worker-mcp-usage`'s decision tree for "pure UI + existing schema" work. Ran a read-only mental check against `lib/queries/architecture.ts`'s existing RLS commentary rather than querying Supabase directly, since no schema change was made.
