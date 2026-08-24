# Handoff: F255 — skeletons for every data-fetching route

## Status
COMPLETE

## Assertions covered
AS-495: PASS — every fetching route under `app/(workspace)/w/[workspaceSlug]/**/` now has its own `loading.tsx` shaped like its real content (audited exhaustively below; 15 gaps found and fixed). New tests: `test_AS_495_*_renders_skeleton_matching_content_shape` (19 cases, one per route) in `tests/unit/route-loading-skeletons.test.tsx`, all passing.
AS-496: PASS — every `loading.tsx` is a zero-prop, zero-state pure component (no data fetch, no client boundary) whose only job is rendering fixed-dimension `<Skeleton>` blocks sized/counted to match the real page's structure, so the only thing that changes at swap time is which subtree Next mounts, not layout math. New test: `test_AS_496_loading_files_are_prop_less_pure_components_swappable_with_real_content`, passing.

## Enumeration of every fetching route checked (disposition)

- **Workspace home / dashboard** (`app/.../page.tsx` + existing `loading.tsx`) — already compliant (F073): header + 2-chart grid skeleton matches `DashboardContent`'s layout.
- **Projects list** (`projects/page.tsx` + existing `projects/loading.tsx`) — already compliant (F027): header + 3-card grid.
- **Settings / Members** (`settings/members/page.tsx` + existing `loading.tsx`) — already compliant (F017): header + two grouped-row sections.
- **Settings / Profile** (`settings/profile/page.tsx` + existing `loading.tsx`) — already compliant: header + avatar row + form fields.
- **Archive** (`archive/page.tsx`) — **GAP FOUND AND FIXED**. No `loading.tsx`; fell back to the workspace-home `loading.tsx` (2-chart layout), which does not resemble Archive's header + project-card grid. Added `archive/loading.tsx` (header + 3-card grid, matching the real `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` cards).
- **Calendar** (`calendar/page.tsx`) — **GAP FOUND AND FIXED**. Same fallback problem — the 2-chart dashboard skeleton bore no resemblance to a 7-column month grid. Added `calendar/loading.tsx` (filter-bar skeleton + 35-cell 7-column grid, matching `buildCalendarMonth`'s typical 5-week month).
- **My Tasks** (`my-tasks/page.tsx`) — **GAP FOUND AND FIXED**. No route-level `loading.tsx`; added one matching the grouped (overdue/today/this week/later) row-list shape.
- **Notifications** (`notifications/page.tsx`) — **GAP FOUND AND FIXED**. Added `notifications/loading.tsx` matching the page's `mx-auto max-w-2xl` centered-column + row-list shape (the previous fallback skeleton was full-width and wrongly proportioned for this narrow column).
- **Project Board** (`projects/[projectId]/board/page.tsx`) — **GAP FOUND AND FIXED**. No `loading.tsx` at any level in this subtree (parent `projects/loading.tsx` matches the projects *list*, not a single project's board — 3 cards vs. 4 Kanban columns). Added `board/loading.tsx`: toolbar + 4-column grid (To Do / In Progress / In Review / Done, per the fixed 4-column contract this page's own comment documents), each column with 2 card-shaped skeletons.
- **Project List view** (`projects/[projectId]/list/page.tsx`) — **GAP FOUND AND FIXED**. Same missing-`loading.tsx` issue; added `list/loading.tsx`: toolbar + table-header + 5 row skeletons, matching `TaskListTable`'s shape.
- **Project settings** (`projects/[projectId]/settings/page.tsx`) — **GAP FOUND AND FIXED**. Added `settings/loading.tsx` matching header + visibility-toggle row + members-list rows.
- **Project settings / Board columns** (`projects/[projectId]/settings/columns/page.tsx`) — **GAP FOUND AND FIXED**. Added `columns/loading.tsx` matching header + 4 column-row skeletons (this project always seeds the same 4 fixed statuses).
- **Search** (`search/page.tsx`) — **GAP FOUND AND FIXED**. Added `search/loading.tsx`: header + search-box + 3 result-row skeletons.
- **Settings / Audit log** (`settings/audit/page.tsx`) — **GAP FOUND AND FIXED**. Added `settings/audit/loading.tsx`: header + filter-bar + table skeleton (header row + 5 body rows).
- **Settings (workspace general)** (`settings/page.tsx`) — **GAP FOUND AND FIXED**. Added `settings/loading.tsx` matching header + General form fields + danger-zone button.
- **Templates** (`templates/page.tsx`) — **GAP FOUND AND FIXED**. Added `templates/loading.tsx`: header + 3 template-row skeletons.
- **Time report** (`time/page.tsx`) — **GAP FOUND AND FIXED**. Added `time/loading.tsx`: header + date-range controls + table skeleton (header row + 3 body rows).
- **Timeline** (`timeline/page.tsx`) — **GAP FOUND AND FIXED**. Added `timeline/loading.tsx`: controls bar + 5 stacked variable-width task-bar skeletons, echoing the Gantt-style bar layout (`lib/timeline/layout.ts`).
- **Trash** (`trash/page.tsx`) — **GAP FOUND AND FIXED**. Added `trash/loading.tsx`: header + type-filter control + 4 row skeletons.
- **`t/[taskKey]/page.tsx`** — checked, **N/A, not a gap**: this route's entire body is a resolve-then-redirect/notFound (per its own header comment: "this page's entire job is resolve-and-redirect/notFound") — it renders no persistent content of its own for a skeleton to match; any user-visible loading is the destination board page's own `board/loading.tsx` (now fixed above) taking over after the redirect. Adding a skeleton here would be a skeleton for content that never renders on this route, which is exactly the "worse than none" failure mode the spec's own note warns against. Left as-is, documented rather than silently skipped.

Existing route-level Suspense/skeleton components that were already covered by shared, in-page skeletons (not `loading.tsx` routes, out of this route-level audit's scope per the spec's Files list `app/.../loading.tsx (new), components/ui/skeleton.tsx`) were not touched: none were found — every fetching page in this app is plain top-level `await` in a Server Component (no nested `<Suspense>` boundaries inside any page body), confirmed by grepping `grep -rn "Suspense" app/`.

## Files changed
app/(workspace)/w/[workspaceSlug]/archive/loading.tsx (new)
app/(workspace)/w/[workspaceSlug]/calendar/loading.tsx (new)
app/(workspace)/w/[workspaceSlug]/my-tasks/loading.tsx (new)
app/(workspace)/w/[workspaceSlug]/notifications/loading.tsx (new)
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/board/loading.tsx (new)
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/loading.tsx (new)
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/loading.tsx (new)
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/columns/loading.tsx (new)
app/(workspace)/w/[workspaceSlug]/search/loading.tsx (new)
app/(workspace)/w/[workspaceSlug]/settings/audit/loading.tsx (new)
app/(workspace)/w/[workspaceSlug]/settings/loading.tsx (new)
app/(workspace)/w/[workspaceSlug]/templates/loading.tsx (new)
app/(workspace)/w/[workspaceSlug]/time/loading.tsx (new)
app/(workspace)/w/[workspaceSlug]/timeline/loading.tsx (new)
app/(workspace)/w/[workspaceSlug]/trash/loading.tsx (new)
tests/unit/route-loading-skeletons.test.tsx (new)

`components/ui/skeleton.tsx` already existed (introduced by an earlier feature) and needed no changes — reused as-is by every new file above, per the spec's "Files (approximate)" list.

## Commands run
`npx vitest run tests/unit/route-loading-skeletons.test.tsx` (0 — 1 file / 20 tests passed)
`npx tsc --noEmit` (0, no output)
`npx eslint .` (0 errors, 6 warnings — same 6 pre-existing warnings as F252's documented baseline: lib/queries/search.ts:280, tests/unit/invite-member-pagination.test.ts:186, tests/unit/palette-actions-recents.test.tsx:55×2,74×2 — none added by this feature)
`npx vitest run tests/unit` (147 files / 1134 tests passed — up from F252's baseline 144 files/1102 tests by exactly the 1 new file / 20 new tests this feature added, plus other work landed between F252 and now; 1 pre-existing unrelated unhandled-rejection error from `tests/unit/user-avatar.test.tsx` — `cookies() outside request scope` inside comment-list's mention-candidate effect, the exact same flake documented in F252's handoff — unrelated to this feature, does not fail the run, test count/pass count above already reflect it not failing)
`npx next build` (0 — "Compiled successfully", all 29 routes generated including all 19 audited routes, no new warnings)

No Playwright run: this is a pure server-rendered structural/layout feature (no live client interaction to exercise), and the definition-of-done's Primary test guidance calls for "the test type that fits" — unit tests directly assert the rendered skeleton markup shape, which is what AS-495/AS-496 are actually about. Manual browser-preview screenshots were not captured because loading states are only observable under artificial network throttling in a live browser session, which this worker has no way to script deterministically; documented under Autonomous decisions below.

## Decisions made
- Followed the spec's own explicit tie-breaker verbatim: "A skeleton that does not match the final layout is worse than none — measure, do not guess." Every new skeleton's element count/proportions was derived from actually reading each page's rendered JSX (grid column counts, table row shapes, card counts) rather than guessing a generic shape — recorded per-route above.
- Did not touch the 4 already-compliant `loading.tsx` files (workspace home, projects list, members, profile) — they already matched their pages' real layouts; per the clarified "already compliant is a valid documented outcome" pattern (same rule F252 used), retrofitting working files with no assertion-visible gap is out of scope.
- `t/[taskKey]/page.tsx` deliberately left without a `loading.tsx`: it renders no content of its own (pure redirect/notFound resolver), so a skeleton there would violate the spec's own "worse than none" rule by showing a layout-matching-nothing placeholder for a route with no real layout to match.
- Did not introduce any new dependency or a second skeleton primitive — every new file imports the existing `components/ui/skeleton.tsx` `<Skeleton>`, exactly as the 4 pre-existing compliant `loading.tsx` files already do, keeping one shared skeleton building block (no second source of truth), per the clarified ambiguity-resolution rule.
- Test strategy: rather than one integration test per route asserting an exact pixel match (fragile, and Next's `loading.tsx`/Suspense timing isn't observable from a plain `vitest` unit environment without a running server), used `renderToStaticMarkup` per route file and asserted a minimum skeleton-node count keyed to each route's actual real-content element count (verified from the source reads above) — this fails immediately if a `loading.tsx` regresses to a single generic block, which is the concrete, falsifiable form of "layout-matching" that's actually testable outside a browser.

## Out-of-scope work needed
None identified. Every route under `app/(workspace)/w/[workspaceSlug]/**/` that fetches data now has a route-level `loading.tsx`; the one route without one (`t/[taskKey]`) has no content of its own to skeleton, documented above rather than silently skipped.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Skipped manual browser-preview screenshots (throttled network) for this feature. The definition-of-done's "Manual verification" answer calls for screenshots "for UI features" at desktop/375px, but the actual thing to verify — a `loading.tsx` swap under network delay — cannot be captured deterministically without a way to artificially delay the Server Component's data fetch, which this worker has no hook for in this codebase. Substituted with the structural `renderToStaticMarkup` test suite (`tests/unit/route-loading-skeletons.test.tsx`), which is the falsifiable, automatable proxy for "the skeleton's shape matches the real content's shape" that AS-495/AS-496 actually assert, and is the simpler option per the clarified ambiguity-resolution rule (no new dependency, e.g. no fake-timers-over-fetch harness).
AUTONOMOUS_DECISION: Left `t/[taskKey]/page.tsx` without a `loading.tsx`, reasoning that it has no rendered content of its own (pure redirect/notFound) — adding one would produce exactly the "skeleton worse than none" failure mode the spec explicitly warns against.

## Notes for the next worker
- `components/ui/skeleton.tsx` (the shadcn `<Skeleton>` primitive) already existed before this feature and is now used by every `loading.tsx` in the app — no second skeleton implementation exists anywhere in the codebase (verified via `grep -rn "animate-pulse" app/ components/` — the only hits are inside `Skeleton` itself and files importing it).
- If a future feature changes a page's real layout shape (e.g. board's fixed 4-column contract, or the calendar's week-count), its sibling `loading.tsx` in this same directory should be updated to match — that's a page-owning-team responsibility going forward, not something a central audit can enforce automatically without a screenshot-diffing harness (out of scope here, no such harness exists in this repo).
- No MCP tools used — this feature is pure UI/route-scaffolding with no live schema/policy surface, consistent with the spec's "MCP at run: none."
