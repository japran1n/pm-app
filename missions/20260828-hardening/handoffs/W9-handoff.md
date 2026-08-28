# Handoff: W9b — React.cache() query dedup and Suspense boundaries

## Status
COMPLETE

## Assertions covered
N/A — this is a perf/hardening task, not tied to validation-contract.md assertion IDs.

## Files changed
lib/queries/projects.ts
app/(workspace)/w/[workspaceSlug]/timeline/page.tsx
app/(workspace)/w/[workspaceSlug]/calendar/page.tsx
app/(workspace)/w/[workspaceSlug]/projects/page.tsx
missions/20260828-hardening/handoffs/W9-handoff.md

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 6 pre-existing warnings unrelated to this change)
`npx vitest run tests/unit` (0) — 179 files / 1392 tests passed

## Decisions made

### Task 1 — React.cache()
- Searched `lib/queries/` for `getWorkspaceBySlug`, `getWorkspaceMember*`,
  `getProjectById`, `getCurrentUser*`. `getWorkspaceBySlug` does not exist
  in this codebase (workspace-by-slug lookups are done inline via
  `supabase.from("workspaces").select(...)` in each page, not a shared
  query function) — nothing to wrap there.
- Found three real candidates: `getWorkspaceMembers` (members.ts),
  `getCurrentUserTimezone` (profile.ts), `getProjectById` (projects.ts).
- Only **`getProjectById`** met both criteria cleanly: it's pure/
  deterministic (admin-client read scoped by `workspaceId`/`projectId`,
  no side effects) AND is called from both a **layout**
  (`projects/[projectId]/layout.tsx`) and its nested **pages**
  (`docs/layout.tsx`, `docs/page.tsx`, `docs/[docId]/page.tsx`) within the
  same request tree with identical primitive string args — exactly the
  layout+page dedup case `React.cache()` is for. Wrapped it:
  `export const getProjectById = cache(async function getProjectById(...) {...})`.
- Rejected `getCurrentUserTimezone` as a cache target: its signature takes
  a `SupabaseClient` as its first argument, and every caller builds its
  own client via `await createClient()`. `React.cache()` memoizes by
  argument identity — since each call site passes a *different* client
  object reference, wrapping it would never actually dedup anything
  (cache misses every time), so it would add indirection with zero
  benefit. Left untouched.
- Rejected `getWorkspaceMembers` as a cache target for this pass: grep
  showed it's called from several *sibling* pages (settings/audit,
  settings/members, calendar, board, list, time) but never from a layout
  wrapping those pages plus the page itself in the same tree — so within
  any single request it's currently only invoked once already. No dedup
  win to claim; wrapping it would be cache-for-cache's-sake. Documented
  here as a candidate if a future feature introduces a layout that also
  needs workspace members.
- `getWorkspaceMembers`/`getWorkspaceMembers`-adjacent grep hits in
  `assignee-names.ts`, `notifications.ts`, `people.ts`, `docs.ts` were all
  doc-comment mentions, not actual function definitions — no code to
  touch there.

### Task 2 — Suspense boundaries
For each of the 3 pages, split the Server Component into (a) an outer
page function that resolves cheap, non-fetched-data-dependent state
(auth, workspace-by-slug lookup, URL param parsing, header/toolbar/filter
option data) and renders immediately, and (b) an inner `async` Server
atComponent holding the heaviest data-dependent fetch + its render, wrapped
in `<Suspense fallback={<div className="animate-pulse h-32 rounded-lg
bg-muted" />}>` at the call site.

- **timeline/page.tsx**: extracted `TimelineBodySection` (holds
  `getTimelineTasks` + `getUndatedTimelineTaskCount` + the dependent
  `getTimelineDependencyEdges` call, plus the whole Gantt body/empty-state
  render). The header (title, zoom toolbar, prev/today/next links) depends
  only on `searchParams` and streams ahead of it.
- **calendar/page.tsx**: extracted `CalendarGridSection` (holds
  `getCalendarTasks` + `getUndatedTaskCount` and the month-grid/empty-state
  render). The filters bar (`<CalendarFilters>`) depends only on the
  already-resolved status/project/member option sets and streams ahead of
  the grid's own task fetch. Also moved `getUndatedTaskCount` out of the
  original page-level `Promise.all` batch into the new section's own
  batch, since it's only needed once the grid streams in.
- **projects/page.tsx**: extracted `ProjectsGridSection` (holds
  `getWorkspaceProjects` + `getFavoriteProjectIds`, including the
  per-project open-task-count batching already inside
  `getWorkspaceProjects`, plus the grid/empty-state/error render). The
  header (title, "New Project" dialog with template options) depends only
  on caller membership + template options and streams ahead of the
  project list fetch.

All three fallbacks use the exact skeleton markup specified in the task
(`animate-pulse h-32 rounded-lg bg-muted`).

## Out-of-scope work needed
- `getWorkspaceMembers` could become a `React.cache()` candidate if a
  future feature adds a layout above `projects/[projectId]/board` or
  `list` that also needs workspace members — not done now since there's
  no current dedup win to claim.
- No other pages beyond the 3 named in the task were touched for
  Suspense; other data-heavy pages (e.g. `my-tasks/page.tsx`,
  `projects/[projectId]/board/page.tsx`) were out of this feature's
  explicit scope.

## Blockers
None.

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted "pure/deterministic AND called from both
layouts and pages" as the operative test for which functions to wrap
(rather than wrapping every function the initial grep matched), since two
of the four literal names in the task (`getWorkspaceBySlug`) don't exist
in this codebase and a couple of grep hits were comments, not functions.
Only wrapped `getProjectById`, which is the one unambiguous match; left
`getCurrentUserTimezone` and `getWorkspaceMembers` documented above with
the reasoning for skipping them rather than wrapping speculatively.

AUTONOMOUS_DECISION: For each Suspense boundary, chose the split point
to be "everything derivable without the heaviest data-dependent fetch"
vs. "the heaviest data-dependent fetch + its render", extracting the
latter into a small async Server Component, rather than wrapping the
entire page body in one Suspense (which would give no streaming benefit
since the whole page already needs the fetch before first paint) or
wrapping every individual list item (over-engineering beyond what these
three pages' single dominant panel needs).

## Notes for the next worker
- No MCP tools used — this task never touches live Supabase schema/policy
  state, only application code (query functions and Server Component
  structure), per the `worker-mcp-usage` skill's own decision tree ("Pure
  UI feature" / in-repo query refactor row).
- The `supabase/.temp/rest-version` and `supabase/.temp/storage-version`
  files showed as modified in `git status` before this task started and
  were deliberately left unstaged/uncommitted — they're local Supabase
  CLI state, not part of this feature's scope.
