# Handoff: F081 — fix unfiltered `tasks`-table Realtime subscriptions

## Status
COMPLETE

## Assertions covered
No assertion IDs were assigned to this task (it is an ad hoc production-cost
fix, not a numbered feature from `plan.md`/`validation-contract.md`). Existing
assertions this touches without changing behaviour: AS-021, AS-022 (portal
task list), AS-018, AS-019, AS-020, AS-024 (portal overview), AS-023, AS-024
(palette search) — all still PASS, verified by the existing suites for each
surface (see Commands run).

## Files changed
components/portal/task-list.tsx
components/portal/task-list.test.tsx
lib/portal/subscribe-portal-overview-realtime.ts
components/portal/use-portal-overview-realtime.ts
components/portal/portal-overview-live.tsx
tests/unit/portal-overview-realtime-subscription.test.ts
lib/palette/subscribe-palette-search-realtime.ts (comment only, no behaviour change — see Decisions made)

## Commands run
`npx vitest run tests/unit/portal-overview-realtime-subscription.test.ts components/portal/task-list.test.tsx tests/unit/palette-search-realtime.test.ts tests/unit/portal-overview-live.test.tsx` (0, 43 tests passed)
`npx tsc --noEmit` (0)
`npm run build` (0)
`npx eslint components/portal/task-list.tsx lib/portal/subscribe-portal-overview-realtime.ts components/portal/use-portal-overview-realtime.ts components/portal/portal-overview-live.tsx lib/palette/subscribe-palette-search-realtime.ts components/portal/task-list.test.tsx tests/unit/portal-overview-realtime-subscription.test.ts` (0)

## Decisions made

- **`components/portal/task-list.tsx`**: added `filter: \`project_id=eq.${projectId}\`` to the `postgres_changes` binding, matching `lib/board/subscribe-board-realtime.ts:54-60` exactly. `projectId` was already threaded through as a function parameter (used only for the topic string and the client-side `reconcilePortalRealtimeTask` predicate before this fix) — no new parameter needed, no behaviour change other than the server now doing the scoping instead of the client discarding events after RLS re-check. Verified the confirmed real fix by reading `lib/board/subscribe-board-realtime.ts` directly, not from memory.

- **`lib/portal/subscribe-portal-overview-realtime.ts`**: this one is used in TWO shapes (`components/portal/portal-overview-live.tsx`) — the multi-project workspace-chooser page (`projectId` unknown, genuinely needs every project in the workspace) and the per-project portal shell (`projectId` known, the common case). Added an optional 4th `projectId` parameter: when present, applies `filter: project_id=eq.<projectId>` AND scopes the channel topic to `portal-overview:<workspaceId>:<projectId>` (not just `portal-overview:<workspaceId>`) so a project-scoped subscriber can never end up sharing — and silently inheriting the filter of — an already-open, differently-scoped channel for the same workspace via `acquireSharedTopicChannel`'s topic-based dedup. When omitted, behaviour is byte-identical to before (same topic string, same unfiltered binding) for the workspace-chooser page, which genuinely cannot be filtered: `tasks` has no `workspace_id` column (confirmed via `supabase/migrations/20260818013805_rls_tasks.sql`'s own comment on this exact gap, and grepped every later `alter table tasks` migration — none add one), only `project_id`, joined through `projects`.
  Threaded the new parameter through `components/portal/use-portal-overview-realtime.ts` (hook, added optional `projectId` arg, included in the effect's dependency array) and `components/portal/portal-overview-live.tsx` (passes its own existing `projectId` prop — which the component already receives and uses for the client-side `waitingOnYouPredicate`, see that file's own header comment — straight through).

- **`lib/palette/subscribe-palette-search-realtime.ts`**: left the subscription itself unfiltered, on purpose — not by omission. Diagnosed it fully before deciding: (1) `tasks` has no `workspace_id` column (same fact as above), so no equality filter can express "this workspace" server-side; (2) the palette's job is cross-project title/key search (`lib/actions/palette-search.ts`), so filtering on `assignee_id=eq.<userId>` (the other option raised) would silently drop live updates for the majority of a caller's own results — `PaletteRealtimeTaskRow`/`reconcile-palette-search-results.ts` never look at assignee at all, confirmed by reading both files. That would be a regression, not a fix. (3) Traced the actual runtime cost claim in the task ("mounted for the lifetime of the shell... every logged-in user... entire session") against the real code and found it overstated: `lib/hooks/use-palette-search-realtime.ts`'s effect already guards `if (!workspaceId || query.length === 0) return;`, and EVERY path that closes the command palette (`components/command/command-palette.tsx`'s `resetPaletteState`, called from Radix's `onOpenChange`, the Cmd+K toggle handler, and `navigate()`) resets `query` back to `""`, tearing the subscription down. So the channel is already only open while a caller has the palette open AND is actively typing a non-empty query — the "at minimum, only subscribe while the palette is actually open" mitigation the task raised as a minimum bar was already implemented (F012), just not documented as deliberate. It is also one ref-counted channel per workspace (`acquireSharedTopicChannel`), so N concurrent searchers in the same workspace share one Realtime subscription, not N. Given the genuine "no filterable column" constraint and that the time-scoping mitigation already exists, changing NOTHING behavioural here and instead making the reasoning explicit (in-file comment, so a future reader doesn't "fix" this into a regression by adding a filter that drops real matches) was the correct call — matches this task's own instruction: "if one legitimately cannot be filtered, say why." No test changes needed since no behaviour changed; existing `tests/unit/palette-search-realtime.test.ts` still asserts the (still correct) unfiltered `.on()` call.

