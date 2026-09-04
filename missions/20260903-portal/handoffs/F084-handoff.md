# Handoff: F084 — task-page "Request changes" leaves no trace + no portal event notifies the team

## Status
COMPLETE

## Assertions covered
This task was assigned directly (not through validation-contract.md's AS-NNN
numbering — no F084 entry exists in missions/20260903-portal/plan.md or
validation-contract.md; it is an ad-hoc defect-fix request). Coverage is
tracked by test name instead:

- test_F084_request_changes_writes_an_audit_log_entry_distinct_from_approve — PASS (tests/integration/f084-portal-task-decision-audit.test.ts). Written and run FIRST against the unmigrated schema, where it failed (`expected 0 to be greater than 0`, both RPCs wrote nothing to audit_log). Re-ran after `npm run db:apply` — PASS.
- test_F084_approve_task_notifies_the_resolved_recipients — PASS
- test_F084_approve_task_still_succeeds_when_notifying_fails — PASS
- test_F084_request_changes_notifies_the_resolved_recipients — PASS
- test_F084_request_changes_still_succeeds_when_notifying_fails — PASS
- test_F084_returns_every_decision_owner_plus_the_task_assignee — PASS
- test_F084_dedupes_a_decision_owner_who_is_also_the_assignee — PASS
- test_F084_never_includes_the_excluded_actor_even_as_a_decision_owner_or_assignee — PASS
- test_F084_no_task_id_means_no_assignee_lookup_at_all — PASS
- test_F084_no_owners_and_no_task_returns_an_empty_array — PASS

## Files changed
supabase/migrations/20261026010000_f084_portal_task_decision_audit_and_kinds.sql
lib/notifications/portal-recipients.ts (new)
lib/notifications/fanout.ts
lib/notifications/create-notification.ts
lib/actions/portal-approval.ts
lib/actions/client-requests.ts
lib/actions/portal-deliverables.ts
tests/unit/portal-approval-action.test.ts
tests/unit/portal-recipients.test.ts (new)
tests/integration/f084-portal-task-decision-audit.test.ts (new)

