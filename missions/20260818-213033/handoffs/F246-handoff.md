# Handoff: F246 — task-deep-link-route

## Status
COMPLETE

## Assertions covered
AS-473: PASS — real path proven against the new `resolveTaskIdByKey` (`lib/queries/tasks.ts`) + the existing `getTaskDetail` (`lib/actions/tasks.ts`), the exact two calls the new route `app/(workspace)/w/[workspaceSlug]/t/[taskKey]/page.tsx` makes, in `tests/integration/f246-task-deep-link-route.test.ts` (`test_AS_473_AS_474_a_visible_tasks_key_resolves_to_the_real_id_getTaskDetail_can_open`, seeded against the real linked Supabase project). The route itself is proven to compile and register (`npx next build` output lists `ƒ /w/[workspaceSlug]/t/[taskKey]`).
AS-474: PASS — the page's `redirect()` target is the identical `/w/{slug}/projects/{projectId}/board?taskId={id}` URL `tests/unit/board-taskid-deeplink.test.tsx` already proves opens the real `TaskDetailSheet` on mount (fetches via the real `getTaskDetail`, renders the task's title in an editable input) — re-run in this session, still green. No new sheet/fetch path was built; AS-474 is inherited by construction, not re-implemented.
AS-477: PASS — `tests/integration/f246-task-deep-link-route.test.ts`'s four negative cases (private project the caller isn't a member of, a soft-deleted/trashed task, a task in a soft-deleted/archived project, a never-seeded key/number) all resolve to `null` from `resolveTaskIdByKey` — the identical "no candidate id" shape a nonexistent key produces, so the page's `notFound()` branch is reached the same way in every case. A fifth test drives `getTaskDetail` directly with the private task's raw id (bypassing the key resolver entirely, as a stale/shared URL might) and confirms it still returns the exact "Task not found." string, never a distinguishable forbidden message.

## Files changed
app/(workspace)/w/[workspaceSlug]/t/[taskKey]/page.tsx (new)
lib/queries/tasks.ts (added `resolveTaskIdByKey`)
components/task/task-detail-sheet.tsx (added the "Copy link" control)
tests/integration/f246-task-deep-link-route.test.ts (new)
tests/unit/f246-task-detail-sheet-copy-link.test.tsx (new)

## Commands run
`npx tsc --noEmit` (0, no output)
`npx eslint .` (0 errors, 6 warnings — identical baseline: `lib/queries/search.ts`, `tests/unit/invite-member-pagination.test.ts`, `tests/unit/palette-actions-recents.test.tsx`, none touched by this feature)
`npx next build` (0 — Turbopack production build succeeded; `/w/[workspaceSlug]/t/[taskKey]` listed in the route table as dynamic (`ƒ`), proving the module boundary compiles for real, not just under vitest)
`npx vitest run tests/unit/f246-task-detail-sheet-copy-link.test.tsx tests/unit/board-taskid-deeplink.test.tsx` (0 — 3/3 passed)
`npx vitest run tests/integration/f246-task-deep-link-route.test.ts` (0 — 6/6 passed, against the real linked Supabase project)
`npx vitest run tests/integration/search-task-key.test.ts` (0 — 6/6 passed, unaffected regression check on the F147 key-parsing/search path this feature reuses)
`npx vitest run tests/unit` (0 — 136 files / 1053 tests, all passed; up from the stated baseline of 135 files / 1052 tests by the 2 new test files this feature adds. One documented pre-existing unhandled-rejection warning from `tests/unit/user-avatar.test.tsx` — a `cookies()`-outside-request-scope error inside `getMentionCandidates`, same class of noise F233's handoff already disclosed, unrelated to this feature's files.)