- **Sweep** (grepped every `postgres_changes` call site in the repo):
  - `lib/board/subscribe-board-realtime.ts` — filtered (`project_id=eq.<id>`), unchanged, this is the reference pattern.
  - `lib/board/subscribe-board-columns-realtime.ts` — filtered (`project_id=eq.<id>`).
  - `lib/chat/subscribe-message-reactions-realtime.ts`, `lib/chat/subscribe-messages-realtime.ts` — filtered (`channel_id=eq.<id>`).
  - `lib/notifications/subscribe-notifications-realtime.ts` — filtered (`user_id=eq.<id>`).
  - `lib/tasks/subscribe-comments-realtime.ts` — filtered (`task_id=eq.<id>`).
  - `components/portal/task-list.tsx` — was unfiltered, **fixed** above.
  - `lib/portal/subscribe-portal-overview-realtime.ts` — was unfiltered, **fixed** above (conditionally, per shape).
  - `lib/palette/subscribe-palette-search-realtime.ts` — genuinely unfiltered, documented why (no filterable column + would drop real matches); left as-is, comment added.
  - `lib/chat/subscribe-unread-realtime.ts` — genuinely unfiltered (`messages`, workspace-wide sidebar unread count, no per-channel scope to give it since it needs every channel the caller is in at once). Already carries a full header comment explaining this is deliberate and that RLS's `messages_select_channel_members` policy is what actually scopes it (pre-existing, F5, not part of this task's "silently unfiltered" defect shape — not touched).
  - `lib/tasks/subscribe-calendar-realtime.ts` — genuinely unfiltered (`tasks`, workspace-wide calendar). Already carries a full header comment (F009) explicitly documenting this as an AUTONOMOUS_DECISION because `tasks` has no `workspace_id` column, with RLS covering INSERT/UPDATE and a client-side backstop (`lib/calendar/reconcile-realtime-task.ts`) covering DELETE. Pre-existing, not touched.
  - `components/my-tasks/use-my-tasks-realtime.ts` — genuinely unfiltered on both `task_assignees` and `tasks` (workspace-wide My Tasks). Header comment (F025) explains this is a root-cause fix: filtering `tasks` on `assignee_id=eq.<userId>` is structurally incapable of representing un-assignment (Realtime evaluates an UPDATE's row filter against the NEW record only, so a change that makes the filter newly false is dropped server-side, never delivered). Pre-existing, not touched.

  No other `postgres_changes` binding in the repo lacked a filter without an existing, reasoned justification already documented in-file. `components/task/comment-list.tsx`, `components/task/task-list-table.tsx`, `components/board/board.tsx`, `lib/actions/comments.ts`, `lib/hooks/use-inline-field-edit.ts`, `components/notifications/use-notifications-realtime.ts`, `components/task/use-list-realtime.ts` were all grepped and only reference the concept in comments or consume an already-filtered subscribe function above — none open a second, separate unfiltered binding.

## Out-of-scope work needed
None identified beyond what's already documented as deliberate/pre-existing above.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: for the portal overview subscription, chose to make the `projectId` filter conditional (optional 4th param, filtered channel+topic when present, unfiltered channel+topic when absent) rather than always requiring a `projectId`, because the multi-project workspace-chooser page (`app/(portal)/portal/[workspaceSlug]/page.tsx`) is a real, currently-shipped caller with no single project to scope to, and forcing a filter there would either break that page or require a much larger refactor (e.g. an `in.(...)`-list filter over every project id in the workspace, which risks Realtime's row-filter value-count limits and needing to keep that list in sync with project creation/deletion) that is out of scope for a targeted cost fix. The task's own instruction ("if one legitimately cannot be filtered, say why") applies here for that one caller.

AUTONOMOUS_DECISION: left `lib/palette/subscribe-palette-search-realtime.ts`'s `postgres_changes` binding unfiltered, choosing "document why + confirm the existing time-scoping mitigation" over forcing a filter, because every filter option raised (assignee_id, workspace_id) either doesn't exist as a column or would drop real search results, and the actual runtime behaviour (subscribe only while query is non-empty, one shared channel per workspace) already matches the task's own "at minimum" bar once traced through the code.

## Notes for the next worker
- No MCP tools were used — this was pure application-code diagnosis (grep + read) and standard SDK realtime config; nothing needed schema introspection beyond reading migration files already in the repo, which is the more precise source for this repo's exact column set anyway.
- Did not exercise a live dev server (out of scope for time available; the targeted vitest suites above assert the actual `.on()` filter string, which is the load-bearing behaviour Realtime's row-filter feature depends on). If you want end-to-end confirmation: start `npm run dev`, open a portal project page and the app shell's Cmd+K palette in two tabs, edit a task in a DIFFERENT project than the one the portal tab is scoped to, and confirm the portal tab does NOT re-render (previously it would have received and discarded that event).
- The `git status` in this repo currently shows several unrelated dirty files (`lib/actions/approvals.ts`, `components/nav/app-sidebar.tsx`, `lib/queries/approvals.ts`, portal settings pages, etc.) from concurrently-running agents, per the task instructions — none of those were touched or committed here; only the files listed under "Files changed" above were staged.