## Commands run
`npx vitest run tests/integration/f084-portal-task-decision-audit.test.ts` — pre-fix: 1 failed (proves the defect); post-`db:apply`: 0 (pass)
`npm run db:apply -- supabase/migrations/20261026010000_f084_portal_task_decision_audit_and_kinds.sql` (0)
`npm run migrations:check` (0) — "No migration drift — all migrations present on remote."
`npm run db:gen-types` (0) — no diff in lib/supabase/database.types.ts (the constraint change isn't reflected in generated types; no columns/tables changed)
`npx vitest run tests/unit/portal-approval-action.test.ts tests/unit/portal-recipients.test.ts tests/integration/f084-portal-task-decision-audit.test.ts tests/integration/f009b-close-second-approval-path.test.ts tests/integration/f007-approvals-rls.test.ts tests/integration/f025-portal-route-walk.test.ts` (0) — 85 passed
`npx vitest run tests/integration/f016j-client-requests-allowlist-guard.test.ts tests/integration/client-requests-rls.test.ts` (0) — 25 passed, no regression from the notify-on-createClientRequest wiring
`npx vitest run tests/unit/f024b-preview-write-guard.test.ts tests/integration/f014-mark-deliverable-delivered.test.ts` (0) — 16 passed, no regression from the notify-on-deliverPortalDeliverable wiring
`npx tsc --noEmit` (0)
`npm run build` (0)

## Decisions made
- **Defect 1 (byte-identical RPCs).** The task-page flow's subject is a
  `tasks` row, not an `approval_requests` row (20260925010000_f009b's own
  header explicitly declined to force one into existence for this legacy
  toggle — out of scope for this fix too). The equivalent "distinguishable
  record" here is an `audit_log` entry via the existing `write_audit_log_entry`
  RPC every other atomic RPC in this schema already uses — `approve_portal_task_atomic`
  now writes `task.approved`, `request_portal_task_changes_atomic` writes
  `task.changes_requested`. Verified this is real by writing the integration
  test FIRST and watching it fail against the unmigrated live schema (0 audit
  rows for either RPC), then re-running after `db:apply` (pass). I did NOT
  weaken the test to pass trivially — it asserts both that a record exists
  AND that the two actions' records are distinct.
- **The client-side note-collection question was already correct.**
  `components/portal/approval-actions.tsx`'s `handleRequestChanges` already
  requires a non-empty trimmed message before calling the action, and
  `lib/actions/portal-approval.ts`'s `requestPortalTaskChanges` already posts
  it as a comment via `addComment` (visible to the team, non-internal) before
  ever calling the RPC. No fix was needed there — verified by reading both
  files, not assumed.
- **`decideApproval` (the Approvals-view surface) already notifies the team.**
  `decide_approval_atomic` (20260925010000_f009b) already calls
  `public.create_notification(...)` inside its own transaction, notifying
  `requested_by` (the team member who raised the approval) with kind
  `approval_decided`. I left this untouched — adding a second notification
  from the TS action would double-notify. Only the three genuinely-silent
  call sites got new wiring: `approvePortalTask`, `requestPortalTaskChanges`
  (both in portal-approval.ts), `createClientRequest` (client-requests.ts),
  `deliverPortalDeliverable` (portal-deliverables.ts).
- **Recipients: "the project's decision owner and the subject task's
  assignee."** Added `lib/notifications/portal-recipients.ts`'s
  `getPortalEventRecipients`, mirroring `is_project_decision_owner(...,
  null, ...)`'s established "owns at least one decision type" reading for
  "the team's point of contact" on a project with no task-specific decision
  type of its own (this is the exact same reading 20260925010000_f009b
  established for the task-page path's own gate). Every `project_decision_owners`
  row for the project, plus the task's own `assignee_id` when a task exists,
  deduplicated, excluding the acting client.
- **Three new notification kinds, not a reuse of `approval_decided`.**
  `portal_task_decided` (approve/request-changes on the task page, decision
  distinguished by payload), `client_request_submitted`, and
  `client_deliverable_submitted`. Kept OUT of the shared `NotificationKind`
  type (used by `lib/notifications/fanout.ts`'s `computeFanoutRecipients`
  and `lib/notifications/preferences.ts`'s exhaustive `IN_APP_COLUMN_BY_KIND`
  map) as a new `PortalNotificationKind` type instead — these three are
  called directly, never through `computeFanoutRecipients`, exactly like
  `approval_decided`/`assumption_flagged` already are for the same reason.
  Adding them to `NotificationKind` would have forced `IN_APP_COLUMN_BY_KIND`
  to invent preference columns it doesn't need (mirrors why
  `approval_decided` isn't in `NotificationKind` either).
- **`notifications_kind_check` widened from the full grep-verified union,
  not retyped from memory** — per this task's explicit warning about the
  prior incident (missions/20260903-portal/SUMMARY.md). Re-derived by
  grepping `kind in (` across every migration AND every `p_kind =>`/`kind:`
  call site in `lib/`, landing on the same 9-kind list `20261019010000_f025c`
  already established (mention, comment_reply, task_assigned, task_due_soon,
  watcher_update, approval_decided, assumption_flagged, budget_threshold_80,
  budget_threshold_100), plus my 3 new kinds. Confirmed no migration after
  `20261019010000_f025c` touches this constraint before adding mine.
- **All three new notification call sites are try/catch-wrapped and
  non-fatal**, matching every existing post-write side effect in these three
  files (the trail comment in `approvePortalTask`, the auto-watch upsert in
  `addComment`, etc.) — a notification failure must never surface as a
  failure of the client's action that already succeeded.
- **Migration applied directly to the live/hosted Supabase project** via
  `npm run db:apply`, per instructions. Risk assessment: the migration only
  (a) adds a `perform write_audit_log_entry(...)` statement to the end of
  two existing SECURITY DEFINER functions (additive, no change to their
  existing authorization or update logic, no change to their signatures or
  return shape), and (b) widens `notifications_kind_check` (a CHECK
  constraint widen is additive — it can only make previously-rejected inserts
  succeed, never reject a row a caller could insert before). Neither is a
  destructive statement; no existing row is touched, no column/table is
  dropped or renamed. `npm run migrations:check` confirms no drift after
  applying.

## Out-of-scope work needed
- `approve_portal_task_atomic`/`request_portal_task_changes_atomic` still
  have no analogue of `approval_requests.resulting_task_id` — the client's
  note lives only as a `comments` row and now also an `audit_log` entry,
  never as a linked follow-up task the way `decide_approval_atomic`'s
  `changes_requested` path creates one (F011, 20260923010000). Retiring the
  legacy `pending_client_approval` boolean flow entirely in favour of a real
  `approval_requests` row was explicitly declared out of scope by
  20260925010000_f009b's own header and remains out of scope here — flagged
  again in case a future feature wants to close this gap for real.
- Email notifications remain unimplemented for all three new kinds (out of
  scope per this task's own instructions — in-app only).
- No notification preference gating exists for the three new
  `PortalNotificationKind` values (same as `approval_decided`/
  `assumption_flagged` today) — a user cannot opt out of
  `portal_task_decided`/`client_request_submitted`/`client_deliverable_submitted`
  in-app notifications. If F211's preferences UI is ever extended to these
  three kinds, `notification_preferences` needs three more boolean columns
  and `filterRecipientsByInAppPreference` needs to be called from these
  three sites — deliberately not done here, matching the existing precedent
  for `approval_decided`.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose a new `audit_log` entry (not a new column on
`tasks`, not forcing the legacy toggle into `approval_requests`) as the
"distinguishable record" for defect 1, because `write_audit_log_entry` is
this schema's already-established, append-only mechanism for exactly this
purpose, and the alternative (unifying the two decision paths) was already
explicitly declared out of scope by a prior migration's own header comment.

AUTONOMOUS_DECISION: Chose three new, portal-specific notification kinds
rather than reusing `approval_decided`, because `approval_decided`'s
existing payload shape and recipient (`requested_by`, singular) don't fit
these three new events (multiple decision owners, no `approval_requests`
row for two of the three events).

## Notes for the next worker
- No MCP server is registered for this session (missions/20260902-212300's
  `connections/mcp-registry.md`: "Supabase MCP: Not authorised in this
  session"). All schema verification was done by reading migration files
  directly (grep) and by applying/running the real migration against the
  live project via `npm run db:apply` / the app's own Supabase SDK client in
  the integration tests — no MCP tool calls were made or needed.
- The integration test (`tests/integration/f084-portal-task-decision-audit.test.ts`)
  requires real Supabase credentials in `.env` to run (`describe.skipIf(!haveCreds)`,
  same convention as `tests/integration/f009b-close-second-approval-path.test.ts`)
  and creates/tears down real auth users, a workspace, a project and two
  tasks — it ran successfully in this session because `.env` already has
  `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SECRET_KEY` populated.
- Did not touch `components/nav/app-sidebar.tsx`, `components/approvals/approvals-queue.tsx`,
  `components/chat/message-list.tsx`, `components/task/task-card.tsx`,
  `components/task/task-list-table.tsx`, or any `error.tsx`/`loading.tsx`
  file — those were left dirty in the working tree by a concurrent agent and
  were excluded from this commit via explicit pathspec.