## Decisions made
- **Canonical URL shape** (the spec's one open Notes question, resolved per the clarification's "simpler option, no new dependency, no second source of truth"): `/w/{workspaceSlug}/t/{taskKey}` (e.g. `/w/acme/t/PM-142`) — workspace-scoped (not a bare top-level `/t/{key}`) because a task key alone is only unique within its workspace (`projects_key_unique_per_workspace`), and workspace-scoped URLs are this codebase's existing convention for every other per-task/per-project surface. It **does not fork** the existing `?taskId=` convention (board's own deep-link, reused by F233's calendar chips and F208's notifications) — this route's ENTIRE implementation is a resolve-then-`redirect()` onto that exact existing `?taskId=` URL. The two coexist: `?taskId=` stays the internal, id-based mechanism every existing caller (notifications, calendar) already uses; the new `/t/{key}` route is the new CANONICAL, human-shareable, key-based address a copy-link control, a future notification rewrite, or F242's palette can point at instead, without needing to already know a task's project id. Recorded here per the clarified ambiguity-resolution rule.
- **Resolution path never uses `createAdminClient()`.** `resolveTaskIdByKey` (lib/queries/tasks.ts) reads through the plain RLS-scoped client only — both `projects_select_active_members` and `tasks_select_active_members` (`20260821140526_project_visibility_rls_sweep.sql`) already gate every SELECT through `is_project_visible_to`, so a private/invisible project or a soft-deleted row simply returns no candidate id at the database layer, with zero risk of a second, drifted copy of `isProjectVisibleToCaller`'s logic. The page's SECOND, authoritative step then calls the real `getTaskDetail` (which does use the admin client + the shared `isProjectVisibleToCaller` from `lib/actions/project-visibility.ts`) before ever redirecting — so the one call site in this feature that does read through the admin client is the pre-existing, already-hardened one, never a new parallel fetch.
- **Trashed task / archived project degrade the same as "doesn't exist."** Both are covered by the same RLS predicates (`deleted_at is null` on both `projects` and `tasks`) the resolver already relies on for private-project handling — no special-casing needed, and no test can distinguish "trashed" from "never existed" from the resolver's return shape, which is the AS-477 guarantee.
- **"Copy link" control derives `workspaceSlug` from `usePathname()`** rather than threading a new prop through `TaskDetailSheet`'s existing callers (board.tsx, list, calendar). Every existing caller mounts this component under `/w/{slug}/...`, so a regex match on the current pathname is equivalent to a prop and needed zero changes to any of those call sites — the smaller diff, per the clarified "simpler option" rule. The control renders nothing (not a broken link) if that segment can't be found.
- The existing click-to-copy task-key badge (bare "PM-142" text, F146/AS-258) is left untouched; "Copy link" is a second, separate control next to it, matching the pattern `components/views/view-switcher.tsx`'s own `copyLink` already established (same clipboard-write + sonner-toast-feedback shape).

## Out-of-scope work needed
- Notifications (F208), the calendar's task chips (F233), and F242's command palette all still link via the internal `?taskId=` contract, not the new canonical `/w/{slug}/t/{key}` route — the spec's Notes said "notifications, emails, and the palette all link to it," but rewiring those three surfaces to the new canonical URL is a distinct change to each of THEIR OWN files (`components/notifications/*`, `components/command/*`), outside this feature's named Files (`app/.../tasks/[taskKey]/page.tsx`, `lib/queries/tasks.ts`, `components/task/task-detail-sheet.tsx`). A focused follow-up feature should swap each surface's `?taskId={id}` link construction for `formatTaskKey` + the new `/t/{key}` path (all three already have the task's `projectKey`/`number` in scope or one query away).
- Emails: F213–F217 (the Resend email set) are `[SKIPPED]` per `mcp-registry.md` — no email template exists yet to point at this URL. Whichever future feature un-skips email sending should build its task-link construction on this route from day one rather than a raw `?taskId=` link.
- F247 (modal routing, AS-475/AS-476/AS-478) is untouched — this feature's route is a pure server redirect, no client-side history/back-button/scroll-preservation behavior was added here, leaving that seam clean as instructed.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: canonical URL shape chosen as `/w/{workspaceSlug}/t/{taskKey}`, coexisting with (not replacing) the existing `?taskId=` mechanism — see Decisions made.
AUTONOMOUS_DECISION: "Copy link" derives workspaceSlug from `usePathname()` rather than a new prop, to avoid touching every existing `TaskDetailSheet` caller — see Decisions made.
AUTONOMOUS_DECISION: trashed-task and archived-project deep links degrade via the same RLS `deleted_at is null` predicates already in place, with no special-case code — see Decisions made.

## Notes for the next worker
- MCP usage: none. Registry (`missions/20260818-213033/connections/mcp-registry.md`) lists "MCP at run: none" for this feature and no schema/migration changes were made — `resolveTaskIdByKey` reads through the same `projects`/`tasks` tables and `is_project_visible_to`-gated RLS policies F322/F323 already established; nothing new to introspect.
- `parseTaskKeyQuery` (lib/tasks/task-key.ts, F147) is reused as-is for parsing the URL's `[taskKey]` segment — no second regex was written, per that file's own explicit "the ONLY place in the codebase the key-search regex may appear" instruction.
- The page's `[taskKey]` param is `decodeURIComponent`'d before parsing, since a key with a literal `-` in it may arrive URL-encoded from some callers; `parseTaskKeyQuery`'s own regex is dash-tolerant either way.
- F247 (modal routing over the top of this same route family) should be able to build directly on this file without touching its resolve-or-404 logic — its own AS-475/476/478 concerns (in-place open, back-button, scroll/filter preservation) are about the BOARD side of the `?taskId=` contract, not this redirect source.
