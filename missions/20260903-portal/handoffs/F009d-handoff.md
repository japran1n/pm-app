# Handoff: F009d — Approval hardening follow-ups (FM + FN)

## Status
COMPLETE

## Assertions covered
AS-024: PASS — `prevent_approval_request_settled_update` inverted from a four-column deny-list to a two-column allow-list (`updated_at`, `resulting_task_id`); `tests/integration/f011-decide-approval-creates-task.test.ts`'s existing AS-024 tests (including the purge/resulting_task_id survival test and the four-decision-field rejection test) still pass unchanged, plus a new test proves `project_id`/`subject_id`/`artifact_url`/`round` are now also rejected on a settled row, by `service_role`, which is FM's exact defect.

## Files changed
supabase/migrations/20261020010000_f009d_approvals_allowlist_guard.sql (new)
supabase/migrations/20261021010000_f009d_no_owner_refusal_message.sql (new)
lib/actions/portal-approval.ts
tests/integration/f011-decide-approval-creates-task.test.ts
tests/unit/portal-approval-action.test.ts

## Commands run
`npm run db:apply -- supabase/migrations/20261020010000_f009d_approvals_allowlist_guard.sql` (0)
`npm run db:apply -- supabase/migrations/20261021010000_f009d_no_owner_refusal_message.sql` (0)
`npm run db:gen-types` (0)
`npx vitest run tests/integration/f011-decide-approval-creates-task.test.ts tests/integration/f007-approvals-rls.test.ts tests/integration/f016j-client-requests-allowlist-guard.test.ts tests/integration/f020b-projects-allowlist-guard.test.ts tests/integration/f025c-projects-guard-bypass-and-notification-kind.test.ts` (0, 68 tests passed — F011b's own AS-024 tests included and unchanged)
`npx vitest run tests/unit/portal-approval-action.test.ts components/portal/approval-actions.test.tsx` (0, 38 tests passed)
`npx tsc --noEmit` (0)
`npx eslint lib/actions/portal-approval.ts tests/unit/portal-approval-action.test.ts tests/integration/f011-decide-approval-creates-task.test.ts` (0)

## Decisions made
- **FM — allow-list, not deny-list, on `approval_requests`.** Grepped every
  `update approval_requests` / `update public.approval_requests` site in
  `supabase/migrations` (20260916010000:420, 20260920010000:104,
  20260923010000:231, 20260925010000:248, 20261001010000:474,
  20261002010000:137, 20261005010000:208, 20261018010000:148). Every
  decision-field write happens while `decide_approval_atomic` has already
  asserted `v_state = 'pending'` moments earlier (20260916010000:401-402,
  unchanged in every later version of that function); every `state =
  'withdrawn'` write carries its own `and state = 'pending'` WHERE clause.
  None of them touch an already-settled row. The only two writes that DO
  land on a settled row are `resulting_task_id` (nulled by
  `tasks.resulting_task_id`'s `on delete set null` FK action, F011's own
  documented "no immutability rule of its own") and `updated_at`
  (`approval_requests_set_updated_at`, fires on every write, settled or
  not). So the allow-list is exactly `{updated_at, resulting_task_id}`,
  verified by grep, not assumed by pattern-matching F016j/F020b.
- **No `service_role` exemption, no bypass flag.** Unlike F016j
  (`client_requests`) and F020b/F025c (`projects`), this guard does NOT
  exempt `service_role` — FM's own defect was specifically that
  `service_role` could rewrite a settled row, so carrying that exemption
  forward would reopen the hole this feature exists to close. No bypass
  flag was added either, because the grep above found no legitimate
  SECURITY DEFINER writer that touches a settled row outside the two
  allow-listed columns — unlike F025c's `task_counter` surprise on
  `projects`, there is no third writer here to carve an exception for.
- **No INSERT-side guard.** F011b's original trigger, and every caller of
  it, was UPDATE-only (`OLD.state <> 'pending'`); this feature's own
  definition of done scopes the fix to "an update to a column not on the
  list is rejected on a settled row", not to a general field-role policy
  the way F020b added on `projects`. INSERT validity stays covered by
  `approval_requests_subject_shape_check` and the existing RLS/RPC layer,
  untouched by this migration.
- **FN — the shared "task not found" oracle stays merged for five
  branches, split for one.** `assert_portal_task_actionable_by_client`
  (the gate behind the legacy task-page Approve control) raises the same
  literal `'task not found'` for deleted/non-member/invisible-or-portal-off
  (F016d's `client_gate` consolidation)/not-pending — deliberately, per
  F009b's own header, so a caller probing a task they cannot see learns
  nothing. Only the LAST branch, "caller owns no decision type on this
  project", is split out with its own named message: by the time that
  check runs, the caller has already proven active client membership,
  project visibility, portal-enabled, and the task's own pending+visible
  state — i.e. the Approve button is already on their screen — so naming
  this refusal leaks nothing beyond what the UI already shows. Recreated
  `assert_portal_task_actionable_by_client` from its ACTUAL current body
  (20261001010000, F016d's `client_gate` version — confirmed via grep
  that F016d's `CREATE OR REPLACE` is the last one before this feature,
  superseding F009b's own earlier version), not from the older F009b body
  quoted in scrutiny docs, to avoid silently reverting F016d's
  consolidation.
- **Wording matches the Approvals view.** The new message,
  `"No one is assigned to decide this yet."`, is copied verbatim from
  `components/portal/approval-card.tsx`'s existing `!isOwner &&
  !ownerName` text, so both surfaces say the same sentence for the same
  situation, per FN's explicit instruction.
- **`lib/actions/portal-approval.ts` forwards exactly one known-safe RPC
  message, not "whatever the RPC said".** `friendlyPortalTaskActionError`
  recognises only the exact `assert_portal_task_actionable_by_client: no
  one is assigned to decide this yet` string and maps it to the friendly
  sentence; every other RPC error (including the deliberately generic
  `'task not found'` oracle) still collapses to the existing generic
  "Something went wrong" message, preserving F009b's oracle for the other
  five branches while fixing the one FN names.

## Out-of-scope work needed
None identified beyond this feature's own two items. The legacy
task-page Approve control (`approval-actions.tsx`) still does not show an
`isOwner`-style disabled state up front the way `approval-card.tsx` does
(it always renders the button when the task is pending, and only learns
about missing ownership on click) — FN's own scope was "say what
happened", not "prevent the click", and the spec's Definition of done
only asks the message to be honest, not for the legacy surface to gain
`approval-card.tsx`'s presentational pre-check. A future feature could
thread `isOwner`/`ownerName` into the task page the same way F009 did for
the Approvals view, if that inconsistency is judged worth closing.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: FN's "the legacy portal Approve control" was
interpreted as `components/portal/approval-actions.tsx` /
`approve_portal_task_atomic` / `request_portal_task_changes_atomic` (the
task-boolean flow that predates F009's first-class `approval_requests`
table), since that is the only approval surface in this codebase without
its own owner-aware pre-check — `approval-card.tsx` (F009's own,
`decide_approval_atomic`-backed component) already forwards the RPC's
specific decision-owner message via `friendlyDecideApprovalError` and
already shows "No one is assigned to decide this yet." as presentational
text before any click. No feature spec or clarification file names a
second "legacy" component, but the two-flow split (F009b's own header:
"the second, ungated client decision path") and the exact generic-message
collapse in `lib/actions/portal-approval.ts` confirmed this reading.

AUTONOMOUS_DECISION: chose to name only the "owns no decision type"
branch and leave the other five branches of
`assert_portal_task_actionable_by_client` merged under the shared "task
not found" oracle, rather than naming every branch individually. FN's own
spec is scoped to "no decision owners configured", and F009b's header
gives an explicit security reason (avoiding an existence/visibility
oracle) for keeping the others merged that this feature has no
instruction to override.

## Notes for the next worker
- Two migrations were needed because FM and FN touch two different
  functions with unrelated blast radii — kept as separate files so a
  revert of one does not have to touch the other.
- `supabase/migrations/20261021010000_f009d_no_owner_refusal_message.sql`
  recreates `assert_portal_task_actionable_by_client` in full (required by
  `CREATE OR REPLACE`'s "replaces the whole body" semantics, same
  convention every prior migration in this mission uses) — diff it against
  `20261001010000_f016d_one_client_gate.sql:538-595` to see the one-branch
  change in isolation.
- No MCP tools were used — the Supabase MCP is not authorised for this
  mission per the task instructions; all schema work went through
  `npm run db:apply` / `npm run db:gen-types` against the CLI-configured
  project, matching every other migration in this mission.
