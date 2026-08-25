# Handoff: F262 — projects in the sidebar

## Status
COMPLETE

## Assertions covered
AS-509: PASS — `tests/unit/app-sidebar-project-nav-list.test.tsx` "AS-509: lists every project passed in, with its key" and "AS-509: passes the workspace's projects through into the sidebar" (unit, ProjectNavList + AppSidebar). Verified against the assertion text ("lists the workspace's projects, not just a link to the projects page") — the sidebar now renders name+key+colour dot per project, not a bare link.
AS-511: PASS — `tests/unit/app-sidebar-project-nav-list.test.tsx` "AS-511: the project matching the current pathname is highlighted (aria-current)". usePathname mocked to a project route; asserts `aria-current="page"` on the matching link and its absence on the other.
AS-512: PASS — `tests/unit/app-sidebar-project-nav-list.test.tsx` "AS-512: the project list renders inside its own bounded, scrollable container, separate from any pinned nav". Also verified structurally: the primary nav (`data-tour="sidebar-nav"`) in `components/nav/app-sidebar.tsx` is a plain fixed block (no `flex-1`), while `ProjectNavList`'s wrapping `<div className="flex min-h-0 flex-1 ...">` plus its own `max-h-64 overflow-y-auto` inner `<nav>` is the only element that grows/scrolls.
AS-513: PASS — `tests/unit/app-sidebar-project-nav-list.test.tsx` "AS-513: zero projects shows a create-project action inline, not just empty space" and the AppSidebar-level equivalent. Renders the existing `NewProjectDialog` (stubbed in the test to avoid pulling in Server Actions) inline in the empty state.

## Files changed
lib/queries/projects.ts
components/nav/project-nav-list.tsx (new)
components/nav/app-sidebar.tsx
app/(workspace)/w/[workspaceSlug]/layout.tsx
tests/unit/app-sidebar-project-nav-list.test.tsx (new)
tests/unit/app-sidebar-archive-nav.test.tsx
tests/unit/app-sidebar-calendar-timeline-nav.test.tsx
tests/unit/app-sidebar-settings-nav.test.tsx
tests/unit/app-sidebar-trash-nav.test.tsx

## Commands run
`npx vitest run tests/unit/app-sidebar-project-nav-list.test.tsx` (0, 6/6 passed)
`npx vitest run` full suite, twice — once as a baseline with this feature's changes `git stash`ed (28 failed files / 39 failed tests, all pre-existing integration-test flakiness against the live Supabase project per NEXT-SESSION.md's documented "known infra conditions" — e.g. `AuthRetryableFetchError: Database error finding users`), and once after `git stash pop` restoring this feature's changes (22 failed files / 23 failed tests — strictly fewer than baseline; `diff` of the two failure lists confirms zero new failures introduced by this feature and zero app-sidebar/project-nav-list tests in the post-change failure list). Full logs at /tmp/vitest-baseline.log and /tmp/vitest-final.log (not committed).
`npx tsc --noEmit` (0, clean both before and after the sidebar-test fix)
`npx eslint .` (0 errors; 6 pre-existing unrelated warnings in files this feature does not touch)
`npx next build` (0, Turbopack build succeeded, all routes compiled including every `/w/[workspaceSlug]/*` route)

