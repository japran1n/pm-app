# Handoff: F027 — project list page

## Status
COMPLETE

## Assertions covered
AS-027: PASS — integration test "AS-027: lists all non-deleted projects in the active workspace, excluding soft-deleted ones" (tests/integration/project-list.test.ts), run against the real linked Supabase project.
AS-034: PASS — integration test "AS-034: open task count is explicitly null (pending), never a fabricated number" (tests/integration/project-list.test.ts) — proves `openTaskCount` is a deliberate `null` marker on every project, not a hardcoded 0.
AS-042: PASS — integration test "AS-042: querying a different workspace id returns a different, correctly scoped project list" (tests/integration/project-list.test.ts) — proves the query function the page calls is correctly re-scoped per workspace id, which is what changes when a user switches workspaces via F014's switcher (the URL slug -> `workspace.id` resolution is unchanged from F014's layout and re-runs on every request).

## Files changed
app/(workspace)/w/[workspaceSlug]/projects/page.tsx
app/(workspace)/w/[workspaceSlug]/projects/loading.tsx
app/(workspace)/w/[workspaceSlug]/page.tsx
lib/queries/projects.ts
components/new-project-dialog.tsx
tests/integration/project-list.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npm run build` (0) — `/w/[workspaceSlug]/projects` compiles as a dynamic (ƒ) route
`npm run test` (0) — 24 test files, 130 tests passed, including the 4 new F027 integration tests run against the real linked Supabase project (not skipped — `.env` has admin creds)

## Decisions made
- **Task count (AS-034):** the `tasks` table does not exist yet (confirmed via `find supabase/migrations -iname "*task*"` returning no results; M4/F033+ creates it). Per the task instructions, did NOT hardcode a fake number and did NOT attempt a LEFT JOIN/count against a nonexistent table (that would fail at query time, not "naturally return 0" — PostgREST/Supabase has no way to execute a join against a table that isn't in the schema cache). Instead `lib/queries/projects.ts`'s `getWorkspaceProjects` returns `openTaskCount: number | null`, always `null` today, with a `TODO(F033+)` comment marking exactly where to wire in the real count once the tasks table exists. The UI renders an explicit "Open tasks: pending" badge (`components/ui/badge`, `variant="outline"`) rather than "0 open tasks" or an empty space, so the placeholder state is visible and honest rather than silently indistinguishable from "genuinely zero."
- **Card layout, not table**, for the project list — a responsive `grid` of shadcn `Card`s (per the clarified spec's "usable at mobile width via Tailwind's default stacking" and desktop-first note); a table felt like the wrong fit once task count is a pending badge rather than a dense numeric column, and Cards leave room for AS-029's future edit affordance without redesigning the row.
- **New Project dialog is its own Client Component** (`components/new-project-dialog.tsx`), the smallest possible client boundary per the clarified spec — mirrors `components/invite-member-form.tsx`'s `useState` + `useTransition` pattern (F026's `createProject` takes plain args, not `(prevState, formData)`, so `useActionState` doesn't fit directly). On success it calls `router.refresh()` to re-run the Server Component page and show the new project, and closes the dialog + resets the form fields.
- **All four states handled explicitly** per the clarified spec: loading (`loading.tsx` with `Skeleton`), populated (card grid), empty (dashed-border prompt to create the first project), error (inline `role="alert"` banner + retry link, `console.error`'d — this repo has no Sentry/logging SDK wired up yet, confirmed via package.json, so this follows every other page's existing `console.error` convention, same as F017's `MembersPage`).
- **No page-level access gate beyond the layout guard**, per the clarified spec — reaching this route already means the caller is an active member (F010/F023's layout `notFound()`s otherwise), and neither AS-027, AS-034, nor AS-042 requires role-gating beyond membership.
- **Link added to the workspace home placeholder** (`app/(workspace)/w/[workspaceSlug]/page.tsx`) pointing at `/w/[workspaceSlug]/projects`, per the task instructions — the placeholder page didn't previously link anywhere.
- **AS-042 is tested at the query-function level, not by literally simulating a switcher click**, same approach F014's own AS-042 partial coverage took (see F014's handoff "Out-of-scope work needed") — there's no Playwright/browser harness in this worker's session, and the mechanism under test (the URL slug resolving to a fresh `workspace.id` on every Server Component request, which is what F014's layout already established) is unchanged by this feature. The test proves `getWorkspaceProjects(workspaceAId)` and `getWorkspaceProjects(workspaceBId)` return disjoint, correctly-scoped results, which is exactly what happens when the page re-renders after a switcher navigation.

## Out-of-scope work needed
- **Real open task counts (AS-034's eventual full behavior)** — once the `tasks` table exists (F033+), `lib/queries/projects.ts`'s `getWorkspaceProjects` needs its `TODO(F033+)` replaced with a real count query (LEFT JOIN/count or RPC, filtered to non-deleted, non-`done` tasks), and the "Open tasks: pending" badge in the page should switch to showing the real number.
- **Project edit (AS-029), archive (AS-030/AS-033), and detail navigation (AS-038 Board/List tabs)** are not implemented — this feature's scope was strictly AS-027/AS-034/AS-042 (list + count placeholder + workspace scoping) plus the New Project dialog. Cards are not currently clickable/linked anywhere since there's no project detail route yet (lands with later M3 features per plan.md).
- **No component-level render test for `NewProjectDialog`** — same infra gap F014's handoff already flagged for `WorkspaceSwitcher`: `vitest.config.ts` runs in `environment: "node"` with no `@testing-library/react`/jsdom, so client-component interaction (open dialog, submit form) isn't unit-tested here. Covered instead by `npm run build`'s successful compile, `tsc`/`eslint` passing, and the underlying `createProject` Server Action's own F026 integration test coverage.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose Card-grid over Table for the project list (see "Decisions made" above) — the clarified spec allowed either ("shown as a card or table row") and didn't specify which.
AUTONOMOUS_DECISION: Sorted projects by `created_at` descending (newest first) — the spec didn't specify an ordering; this surfaces a just-created project (from the New Project dialog) at the top without needing client-side re-sorting after `router.refresh()`.

## Notes for the next worker
- Manual verification via `npm run dev` / a browser was **not performed** — same rationale as F014's handoff: this worker session has no browser automation tool and no way to obtain a real authenticated session/cookie to click through the flow end-to-end. Verification relied on `npm run build`'s successful route compile, `tsc`/`eslint` passing, and integration tests against the real linked Supabase project (not mocks, except for the request-scoped `createClient()` wrapper itself, which is mocked to return the real signed-in test user's client — same pattern as `tests/integration/create-project.test.ts`).
- `lib/queries/projects.ts` exports `ProjectListItem` (including the `openTaskCount: number | null` type) for reuse by any future feature that also needs this shape (e.g. a dashboard or search result card).
- MCP used: none (no Supabase MCP tool access was available in this worker's session; verification was done by running the real integration tests against the linked project via `.env` credentials, same workaround noted in F013/F014's handoffs).
