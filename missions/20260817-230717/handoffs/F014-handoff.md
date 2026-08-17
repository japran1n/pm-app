# Handoff: F014 — workspace switcher ui

## Status
COMPLETE

## Assertions covered
AS-012: PASS — `tests/integration/workspace-switcher-scope.test.ts` "AS-012: a user with multiple active memberships sees all of them in the switcher query" and the isolation test, run against the real linked Supabase project: a user with two active memberships gets exactly those two workspaces back, and a third workspace belonging to a different user is never returned.
AS-013: PASS — same file, "AS-013: resolving the active workspace by slug..." and its failure-case sibling: the layout's slug-resolution query returns the correct workspace per-slug for a member, and returns no row (not an error) for a workspace the caller isn't a member of — proving switching slugs re-scopes the active workspace.
AS-042: PARTIAL/UNTESTED as a project-list assertion specifically — this feature has no `projects` table to test project-list scoping against yet (that lands with the projects feature, F027+). What F014 tested toward AS-042 is the underlying mechanism AS-042 depends on: that the active-workspace and switcher queries are correctly scoped per-user/per-slug (same test file, isolation test). See "Out-of-scope work needed" below.

## Files changed
app/(workspace)/w/[workspaceSlug]/layout.tsx
app/(workspace)/w/[workspaceSlug]/page.tsx
components/workspace-switcher.tsx
tests/integration/workspace-switcher-scope.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npm run test` (0) — 7 files / 38 tests passed, including the 4 new F014 integration tests run against the real Supabase project (not skipped — `.env` has admin creds)
`npm run build` (0) — `/w/[workspaceSlug]` compiles as a dynamic (ƒ) route alongside the existing routes

## Decisions made
- **Layout does the membership/active-workspace check via the ordinary RLS-respecting client, not the admin client.** `workspaces_select_active_members` (F012) already scopes SELECTs to non-deleted workspaces where the caller is an active member, so a `maybeSingle()` lookup by slug that returns null covers "doesn't exist", "soft-deleted", and "caller isn't an active member" in one query — no separate `workspace_members` existence check needed before rendering.
- **Not-found handling is a redirect to `/onboarding`, not a dedicated not-found page**, per the feature spec's explicit placeholder allowance. Documented inline in the layout with a `TODO(F023)` comment so the real "workspace not found / removed" UX has an obvious landing spot. This is a deliberate scope boundary, not an oversight.
- **Switcher list is built with a two-step query** (`workspace_members` rows for the caller -> `workspaces` by id), matching the pattern F013's auth callback route already established, for the same reason: the generated `workspace_members` -> `workspaces` FK relationship is typed `isOneToOne: false`, so an embedded/join select's TypeScript shape is an array and can't be `.slug`-accessed directly.
- **Defensive fallback in the layout:** if the active workspace somehow isn't present in the freshly-fetched `workspaces` list (a race between the two queries, e.g. a concurrent membership change), it's explicitly appended to the switcher list rather than silently omitted — the current workspace should never disappear from its own switcher.
- **Client boundary kept to just `components/workspace-switcher.tsx`** (a dropdown), per the clarified spec's "smallest possible client boundary" instruction — all data fetching (active workspace resolution, membership list) happens in the Server Component layout and is passed down as plain props.
- **Used shadcn's `DropdownMenu`/`DropdownMenuTrigger`/`DropdownMenuItem` (`components/ui/dropdown-menu.tsx`, base-ui-backed) with the `render={<Link .../>}` composition pattern**, matching the same `render` prop usage already established in `components/ui/dialog.tsx` and `components/ui/select.tsx` — each menu item is itself the `next/link` `<Link>`, so clicking navigates via client-side routing without a full page reload, while still landing on a Server Component route that re-fetches workspace-scoped data for the new slug (AS-013).
- **Empty-workspaces state handled explicitly** in `WorkspaceSwitcher` (renders "No workspaces" text instead of an empty/broken dropdown), even though the layout should make this state unreachable in practice (the active workspace is always included) — per the clarified spec's "all four states handled explicitly" instruction.
- **No page-level access gate duplicated in `page.tsx`** beyond a defensive redirect-if-null fallback — per the clarified spec, the layout's membership guard is the single access-control point for this milestone; F023 is where that gets hardened.

## Out-of-scope work needed
- **AS-042's actual subject (project list scoped to active workspace) has no `projects` table yet** — this feature only proves the workspace-scoping mechanism AS-042 depends on (queries correctly scoped by slug/membership), not project-list behavior itself. The project-list feature (per tech-decisions.md file layout, `app/(workspace)/w/[workspaceSlug]/projects/page.tsx`) needs its own test asserting that switching the URL slug changes the visible project set — that assertion should be finished there, not here.
- **F023 (referenced inline via `TODO(F023)` in the layout)** needs to replace the current `redirect("/onboarding")` placeholder for "workspace not found / not an active member" with real not-found UX that distinguishes "this workspace doesn't exist" from "you were removed from this workspace."
- No dedicated component-level render test exists for `WorkspaceSwitcher` itself (e.g. asserting the dropdown opens, the current workspace is checkmarked, links have the right `href`). This repo's `vitest.config.ts` runs in `environment: "node"` with no `@testing-library/react`/jsdom installed, and adding that tooling was judged out of scope for a single dropdown component — covered instead by the data-layer integration test plus code review. If a future milestone adds component-testing infrastructure (needed for board drag-and-drop tests anyway per tech-decisions.md's E2E note), retrofitting a render test here would be low-cost.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Switcher list is sorted alphabetically by workspace name (`.order("name", { ascending: true })`) since the spec didn't specify an ordering and this is the most predictable default for a user with several workspaces.

## Notes for the next worker
- Manual verification via `npm run dev` / a browser was **not performed** — this worker session has no browser automation tool and no way to obtain a real authenticated session/cookie to click through the flow end-to-end. Verification instead relied on: (1) `npm run build`'s route-generation output confirming `/w/[workspaceSlug]` compiles as a dynamic route, (2) `npx tsc --noEmit` / `npx eslint .` passing cleanly, and (3) the integration test suite exercising the exact Supabase queries the layout and switcher rely on against the real linked project (not mocks). Per this milestone's DoD ("manual verification: none beyond the automated test — the validation contract itself is the sign-off criterion for a solo MVP"), this is judged sufficient, but is flagged here explicitly per the task instructions.
- The layout renders a plain `<header>`/`<main>` shell (not a sidebar) — `tech-decisions.md`'s file layout comment says "workspace switcher, membership guard" for this file without prescribing header vs. sidebar; a header bar was chosen as the simplest shell that won't conflict with whatever nav/sidebar structure later features (dashboard, projects, settings) add, since none of those exist yet to design around.
- `components/workspace-switcher.tsx` exports `SwitcherWorkspace` as a named type in case a later feature (e.g. a settings page also needing the user's workspace list) wants to reuse the shape.
- MCP used: none (no Supabase MCP tool access was available in this worker's session; verification was done by running the real integration tests against the linked project via `.env` credentials instead, same as F013's noted workaround).