## Decisions made
- Reused `lib/queries/projects.ts`'s existing `getWorkspaceProjects` (RLS-backed `createClient()`, already guest/visibility-scoped per F134/F132's `is_project_visible_to_row`) for the sidebar's project list instead of writing a second query — per the clarification's "no second source of truth" answer and the spec's explicit "reuse the F134/F132 visibility-scoped query" instruction. Only change to that function: also selects/returns `key`.
- Projects have no `color` column (checked every migration touching `projects` — F145's project-keys migration added `key`/`task_counter` only, no colour field ever added later). Per the clarified "simplest option, no new dependency, no second source of truth" answer: the nav dot's colour is derived deterministically from the project id (a small hash against a fixed 8-colour Tailwind palette) rather than adding a schema migration for a decorative dot. AUTONOMOUS_DECISION: no schema change for colour; purely presentational, same project always gets the same dot colour, reversible with zero migration cost if a real `color` column is added later.
- AS-512 ("scrolls without pushing nav items out of view") implemented by restructuring `SidebarContent`'s flex column: the primary nav (Dashboard/My Tasks/etc.) lost its old `flex-1` (it's now a fixed-height block), and the new `ProjectNavList` wrapper is the one `flex-1 min-h-0` element, with its own internal `max-h-64 overflow-y-auto` `<nav>` for the actual project links. This guarantees the primary nav is never pushed out regardless of project count, verified structurally in the AS-512 test.
- Empty-state action (AS-513) reuses `components/new-project-dialog.tsx`'s `NewProjectDialog` directly (its own trigger button + dialog), not a new dialog and not the full `EmptyState` shared component from F252 — `EmptyState`'s `py-16` block styling is sized for a main-content area, not a ~240px-wide sidebar section; a compact inline "No projects yet." + the existing dialog trigger button was the simpler fit with no new dependency. AUTONOMOUS_DECISION: recorded here per the clarification's "simpler option ... recorded in the handoff's Decisions Made" instruction.
- `NewProjectDialog` is mounted with `templateOptions` omitted (defaults to `[]`, blank-project-only form) rather than also fetching `getWorkspaceProjectTemplateOptions` in the layout for every page load — matches the clarification's "keep the query cheap and cached, not a per-navigation refetch" note; the full page (`/projects`) still offers templates, this is just the sidebar's quick-create path.
- The Projects section is visible to every role including guests (no `isGuest` gate), because the underlying `getWorkspaceProjects` query is already RLS-scoped per-caller (a guest simply gets back only their own visible projects) — same "hide nothing, the query already filtered it" convention `Dashboard`/`My Tasks`/`Calendar` already follow in this file, as opposed to the `Members`/`Archive`/`Templates`/`Trash` UI-only role gates (whose underlying *pages*, not just data, are off-limits to a guest).
- Discovered mid-implementation (not a silent override): making `AppSidebar` conditionally mount `NewProjectDialog` (a Client Component that calls `useRouter()`) broke 4 pre-existing sidebar nav tests that mocked only `usePathname` from `next/navigation`. Fixed by adding a minimal `useRouter` mock to those 4 test files' existing `next/navigation` mocks — a legitimate update (the component's actual behaviour changed: it can now mount a router-dependent child), not a loosened assertion; none of those tests' own assertions were touched.

## Out-of-scope work needed
- The main `/projects` page (`app/(workspace)/w/[workspaceSlug]/projects/page.tsx`) still hand-rolls its own zero-state markup instead of using F252's shared `EmptyState` component — noticed while reading that page for the create-dialog reuse, pre-dates this feature, not touched here (out of this feature's file scope).
- No persistence of the sidebar's Projects-section collapsed/expanded state across page loads (local `useState`, defaults to open every navigation) — the clarified spec's "state / storage location" answer (URL params for shareable state, local state for ephemeral UI) treats this as ephemeral UI, so this is the intended behaviour, not a gap, but flagging in case a future feature wants it persisted (e.g. to `localStorage` or a user preference row).
- Real `color` column for projects, if a future feature wants user-customizable project colours instead of the deterministic hash-derived one this feature introduces — see Decisions Made above.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: derived the project nav dot's colour deterministically from the project id against a fixed palette instead of adding a `color` column migration — no such column exists anywhere in the schema, and the clarification's ambiguity-resolution answer calls for the simplest option with no new dependency/second source of truth.
AUTONOMOUS_DECISION: reused `NewProjectDialog` directly (compact inline empty-state) rather than wrapping it in the F252 `EmptyState` shared component, which is sized for full-page zero-states, not a narrow sidebar section.
AUTONOMOUS_DECISION: `NewProjectDialog` mounted in the sidebar without `templateOptions` (blank-project form only) to avoid a second `getWorkspaceProjectTemplateOptions` query on every workspace page load, per the clarification's caching note.

## Notes for the next worker
- `getWorkspaceProjects` (lib/queries/projects.ts) is now used by both `/projects` (F027) and the sidebar (F262) — if you change its return shape, check both call sites plus `app/(workspace)/w/[workspaceSlug]/layout.tsx`'s mapping into `SidebarProjectItem`.
- `AppSidebar`'s `projects` prop defaults to `[]` (backward-compatible with any caller/test predating this feature), which renders the empty state and therefore mounts `NewProjectDialog` — any *new* test that renders `AppSidebar`/`SidebarContent` without an explicit `projects` array must mock `next/navigation`'s `useRouter` (see the 4 test files this feature updated for the pattern), or explicitly pass a non-empty `projects` array to avoid it.
- MCP: none used (registry says none needed for this feature; no live schema change here, `key` column already existed from F145).
- Full-suite vitest runs in this sandbox take ~9-10 minutes and have a real baseline of pre-existing integration-test failures against the live Supabase project (documented in NEXT-SESSION.md's "known infra conditions" — recurring `AuthRetryableFetchError`/network flake class, not something this feature caused or can fix). Compared failure lists before/after this feature's changes via `git stash`/`git stash pop` rather than assuming the raw fail count; this is a Bash pattern worth reusing for any future feature that touches widely-imported shared components (like `app-sidebar.tsx`) where a full-suite regression check matters more than the isolated-file test run.
