# Handoff: F087 — Accessibility and performance audit fixes

## Status
COMPLETE

## Assertions covered
No assertion IDs were assigned to this task (it is a direct audit-fix
task, not a validation-contract feature). Each of the 7 audit items was
verified against the real code before changing anything, and each fix is
covered by a new, behaviour-derived test (see below). All 7 claims in the
audit were confirmed real; none were false positives.

## Files changed
- components/portal/phase-timeline.tsx
- components/portal/hours-burndown-chart.tsx
- components/timeline/timeline-bar-draggable.tsx
- components/portal/task-list.tsx
- components/dashboard/priority-bar-chart.tsx (rewritten, Recharts removed)
- lib/queries/search.ts
- lib/queries/people.ts
- lib/supabase/database.types.ts (manual additions: `search_tasks_multi`, `get_users_by_ids`)
- package.json / package-lock.json (`recharts` dependency removed via `npm uninstall`)
- supabase/migrations/20261027010000_f087_search_tasks_multi_project.sql (new)
- supabase/migrations/20261027020000_f087_batch_get_users_by_ids.sql (new)
- tests/unit/dashboard-chart-colors.test.ts (updated for the new SVG-free priority chart shape)
- tests/unit/f087-a11y-perf-audit.test.tsx (new)
- tests/unit/f087-portal-task-list-overdue-icon.test.tsx (new)
- tests/unit/f087-priority-bar-chart-svg-rewrite.test.tsx (new)
- tests/unit/f087-search-tasks-multi-project.test.ts (new)
- tests/unit/f087-resolve-people-batched-auth-lookup.test.ts (new)

## Commands run
`npm uninstall recharts` (0)
`npm run db:apply -- supabase/migrations/20261027010000_f087_search_tasks_multi_project.sql` (0)
`npm run db:apply -- supabase/migrations/20261027020000_f087_batch_get_users_by_ids.sql` (0)
`npm run migrations:check` (0, twice — "No migration drift" both times)
`npx tsc --noEmit` (0)
`npm run build` (0)
`npx vitest run tests/unit/f087-a11y-perf-audit.test.tsx tests/unit/f087-portal-task-list-overdue-icon.test.tsx tests/unit/f087-priority-bar-chart-svg-rewrite.test.tsx tests/unit/f087-search-tasks-multi-project.test.ts tests/unit/f087-resolve-people-batched-auth-lookup.test.ts tests/unit/dashboard-chart-colors.test.ts tests/unit/f338-priority-a11y-contrast.test.tsx tests/unit/fts-tasks.test.ts tests/unit/f019-hours-burndown-chart.test.tsx tests/unit/people-name-resolution.test.ts` (0, 52/52 passed)
`npx vitest run tests/integration/search-tasks.test.ts tests/integration/search-archived-project-exclusion.test.ts tests/integration/trash-exclusion-search.test.ts tests/integration/restore-project.test.ts tests/integration/search-task-key.test.ts tests/integration/f223-status-integration-list-search-dashboard.test.ts tests/integration/task-key-display-queries.test.ts tests/integration/update-profile.test.ts` (0, 38/38 passed against the real linked Supabase project — proves the new `search_tasks_multi` and `get_users_by_ids` RPCs work end-to-end, not just in mocks)

## Decisions made

**Item 1 (role="img" hiding focusable chart children):** Confirmed real —
re-read the current `phase-timeline.tsx` and `hours-burndown-chart.tsx`;
both wrap an outer `<div role="img" aria-label={summary}>` around an
inner `<svg role="presentation">` containing `<g role="button" tabIndex=
{0}>` rows/columns. The inner `role="presentation"` on the `<svg>` was
already correct (a decorative wrapper around real controls); the bug was
one level up, on the outer `<div>`. Fixed by changing the outer `role`
from `"img"` to `"group"` (keeping the same summary `aria-label`) rather
than moving the label onto the `<svg>` or building a hidden table
alternative — `role="group"` gives the chart an accessible group name
without collapsing its subtree, and it's the minimal change that doesn't
touch the already-correct tooltip/summary text logic. Applied identically
to both charts since they share the exact same wrapper shape.

