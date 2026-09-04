# Handoff: F083 — Six team-side gaps from full-app audit

## Status
COMPLETE

## Assertions covered
This task was assigned directly (not through the standard mission-tasks
flow — no F083 feature spec/clarification file exists in this mission's
`features/`/`clarifications/` directories, and no validation-contract
assertion IDs were pre-assigned to it). No AS-NNN IDs to report against;
instead, per-item test coverage is listed below against the audit's own
six numbered findings.

1. Missing error.tsx/loading.tsx on 12 (+1 new: settings/portal = 13,
   +2 the audit named but I also confirmed: t/[taskKey], docs/**,
   chat/** = 15 route pairs total) — PASS. Verified by extending
   `tests/unit/route-error-boundaries.test.tsx` (37/37 pass, 15 new
   route cases).
2. Client requests sidebar badge — PASS. `tests/unit/f083-app-sidebar-requests-badge.test.tsx` (3/3 pass).
3. Withdraw approval confirmation — PASS. `tests/unit/f083-approvals-queue-withdraw-confirm.test.tsx` (3/3 pass): does-not-fire-until-confirmed, fires-on-confirm, cancel-never-fires.
4. Approvals queue row links — PASS. `tests/unit/f083-approvals-queue-row-links.test.tsx` (4/4 pass).
5. Client-visible/awaiting-client indicators on board card, list row, my-tasks row — PARTIAL (board card itself cannot render live data; see Out-of-scope below). Card/list-row/my-tasks render logic PASS: `tests/unit/f083-task-card-client-visibility-indicators-render.test.ts` (5/5 pass).
6. Chat delete confirmation (window.confirm → AlertDialog) — PASS. `tests/unit/f083-chat-delete-confirm.test.tsx` (3/3 pass).

## Files changed
app/(workspace)/w/[workspaceSlug]/layout.tsx
app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx
components/approvals/approvals-queue.tsx
components/chat/message-list.tsx
components/nav/app-sidebar.tsx
components/task/task-card.tsx
components/task/task-list-table.tsx
lib/queries/client-requests.ts
lib/queries/my-tasks.ts
lib/queries/tasks.ts
tests/unit/route-error-boundaries.test.tsx
tests/unit/f083-app-sidebar-requests-badge.test.tsx
tests/unit/f083-approvals-queue-withdraw-confirm.test.tsx
tests/unit/f083-approvals-queue-row-links.test.tsx
tests/unit/f083-chat-delete-confirm.test.tsx
tests/unit/f083-task-card-client-visibility-indicators-render.test.ts
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/{budget,measurement,record,site,portal}/{error,loading}.tsx (10 new files)
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/hours/{error,loading}.tsx
app/(workspace)/w/[workspaceSlug]/requests/{error,loading}.tsx
app/(workspace)/w/[workspaceSlug]/preview-as-client/{error,loading}.tsx
app/(workspace)/w/[workspaceSlug]/settings/{task-types,status-templates}/{error,loading}.tsx
app/(workspace)/w/[workspaceSlug]/t/[taskKey]/{error,loading}.tsx
app/(workspace)/w/[workspaceSlug]/docs/{error,loading}.tsx
app/(workspace)/w/[workspaceSlug]/docs/[docId]/{error,loading}.tsx
app/(workspace)/w/[workspaceSlug]/chat/{error,loading}.tsx
app/(workspace)/w/[workspaceSlug]/chat/[channelId]/{error,loading}.tsx

## Commands run
`npx tsc --noEmit` (0)
`npm run build` (0)
`npx vitest run tests/unit/route-error-boundaries.test.tsx tests/unit/f083-app-sidebar-requests-badge.test.tsx tests/unit/f083-approvals-queue-withdraw-confirm.test.tsx tests/unit/f083-approvals-queue-row-links.test.tsx tests/unit/f083-chat-delete-confirm.test.tsx tests/unit/f083-task-card-client-visibility-indicators-render.test.ts tests/unit/app-sidebar-archive-nav.test.tsx tests/unit/app-sidebar-trash-nav.test.tsx tests/unit/app-sidebar-settings-nav.test.tsx tests/unit/app-sidebar-project-nav-list.test.tsx tests/unit/app-sidebar-calendar-timeline-nav.test.tsx tests/unit/task-card-blocked-indicator-render.test.ts tests/unit/task-card-recurrence-indicator-render.test.ts tests/unit/task-card-completion-render.test.ts tests/unit/task-card-over-estimate-indicator-render.test.ts tests/unit/task-card-badge-text-contrast.test.ts tests/unit/my-tasks-bucket.test.ts tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx tests/unit/f019-my-tasks-realtime-hook-set-identity.test.tsx tests/unit/bulk-delete-action.test.tsx` (0, 20 files / 116 tests passed)
`npx vitest run tests/integration/f230-my-tasks-query.test.ts tests/integration/f231-my-tasks-scope-actions.test.ts` (0, 15 passed — confirms getMyTasks/query-layer changes didn't regress)
Full suite NOT run per explicit instruction (manufactures ~130 auth rate-limit failures locally).

## Decisions made
- Verified all six claims against real code before touching anything (per instruction): all six were real. No claim was a non-problem.
- Item 1: `error.tsx` bodies are thin wrappers around the existing shared `RouteError` component, `loading.tsx` bodies use shadcn `Skeleton` matching each page's real content shape — same convention as every existing route pair (`components/route-error.tsx`, `approvals/{error,loading}.tsx`, `trash/loading.tsx`, `timeline/loading.tsx` were all read first to confirm the pattern before copying it). Included the new `settings/portal` route as instructed, plus confirmed `t/[taskKey]`, `docs/**`, `chat/**` were indeed missing both files.
- Item 2: counted `client_requests.status IN ('submitted', 'in_review')` as "still waiting on the team" — the audit prose says "new/triaging" but the actual DB enum (confirmed via `lib/queries/client-requests.ts`'s existing `TeamClientRequest["status"]` type) is `submitted | in_review | accepted | declined`, so I used the real values rather than inventing a `new`/`triaging` status that doesn't exist. New `getOpenClientRequestCountForWorkspace` added to `lib/queries/client-requests.ts` (not the off-limits `lib/queries/approvals.ts`), threaded through the layout exactly the way `openApprovals`/`approvalsCount` already is (same non-fatal, fail-open-to-0 convention).
- Item 3: `AlertDialog` pattern copied from `components/project/phase-list.tsx:341` as instructed — names the approval, states the client's decision "disappears and cannot be reopened — can only be re-raised as a new request," matching `prevent_approval_request_settled_update`'s real behaviour (`lib/actions/approvals.ts:400-405`, read but not modified — it's off-limits).
- Item 4: "What" links use the board's existing `?taskId=` deep-link convention (used identically by My Tasks/Timeline/the `/t/[taskKey]` resolver itself) rather than `/t/[taskKey]`, because `WorkspaceApproval` (in the off-limits `lib/queries/approvals.ts`) only carries `subjectId`/`subjectType`, not a task key — this is the AUTONOMOUS_DECISION documented below. Doc-subject approvals link to the doc editor; phase/artifact subjects (and a deleted subject row) stay plain text since there's no single destination page for those. "Unassigned" links to the project's general settings page (`/settings`), which is where `DecisionOwnersSection` actually lives (confirmed by reading `projects/[projectId]/settings/page.tsx`) — there is no separate decision-owners route.
- Item 5 (board RPC limitation): `getProjectBoardTasks` (`lib/queries/tasks.ts`) sources its rows from the Postgres RPC `get_project_board_tasks`, which does not currently return `client_visible`/`pending_client_approval`. Adding those columns to the RPC's return requires a new migration under `supabase/migrations/**`, which this task was explicitly told NOT to touch (a concurrent agent owns migrations). I therefore wired the two fields through `getProjectListTasks`, `getWorkspaceListTasks` (both plain `.select()` calls, no RPC), and `getMyTasks` — covering the List view, the workspace Dashboard's list, and My Tasks — and added the fields as optional/safe-default on `TaskCardTask` so the Board view (still RPC-backed) simply omits the indicator rather than crashing, exactly the "safe default" convention every other optional field on that type already follows. This is a real, scoped gap — see Out-of-scope below.
- Item 6: same `AlertDialog` import/markup shape as items 3/5, styled/keyboard-consistent with the rest of the app; `deleteMessage` (the actual mutation) is unchanged, only its confirmation gate moved from `window.confirm` into the dialog's `AlertDialogAction onClick`.
- Icon choices for item 5 deliberately reuse the exact icons the existing per-task toggles already use for the same two concepts (`Eye` — `components/task/client-visibility-toggle.tsx`; `CircleDot` — `components/task/pending-approval-toggle.tsx`), each paired with visible text plus `sr-only` text, matching the icon+text-never-colour-alone pattern named in the brief (`task-card.tsx`'s existing overdue indicator).

## Out-of-scope work needed
- **Board view still can't show the client-visible/awaiting-client indicators.** `get_project_board_tasks` (the Postgres RPC backing `getProjectBoardTasks`) needs `client_visible, pending_client_approval` added to its `RETURNS TABLE`/query body via a new migration (follow the existing pattern in e.g. `20260822040000_rpc_project_board_tasks_estimate_minutes.sql`), and `getProjectBoardTasks`'s `BoardTaskRow` type + mapping in `lib/queries/tasks.ts` needs the two new fields wired through (mirrors exactly how `estimate_minutes`/`recurrence`/`tags` were each added in their own follow-up migrations). `TaskCard` itself needs no further change — it already renders both indicators whenever the fields are present. SUGGESTED FOLLOWUP: a small feature ("board card client-visibility indicators") that adds one migration + a ~10-line `lib/queries/tasks.ts` change, gated on whoever currently owns `supabase/migrations/**` being free.
- Did not add a "requests" nav-item unit test file exactly mirroring an existing "Approvals" badge test, because no such file existed to mirror (`grep` for `approvalsCount` in `tests/` returned nothing) — documented in the new test file's own header rather than silently inventing a precedent.

## Blockers
(none — Status is COMPLETE; the one real limitation is documented above as Out-of-scope, not a blocker to this task's own definition of done)

## Autonomous decisions
AUTONOMOUS_DECISION: Item 4's "What" cell links to the board's `?taskId=` deep-link instead of the literal `/w/[slug]/t/[taskKey]` route the brief names, because the approvals queue's query (`lib/queries/approvals.ts`, off-limits for this task) does not carry a task key — only `subjectId`. The `?taskId=` deep-link is the same real destination `/t/[taskKey]` itself resolves to (confirmed by reading that route's own `page.tsx`), so the user-visible outcome (click "Homepage copy" → land on the right task in the board) is identical; only the URL shape differs from the literal instruction.
AUTONOMOUS_DECISION: Item 2's badge counts `client_requests.status IN ('submitted','in_review')` rather than the brief's literal `new`/`triaging` wording, because those aren't real enum values in this codebase (confirmed against `TeamClientRequest["status"]`) — `submitted`/`in_review` are the actual "not yet decided" states, matching the existing inbox's own "untriaged first" sort comment.

## Notes for the next worker
- No MCP usage — this task is pure application-code/UI, no live schema/policy introspection needed (per `worker-mcp-usage` skill's decision tree: "Pure UI feature → No MCP unless spec requires live CMS/data fetch via MCP-backed service").
- Dev server on :3000 was up and returned 200 for `/` and 307 (sign-in redirect) for every new route path when hit unauthenticated via `curl` — confirms no 500/route-crash on any of the 15 new route pairs. I do NOT have a browser/Playwright tool available in this environment, so I could not log in as `sasa@demo.test` and click through interactively — flagging this plainly rather than implying I did. `npm run build` succeeding (including static generation of all listed routes) and the full targeted vitest run passing is the actual evidence for this change.
- `lib/queries/client-requests.ts`, `lib/queries/tasks.ts`, `lib/queries/my-tasks.ts` were NOT in this task's explicit exclusion list (`lib/actions/workspaces.ts`, `lib/queries/approvals.ts`, `supabase/migrations/**`), so editing them was in-bounds.
- Several unrelated files show as modified/untracked in `git status` (`lib/actions/portal-approval.ts`, `lib/actions/portal-deliverables.ts`, `lib/notifications/*`, `tests/unit/portal-approval-action.test.ts`, `lib/notifications/portal-recipients.ts`, various `missions/20260830-*`/`missions/20260902-*` directories) — these are the concurrent agent's in-progress work (migrations/security tests) or pre-existing session state, not mine. I used explicit `git add <path>` for exactly my 45 files and did not touch or commit any of those.
