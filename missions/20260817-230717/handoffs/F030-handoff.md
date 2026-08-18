# Handoff: F030 — project detail tabs

## Status
COMPLETE

## Assertions covered
AS-038: PASS — `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx` fetches the project via the new `getProjectById` (lib/queries/projects.ts) and renders a header plus a Board/List tab switcher (`components/project-tabs.tsx`), with real routes at `.../board/page.tsx` and `.../list/page.tsx` (no Timeline tab). Works for both active and archived projects per F029/AS-032, since `getProjectById` uses the admin client to bypass the RLS SELECT policy's `deleted_at IS NULL` filter. Verified in `tests/integration/project-detail.test.ts` (4 tests, all passing): active-project fetch, archived-project fetch, cross-workspace isolation, and nonexistent-id returns null.

## Files changed
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/board/page.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx
components/project-tabs.tsx
lib/queries/projects.ts
app/(workspace)/w/[workspaceSlug]/projects/page.tsx
tests/integration/project-detail.test.ts
missions/20260817-230717/handoffs/F030-handoff.md

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npx vitest run tests/integration/project-detail.test.ts` (0) — 4/4 passed standalone
`npm test` (0) — full suite (27 files / 145 tests) passed
`npm run build` (0)

## Decisions made
- Added `getProjectById` to `lib/queries/projects.ts` (rather than a new file) to keep all project data-fetching in one module, matching the existing `getWorkspaceProjects` convention. It deliberately uses the admin client (bypasses RLS) because the `projects_select_active_members` RLS policy filters `deleted_at IS NULL` — an archived project fetched through the normal client would 404, which contradicts this feature's explicit requirement ("works for both active and archived projects per F029") and AS-032's "row remains fully readable" guarantee. Callers (the layout) still rely on the workspace-membership layout guard (F010/F023) plus this query's own `.eq("workspace_id", ...)` filter for authorization, since the admin client bypasses RLS entirely and can't be trusted to self-authorize.
- Built `ProjectTabs` as a small Client Component using `next/navigation`'s `usePathname`/`useRouter` with shadcn's controlled `Tabs` (`value`/`onValueChange`) rather than an uncontrolled tabs component, because each tab is a real route (`board/page.tsx`, `list/page.tsx`), not client-side content swapping — this keeps the active tab correct on hard refresh/back-button and matches the clarified spec's "primary content server-rendered in initial HTML" (AS-155): only the tab switcher itself is client-rendered, not the tab content.
- Table tab intentionally omitted (marked optional in tech-decisions.md/F030 spec) — adding a third route with no corresponding future-feature owner would be speculative; Board and List already cover the assigned scope, and Timeline is explicitly out of scope.
- Project cards on the list page (F027, `app/(workspace)/w/[workspaceSlug]/projects/page.tsx`) now link their title/description block to `/w/[workspaceSlug]/projects/[projectId]/board` — chose `/board` (not the bare `[projectId]` layout route, which has no own `page.tsx`) so the link lands on real content instead of Next.js needing an index page at the layout's own segment. The Edit/Archive controls in the card header remain un-linked (outside the new `<Link>`) so their buttons/dialogs still work without nested-interactive-control issues.
- The layout shows an "Archived" badge (reusing the existing `components/ui/badge.tsx`, `variant="outline"`) when `project.deletedAt` is set, satisfying the "works for ... archived projects" requirement with a visible signal rather than silently rendering an archived project identically to an active one.
- Wrote `tests/integration/project-detail.test.ts` following the exact `loadDotEnv`/`skipIf(!haveAdminCreds)` pattern from `tests/integration/project-list.test.ts` and `archive-project.test.ts`, seeding an active project, an archived project, and a project in a second workspace to prove workspace-scoping and the archived-project read path directly against the real database.

## Out-of-scope work needed
- Board and List tab content are placeholders only ("Board view coming soon" / "List view coming soon") — real implementations land in F042+ (board) and F053+ (list) per the mission plan; this feature's spec explicitly scopes only the tab shell and routing.
- No "Unarchive" action exists on the detail page yet — F029's handoff flagged this as likely wanted; still not requested by any assigned assertion (AS-038 doesn't call for it), so not added here. A future feature should add it to this layout's header, next to the "Archived" badge.
- The project detail layout has no dedicated loading/error state beyond the default Next.js behavior (`notFound()` for a missing project); the clarified spec's four-state guidance (loading Skeleton, populated, empty, error) is more naturally owned by the F042/F053 tab content pages themselves once they have real async data to guard, since the layout's own fetch is fast (single row by primary key) and errors here are exactly the not-found case already handled.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used the admin client for `getProjectById` instead of trying to loosen the RLS SELECT policy to also return soft-deleted rows to members. Changing RLS to permit reading deleted rows through the normal client would be a broader policy change affecting every other query against `projects`, not just this one detail-page read; scoping the bypass to this one query function (with its own workspace_id-filter authorization) is the narrower, more defensible change and doesn't touch `supabase/migrations/`.
AUTONOMOUS_DECISION: Linked project-list cards to the `/board` tab specifically (not a bare project-id URL) since the layout route itself renders no content without a child page — chose Board over List as the default landing tab since it's listed first in both the spec's "Board and List" phrasing and the validation contract's AS-038 text.

## Notes for the next worker
- `getProjectById(workspaceId, projectId)` in `lib/queries/projects.ts` is now the canonical way to fetch a single project regardless of archived status — reuse it for F042/F053's board/list pages rather than adding another admin-client project-by-id query.
- `ProjectTabs` (`components/project-tabs.tsx`) is deliberately dumb — it only renders Board/List triggers and navigates. If a Table tab is added later, extend the `ProjectTab` union and add a `TabsTrigger` there; don't duplicate the component.
- The project detail route segment has no `page.tsx` of its own (only `layout.tsx` plus `board/`, `list/` children) — visiting the bare `/w/[workspaceSlug]/projects/[projectId]` URL directly will 404 in Next's App Router since there's no page for that exact segment. This is intentional per the "Board and List tab content don't exist as real pages yet" instruction, but a future worker adding a redirect from the bare project URL to `.../board` (via a thin `page.tsx` with `redirect()`) would smooth this over — flagging since it wasn't in this feature's assigned scope.
