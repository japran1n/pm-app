# Plan — Request latency under /w/*

_Mission: 20260913-perf-latency_
_22 features across 5 milestones. Ordered by milliseconds saved per hour of work._

**This is a refactor, not a feature mission.** Nothing here adds, removes or
changes a visible behaviour. Every feature's definition of done includes
AS-025: the page must display exactly what it displayed before. A worker who
finds itself changing what a user sees has left its scope and should stop and
say so in its handoff.

**Ordering rationale.** M1 is first because it is mechanical, carries no
design judgement, and removes roughly a third of the sequential round trips on
its own — and because M4's streaming split is much easier once the layout's
helpers are already deduplicated. M2 is second because it is three small
query edits with the largest single measured win (995 ms on one query) and no
structural risk. M3 and M4 together are what make the layout cheap. M5 is last
because the list route's redirect is self-contained and touches a route the
user exercises constantly.

**Serial execution.** Workers run one at a time. M1's features in particular
build on each other — F001 creates the helper every later feature imports —
and parallel workers in one worktree would collide.

---

## M0 — Make the gate trustworthy

### F000: Declare the `server-only` dependency
**Est:** 30 min · **Depends on:** none
**Covers:** AS-023
- `lib/queries/chat.ts` imports `server-only`, which appears in neither
  `package.json` nor the lockfile. Next's bundler resolves it; vitest does not,
  so every test whose import graph reaches that file dies before it runs —
  including `tests/unit/sign-out-back-navigation.test.ts`, which guards the
  workspace layout that M1 and M4 rewrite
- Add it as a dependency at its current published version and install
- `server-only` throws by design when a client component imports it. If adding
  it surfaces failures in files that were green, that is a real pre-existing
  layering violation: **report it in the handoff, do not fix it** — it is not
  this mission's scope and the orchestrator decides what happens to it
- Remove from `tools/known-failing.txt` any file that now passes
**Files:** `package.json`, `package-lock.json`, `missions/20260913-perf-latency/tools/known-failing.txt`

## M1 — Request-level deduplication

### F001: Request-scoped current-user helper
**Est:** 30 min · **Depends on:** none
**Covers:** AS-003
- New `lib/auth/current-user.ts`: `getCurrentUser()` wrapping `createClient()` + `auth.getUser()` in React `cache()`
- Also export a `cache()`d `getRequestClient()` so call sites share one Supabase client per request
- `lib/actions/authz.ts` already has this shape for `getAuthenticatedUser` — reuse it rather than duplicating; if that function is the right home, extend it and re-export
- Unit test: two calls in one request issue one `auth.getUser()`
**Files:** `lib/auth/current-user.ts`, `tests/unit/pf-current-user-cache.test.ts`

### F002: Request-scoped workspace-by-slug helper
**Est:** 30 min · **Depends on:** F001
**Covers:** AS-002
- `getWorkspaceBySlug(slug)` in `lib/queries/workspaces.ts`, wrapped in `cache()`
- Returns the same shape the workspace layout selects today, so call sites swap without changing their reads
- Unit test: two calls with the same slug issue one query
**Files:** `lib/queries/workspaces.ts`, `tests/unit/pf-workspace-slug-cache.test.ts`

### F003: Workspace layout and header use the cached helpers
**Est:** 45 min · **Depends on:** F002
**Covers:** AS-001, AS-002
- Replace the layout's own `createClient()` + `getUser()` + workspace-by-slug with F001/F002
- Same in `components/nav/app-header.tsx`, which currently adds its own nested auth call
- The slug-history redirect branch keeps working — it reads the same row
**Files:** `app/(workspace)/w/[workspaceSlug]/layout.tsx`, `components/nav/app-header.tsx`

### F004: Thread user id into notification, favourite and tour queries
**Est:** 45 min · **Depends on:** F003
**Covers:** AS-004
- `getNotificationsForWorkspace`, `getFavoriteProjectIds`, `getTourStatus` take the caller's id from the layout instead of resolving it themselves
- `getFavoriteProjectIds` already accepts an optional preloaded id that the layout does not pass — pass it
- Each keeps working when called without an id, so no other call site breaks
**Files:** `lib/queries/notifications.ts`, `lib/queries/projects.ts`, `lib/actions/onboarding-tour.ts`, `app/(workspace)/w/[workspaceSlug]/layout.tsx`