**Item 2 (unwired resize-handle keyboard activation):** Confirmed real
via reading `@dnd-kit/core`'s own source
(`KeyboardSensor.activators[0].eventName === 'onKeyDown'`) — the resize
handles only ever attached `onPointerDown` from `resizeStart/EndListeners`,
never `onKeyDown`, so `KeyboardSensor` (registered in `timeline-body.tsx`)
had nothing to fire on for those two handles specifically (the whole-bar
move region spreads the full `moveListeners` object, so it already
worked). Fixed by wiring `onKeyDown` the same
stopPropagation-then-delegate way `onPointerDown` already was, added
`aria-label="Resize <task> start/end date"` to each handle (they had no
accessible name at all before), and rewrote the file's header comment
(which asserted the resize handles got keyboard support "with no extra
code here", which was false — only the move region did).

**Item 3 (color-only overdue in portal task list):** Confirmed real by
reading `task-list.tsx:336-344`. Copied `task-card.tsx`'s exact treatment
(`TriangleAlert` icon + `<span className="sr-only">Overdue:</span>` when
overdue, `className="hidden"` on that same span otherwise — kept the span
always in the DOM, matching the precedent, rather than conditionally
rendering it, so a screen reader's live-region diffing (if any) never has
to notice an element appearing/disappearing).

**Items 4 & 5 (mouse-only priority chart / unnecessary Recharts dep):**
Confirmed via `grep -rn 'from "recharts"'` returning exactly one file
(`components/dashboard/priority-bar-chart.tsx`). Rewrote it as
hand-rolled markup mirroring `status-pie-chart.tsx`'s established
pattern: real `<button>` per clickable priority (keyboard focusable,
`aria-pressed`, `title`), the count printed directly on the bar (never
color alone), a plain non-interactive element for the "none" bucket
(preserves the original's "can't filter to a value the task table
doesn't recognize" behavior), and the container uses `role="group"` (not
`role="img"`) for the same reason as items 1/2 — this component's buttons
would otherwise be hidden by `role="img"` too. Removed `recharts` from
`package.json` via `npm uninstall` (813 transitive packages removed).
Updated `tests/unit/dashboard-chart-colors.test.ts`'s priority-chart
assertion from reading a Recharts `<Cell>`'s `fill` prop to reading the
new markup's `data-color` attribute (same attribute `StatusPieChart`'s
half of that same test already used) — this does not weaken the test,
it still asserts the same "cell color comes from the shared
PRIORITY_COLORS constant" claim, just against the new element shape.

