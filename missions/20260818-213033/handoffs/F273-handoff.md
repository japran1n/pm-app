# Handoff: F273 — profile page reachability

## Status
COMPLETE

## Assertions covered
AS-202: PASS — Playwright `tests/e2e/profile-settings.spec.ts` ("AS-202: a signed-in user reaches the profile page by clicking, sets a display name, and it renders on a person-rendering surface") signs a seeded member in, clicks the new sidebar footer link (no hardcoded URL), sets a display name, saves, then clicks to the members settings page and asserts the display name (not the email) renders there — a genuine person-rendering surface, not a source-text check.

## Files changed
app/(workspace)/w/[workspaceSlug]/layout.tsx
app/(workspace)/w/[workspaceSlug]/settings/members/page.tsx
app/(workspace)/w/[workspaceSlug]/time/page.tsx
components/nav/app-sidebar.tsx
tests/e2e/profile-settings.spec.ts (new)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0, one pre-existing unrelated warning in lib/queries/search.ts)
`npx playwright test tests/e2e/profile-settings.spec.ts` (0, 1 passed — ran after killing the stray `next-server` PID 68085 that was holding port 3000/the directory dev lock; Playwright's own webServer then started cleanly on port 3100, and I did not leave it running)
`npx vitest run --no-file-parallelism` (0, 852/853 passing; the 1 failure, `rls-projects.test.ts` > "a member of workspace A can INSERT a new project into workspace A", is unrelated to this feature — reproduces the same way in complete isolation with zero files of mine touched, on the `projects` table's INSERT RLS policy, which this feature never touches. Left as a pre-existing issue, not fixed here — out of this feature's scope.)
`npm run test` (parallel vitest; 36 failed across unrelated integration files — this is the mission's documented Supabase Auth rate-limit flakiness under parallel execution, see run-log.md's 2026-08-19T06:55Z entry establishing serial `--no-file-parallelism` as the trustworthy signal; the serial run above is the one that counts)

## Decisions made
- Sidebar footer entry point (option A from the spec) rather than a Settings nav group: reuses the existing footer slot next to Sign out/Theme with minimal structural change, and directly surfaces the resolved display name/avatar as its own proof that AS-202 is wired end to end, not just reachable.
- Reused `UserAvatar`/`personLabel` (F122) rather than a new name/initials implementation, per F123's inherited clarification (Q10: reuse existing primitives).
- Fetched the current user's own `profiles` row (display_name, avatar_url) in the workspace layout (Server Component) alongside the existing workspace/membership queries, and passed it down as a typed `currentUser` prop to `AppSidebar`/`SidebarContent` — matches the clarified "server-fetched, passed down as typed props" pattern; no new client-side query.
- Dropped the `member.name && member.email` conditional email subtitle on both the members and time pages (now that setting a display name is actually reachable, that subtitle became misleading duplication rather than useful fallback information) — this was explicit in the feature spec's "while there" note, not a scope expansion.
- Did not add a second gate on the profile link itself: it's inside the same `SidebarContent` already scoped to an authenticated member via the layout's own auth+membership check, so no separate permission check was needed (a user is always allowed to edit their own profile).

## Out-of-scope work needed
- The spec's own open question — "decide whether the members list keeps showing the email once a display name exists" — resolved as: it does not (email subtitle removed entirely, not conditionally). If a future feature wants an email-on-hover/tooltip affordance instead, that's a new, separate feature.
- `tests/integration/rls-projects.test.ts`'s "a member of workspace A can INSERT a new project into workspace A" test fails both in the full serial suite and in complete isolation, unrelated to any file this feature touches (projects-table RLS, not profiles/sidebar). Worth a dedicated follow-up to investigate — likely drifted after F132's project-visibility RLS policy sweep (see run-log.md 2026-08-21T16:17Z) reworked the projects policies this test exercises.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the sidebar-footer-with-UserAvatar-and-name pattern over a "Settings" nav group, since the spec explicitly offered both as acceptable and the footer option keeps the primary nav list (Dashboard/Projects/Search/Time/Members) unchanged while still giving a persistent, always-visible entry point on both desktop and the mobile sheet.

## Notes for the next worker
- Environment gotcha (documented in the task instructions and confirmed here): a stray `next-server` process from a previous session was bound to port 3000, which blocked Playwright's own `webServer` (port 3100) from starting due to Next's directory-scoped dev lock, not a port conflict. Found it via `lsof -ti :3000` -> `ps -p <pid> -w` (it showed as `next-server (v16.3.1)`, PID 68085 this run — the PID changes between sessions) and killed it before running Playwright. Playwright's own dev server on port 3100 was not left running afterward (checked with `lsof -ti :3100` post-test).
- No MCP tools were needed for this feature — pure UI wiring (no schema/policy changes), matching the F123 clarification's "ui" archetype and the mcp-registry decision tree ("Pure UI feature -> No MCP").