### F005: Thread user id into chat, views, profile and time queries
**Est:** 45 min · **Depends on:** F004
**Covers:** AS-004
- `getWorkspaceChannels` resolves the caller twice — once inline as a filter argument, once in the DM branch. Both take the id from the caller
- Same for `lib/queries/views.ts` (two call sites), `lib/queries/profile.ts`, `lib/queries/time-entries.ts`
**Files:** `lib/queries/chat.ts`, `lib/queries/views.ts`, `lib/queries/profile.ts`, `lib/queries/time-entries.ts`

### F005b: Thread user id into portal queries
**Est:** 45 min · **Depends on:** F005
**Covers:** AS-004
- Created from F005's `SUGGESTED FOLLOWUP` after it stopped short of
  `lib/queries/portal.ts` rather than guess about preview mode
- The orchestrator established that one request is single-identity by
  construction, so the `cache()` leak F005 feared cannot occur. The open
  question is narrower: whether each call site wants the *effective* identity
  (`createClient`, previewed under preview) or the *real* one
  (`createRealSessionClient`, the previewer). See the feature spec
**Files:** `lib/queries/portal.ts`

### F006: Proxy skips the auth call when no session cookie is present
**Est:** 30 min · **Depends on:** none
**Covers:** AS-005, AS-006
- A request with no `sb-*` auth cookie cannot have a session; the redirect decision is already known
- Guard before `updateSession`, returning the same redirect the proxy returns today
- The refresh path for requests that *do* carry a cookie is unchanged — this is the one place session refresh happens
- Unit test both branches against `requiresAuth`'s existing test file if one exists
**Files:** `proxy.ts`, `lib/supabase/proxy-helpers.ts`

### F007: Project and docs layouts use the cached helpers
**Est:** 45 min · **Depends on:** F003
**Covers:** AS-002
- `projects/[projectId]/layout.tsx` re-fetches the workspace by slug the parent already has — use F002
- Same in `docs/layout.tsx`, `projects/[projectId]/docs/layout.tsx`, and the pages under them that repeat the lookup
**Files:** `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx`, `app/(workspace)/w/[workspaceSlug]/docs/layout.tsx`, `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/docs/layout.tsx`

### F008: Chat routes stop re-running the channel chain
**Est:** 45 min · **Depends on:** F005
**Covers:** AS-007
- `getWorkspaceChannels` wrapped in `cache()` keyed by workspace id, so the layout badge, the chat layout and the chat page share one execution
- Drop the chat page's own call where the layout already supplies the list
**Files:** `lib/queries/chat.ts`, `app/(workspace)/w/[workspaceSlug]/chat/layout.tsx`, `app/(workspace)/w/[workspaceSlug]/chat/page.tsx`

---

## M2 — Query narrowing

### F009: Calendar status options constrained by project
**Est:** 30 min · **Depends on:** none
**Covers:** AS-008, AS-011
- `getWorkspaceStatusOptions` scans all 30,998 `project_statuses` rows through `is_project_visible_to` to return 22 — measured 995 ms
- Resolve the workspace's visible project ids first, then `.in("project_id", ids)`; the index `project_statuses_project_id_position_idx` exists
- `my-tasks/page.tsx` already does exactly this on the same table — follow it
- Verify the returned set and order are unchanged
**Files:** `lib/queries/calendar.ts`

### F010: Workspace task list constrained by project
**Est:** 45 min · **Depends on:** none
**Covers:** AS-009, AS-011
- `getWorkspaceListTasks` filters via an inner join on `projects` with no predicate on `tasks.project_id`, so RLS evaluates all 4,738 live tasks — measured 323 ms
- Add `.in("project_id", ids)` using the project list the workspace layout already resolves
- Verify the returned set and order are unchanged
**Files:** `lib/queries/tasks.ts`

### F011: My Tasks driven from the assignee side
**Est:** 45 min · **Depends on:** none
**Covers:** AS-010, AS-011
- `getMyTasks` has the same join shape: RLS runs over every task to return three rows — measured 185 ms
- Drive from `task_assignees` filtered by user id so the outer scan uses that table's user index, then join through to tasks
- Verify the returned set and order are unchanged
**Files:** `lib/queries/my-tasks.ts`

---

## M3 — Badge counters

### F012: Migration — workspace chat unread total
**Est:** 45 min · **Depends on:** none
**Covers:** AS-027
- Additive `CREATE FUNCTION get_workspace_chat_unread_total(p_workspace_id uuid)`, security definer, deriving membership from `auth.uid()`, returning one integer
- Pin `search_path` the way this repo's existing helpers do
- Nothing calls it yet; applying it changes no behaviour
**Files:** `supabase/migrations/<ts>_workspace_chat_unread_total.sql`