**Item 6 (N search RPC calls per keystroke):** Confirmed via reading
`lib/queries/search.ts:249-252` (now moved/rewritten). Added
`search_tasks_multi(p_project_ids uuid[], p_query text)` in a new
migration, matching `search_tasks`'s exact `language sql stable security
invoker` posture (no `SECURITY DEFINER`, so RLS still applies under the
caller's own role — same F070-hardening rationale the existing function's
comment gives) and predicate (`= any(...)` instead of `= project_id`).
Left the single-project `search_tasks` function untouched and still
callable, since `tests/unit/fts-tasks.test.ts` and three integration
tests (`search-archived-project-exclusion`, `trash-exclusion-search`,
`restore-project`) call it directly by name. `searchWorkspaceTasks` now
issues exactly one `search_tasks_multi` RPC for the whole workspace's
project list instead of one `search_tasks` RPC per project.

**Item 7 (N admin `getUserById` calls in `resolvePeople`):** Confirmed
via reading `lib/queries/people.ts` and the `@supabase/auth-js`
`GoTrueAdminApi` type definitions — there is no bulk "get users by ids"
endpoint (`listUsers()` only paginates, no id filter), and PostgREST does
not expose the `auth` schema by default, so a true single-call batched
lookup needs a `SECURITY DEFINER` SQL function reading `auth.users`
directly. Added `get_users_by_ids(p_ids uuid[])` in a new migration,
following the exact "security definer + grant to service_role only"
pattern already used by `purge_task`/`purge_comment`/
`cascade_delete_task` (confirmed by grep against those three
migrations) — `resolvePeople` only ever calls it through
`createAdminClient()`, never a session client, so `authenticated`/`anon`
get no grant. `resolvePeople` now computes the subset of ids missing a
`display_name` up front, issues ONE `get_users_by_ids` RPC for that
subset (skipped entirely if the subset is empty), keys the result into a
`Map` before the final per-id loop, and that loop no longer awaits
anything — matches the audit's literal ask ("single batched lookup keyed
into a map before the loop").

## Out-of-scope work needed

- `components/dashboard/status-pie-chart.tsx` has the SAME `role="img"`
  wrapping real, focusable `<button>` segments bug as items 1/2/4 did —
  the audit explicitly told this task to mirror that file as the "correct"
  precedent for item 4, but on inspection its outer `<div role="img"
  aria-label={...}>` (line ~48) wraps real `<button>` elements the same
  way phase-timeline/hours-burndown-chart did before this fix. I did NOT
  fix it — it wasn't one of the 7 named audit items and the audit
  explicitly says "diagnose before you cut," not "expand scope." My new
  `PriorityBarChart` deliberately does NOT copy this bug (uses
  `role="group"` instead). A follow-up should change
  `status-pie-chart.tsx`'s wrapper from `role="img"` to `role="group"`,
  identical to this task's fix for the other three charts.
- The build's terminal output in this Next.js version does not print a
  per-route bundle-size table (no "First Load JS" column appeared in
  `npm run build`'s output), so I cannot report a before/after KB delta
  for item 5 as requested. What I can report: `npm uninstall recharts`
  removed 813 packages from `node_modules` (recharts pulls in d3-*,
  react-smooth, victory-vendor, etc. as transitive deps) — that dependency
  no longer ships in the client bundle for the dashboard route at all,
  which the removed `grep -rn 'from "recharts"'` hit (now zero matches)
  confirms.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: For item 1/4's `role="img"` fix, chose `role="group"`
over the audit's other suggested option ("a visually-hidden table
alternative") because it's the smaller, more surgical change that
preserves the existing single-tooltip/summary-label design the feature's
own header comments describe in detail, and because `role="group"` +
`aria-label` is the standard ARIA pattern for "a labelled region whose
children should remain individually reachable."

AUTONOMOUS_DECISION: For item 6/7's migrations, used the next two
sequential timestamps after the newest existing migration
(`20261026010000...`) rather than today's real calendar date, matching
this repo's own migration-timestamp convention (every existing filename
uses the mission's fictional in-repo date progression, not the wall-clock
date the work was actually done on).

## Notes for the next worker

- No MCP tools were used for this task (no `mcp-registry.md` reference in
  the prompt; migrations were applied via this repo's own `npm run
  db:apply` / `npm run migrations:check` scripts against the real linked
  Supabase project, per the task's own instructions).
- `search_tasks_multi` and `get_users_by_ids` were added to
  `lib/supabase/database.types.ts` BY HAND (no `supabase gen types` script
  exists in `package.json`) — if a real type-generation step is ever
  wired up, double check these two entries match whatever it produces
  (I copied `search_tasks`'s existing `Returns` shape verbatim for
  `search_tasks_multi`, and `get_users_by_ids`'s shape was written by hand
  against the function's own `returns table (...)` clause).
- `tests/integration/f020b-projects-allowlist-guard.test.ts` shows as
  modified in `git status` but I did not touch it — pre-existing dirty
  state in the working tree before this task started, left untouched.