### F013: Sidebar unread badge uses the counter
**Est:** 30 min · **Depends on:** F012
**Covers:** AS-012, AS-015
- Replace the badge's 8-step chain with the single call from F012
- The rich `getWorkspaceChannels` stays for the chat routes that need the list
- Verify the number is identical for the demo workspace before and after
**Files:** `lib/queries/chat.ts`, `app/(workspace)/w/[workspaceSlug]/layout.tsx`

### F014: Approvals badge becomes a count query
**Est:** 30 min · **Depends on:** none
**Covers:** AS-013, AS-015
- `getOpenApprovalsForWorkspace` fetches rows, requester names, task titles and phases, then the layout calls `.length`
- Add `getOpenApprovalCountForWorkspace(workspaceId)`: one head count on `approval_requests` joined to the workspace's projects
- Keep the rich function for `/approvals` itself
**Files:** `lib/queries/approvals.ts`, `app/(workspace)/w/[workspaceSlug]/layout.tsx`

### F015: Client-requests badge becomes a count query
**Est:** 30 min · **Depends on:** none
**Covers:** AS-014, AS-015
- Same treatment as F014 for the open client-requests figure
**Files:** `lib/queries/client-requests.ts`, `app/(workspace)/w/[workspaceSlug]/layout.tsx`

---

## M4 — Streaming shell

### F016: Extract each sidebar figure into its own async component
**Est:** 45 min · **Depends on:** F013, F014, F015
**Covers:** AS-017
- One small async server component per figure: notifications, approvals count, requests count, unread count, tour status, favourites, the member's workspace list
- Each fetches its own value; none is awaited by the layout body
- No visual change — the same markup, moved
**Files:** `components/nav/figures/*.tsx`

### F017: Suspense fallbacks that hold their own footprint
**Est:** 45 min · **Depends on:** F016
**Covers:** AS-017, AS-020
- A fallback per figure sized to the resolved figure, so nothing shifts when it arrives
- A badge that resolves to nothing must reserve nothing — an empty badge is not a zero badge
**Files:** `components/nav/figures/*.tsx`, `components/nav/app-sidebar.tsx`

### F018: Workspace layout returns its shell after two round trips
**Est:** 45 min · **Depends on:** F017
**Covers:** AS-016, AS-018
- The layout body awaits the caller and the workspace, nothing else, then returns
- The membership check that gates access stays in the body — it decides whether the page renders at all, so it cannot stream
- Everything else moves into the F016 components
**Files:** `app/(workspace)/w/[workspaceSlug]/layout.tsx`

### F019: Loading boundary for the project segment
**Est:** 30 min · **Depends on:** none
**Covers:** AS-019
- `projects/[projectId]` has no `loading.tsx`, so its children fall back to the workspace-level one, which is dashboard-shaped
- Add one shaped like a project page
**Files:** `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/loading.tsx`

### F020: Project layout streams its rollups
**Est:** 45 min · **Depends on:** F018, F019
**Covers:** AS-016, AS-017
- The header — breadcrumb, name, tabs — renders after the project row alone
- The hours line, the per-person estimate rollup and the link strip each move behind their own boundary
**Files:** `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx`

---

## M5 — List route

### F021: Default saved view applied without a redirect
**Est:** 45 min · **Depends on:** none
**Covers:** AS-021, AS-022
- The list page answers with a redirect to itself when a default view exists, replaying the proxy and both layouts — the reason a click into the list costs more than a cold load
- Apply the view in the same request; keep the URL honest with a rewrite if the view id needs to be in the address
- The view selected must be the one the redirect chose, including when a view id is already in the query
**Files:** `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx`

### F022: List and board pages batch their independent queries
**Est:** 45 min · **Depends on:** F021
**Covers:** AS-016
- Members, saved views and task types depend only on the project and the caller, and currently wait their turn behind the first batch
- Fold them into it on both routes
**Files:** `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx`, `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/board/page.tsx`

---

## Milestone validation

After each milestone the orchestrator runs `npm run test` and `npm run lint`,
then a scrutiny validator reading only the diff. M4 additionally gets a
browser pass on a port other than 3000, checking that the sidebar's links are
present before the badges resolve and that nothing shifts when they do.
