# Handoff: F016d — One gate for every client RPC, and the client_requests columns nobody re-read

## Status
COMPLETE

## Assertions covered
AS-046: PASS — `flag_assumption_atomic` now selects and checks `client_visible` via the shared `client_gate` predicate; `test_AS_046_rejects_a_client_flagging_a_client_visible_false_assumption` (new) fails without the fix, `test_AS_046_client_can_still_flag_a_client_visible_true_assumption` (new) covers the positive case. `test_AS_046_client_cannot_write_quoted_amount_client_decision_or_decided_by_on_their_own_submitted_request` (new, in F016's suite) covers Defect 2 — direct PostgREST PATCH now rejected by the new BEFORE UPDATE trigger. `test_AS_046_client_can_still_edit_title_and_body_of_their_own_submitted_request` confirms the trigger did not over-widen. All observed PASS in a live run against the mission's Supabase project.

## Files changed
supabase/migrations/20261001010000_f016d_one_client_gate.sql
lib/supabase/database.types.ts (regenerated, `npm run db:gen-types`)
tests/integration/f015-flag-assumption-atomic.test.ts
tests/integration/f016-change-request-quote-gate.test.ts

## Commands run
`npm run db:apply -- supabase/migrations/20261001010000_f016d_one_client_gate.sql` (0)
`npm run db:gen-types` (0)
`npx vitest run tests/integration/client-requests-rls.test.ts tests/integration/f009b-close-second-approval-path.test.ts tests/integration/f011-decide-approval-creates-task.test.ts tests/integration/f014-mark-deliverable-delivered.test.ts tests/integration/f015-flag-assumption-atomic.test.ts tests/integration/f016-change-request-quote-gate.test.ts tests/integration/f007-approvals-rls.test.ts tests/integration/f009-decide-approval-action.test.ts tests/integration/f006n-unguarded-task-rpcs.test.ts` (0, 109/109 passed on second run; first run had 2 unrelated Supabase auth rate-limit failures in f009-decide-approval-action.test.ts, both green on an isolated re-run 15s later — no code under test touches those two RPCs)
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 19 pre-existing warnings, unrelated files, unchanged count from M3 scrutiny's own toolchain report)

## Decisions made

- **`client_gate(project_id, client_visible, require_client_role, require_project_visible, require_portal_enabled)`** is the one predicate. `p_client_visible` defaults to `true` ("not applicable to this table" — no such column) rather than defaulting to a value that would silently skip the check when a caller forgets to pass it; a caller with a real `client_visible` column MUST pass the row's actual value or the gate does nothing for that axis, same failure mode this feature exists to close, but now visible in the call site's own argument list instead of buried in four omitted lines.
- **Routed through `client_gate`:** `flag_assumption_atomic` (full gate, was missing `client_visible` — the AS-046 fix), `mark_deliverable_delivered_atomic` (portal gate, `require_client_role => false` — any active member may deliver, per its own 20260928010000 header; no `client_visible` column on `client_deliverables`), `assert_portal_task_actionable_by_client` (full gate incl. `client_visible`, `require_client_role => false` because it does its own explicit `wm.role = 'client'` existence check immediately above with a role-specific rejection oracle it did not have before — see below), `decide_approval_atomic` (portal gate only), `accept_client_request_atomic` (portal gate only), `send_change_request_quote_atomic` (portal gate only, not named in the feature spec's own list but sharing `accept_client_request_atomic`'s exact preamble per 20260930010000's own header — leaving it on the old inline check while its twin moved would recreate the drift this feature exists to close).
- **Two checks deliberately NOT folded into `client_gate`,** named per the feature spec's own instruction:
  - `is_project_decision_owner` (F009b, 20260925010000) stays its own predicate. A decision owner is not necessarily a client — `project_decision_owners` carries no role constraint (`grep -n "role\|client" supabase/migrations/20260916010000_approval_requests.sql` inside the table definition shows no such column or check) — so folding it into `client_gate`'s client-role flag would be a correctness change, not a refactor.
  - The explicit `v_caller_role = 'client'` bar inside `send_change_request_quote_atomic` and `accept_client_request_atomic` stays inline. `client_gate`'s `p_require_client_role` flag means "require client-ness"; there is no flag that means "forbid client-ness" without inventing a second, opposite-meaning parameter only two functions would ever set — and both already had this exact check with its own distinct rejection message before this feature, unchanged here.
- **`client_gate` is itself a new `SECURITY DEFINER` function, granted to `authenticated` only** (not `PUBLIC`), pinned `search_path = public, pg_temp`, matching every other predicate introduced in this mission since 20260908010000.
- **Defect 2 fix is a `BEFORE UPDATE` trigger**, following F006k's `enforce_project_portal_and_launch_field_role` (20260919010000) shape exactly, per the spec's own instruction ("Follow F006k's projects trigger if a policy cannot express it") — RLS's `WITH CHECK` is row-level, not column-level, so a policy genuinely cannot pin twelve individual columns to their `OLD` values.
- **Twelve columns guarded** (pinned to `OLD` when the author is the one writing): `scope_verdict`, `quoted_hours`, `quoted_amount`, `quote_currency`, `quote_note`, `quote_valid_until`, `client_decision`, `decided_by`, `decided_at`, `track`, `track_overridden`, `track_override_reason`, `approval_request_id`. **`kind` and `severity` deliberately left writable** by the author — both are the client's own claim about their own request (triage bucket, how bad they say it is), the same trust the pre-existing `title`/`body` columns already carry; nothing about F016 changed that.
- **F006k's `service_role`-only exemption does not fit here** and I did not copy it verbatim. Both legitimate writers of the guarded columns (`send_change_request_quote_atomic` and `client_requests_sync_decision_from_approval`) run as `SECURITY DEFINER` under the caller's OWN authenticated session — often the request's own author, when that author is also the client whose `decide_approval_atomic` call just fired the sync trigger. `auth.uid()` is unchanged by `SECURITY DEFINER`, so a `service_role`-only exemption would have blocked AS-047's own decision-sync path the first time a client decided their own quote. Fixed instead with a transaction-local trust flag (`set_config('app.client_requests_triage_guard_bypass', 'on', true)`, `is_local => true`) that both legitimate writers set immediately before their own `UPDATE` and reset to `'off'` immediately after — scoped to the current transaction only, so it can never leak into an unrelated request, and nothing outside those two functions ever sets it. This was caught by writing the trigger, then re-reading `client_requests_sync_decision_from_approval`'s own `UPDATE public.client_requests SET client_decision = ...` and realizing the two functions collide with the guard by design — documented at length in the migration's own header and function comments so the next worker does not "fix" it back to a service_role check.
- Confirmed against every table that has added columns since F006k's own sweep (20260919010000) that Defect 2 is the only live gap: `approval_requests.resulting_task_id` (F011) has no client INSERT/UPDATE policy at all (`grep -n "create policy" supabase/migrations/20260916010000_approval_requests.sql` — only `_select_team`, `_select_client`, `_insert_team`, `_update_team`); the four F012 tables (`client_deliverables`, `project_scope_items`, `project_decisions`, `project_assumptions`) have zero client write policies per that migration's own header, confirmed by the same grep against `20260926010000_deliverables_scope_decisions_assumptions.sql`; F016c's composite FK addition is a constraint, not a client-writable column, on the same no-client-write table.

## Out-of-scope work needed

- FM (blocker, `client_deliverables.task_id`/`.phase_id` cross-workspace leak) — separately closed by F016c, confirmed present and unrelated to this feature.
- FO's other half — re-quote duplication / stranded pending approval (B5 in M3-scrutiny.md) — not touched here; this feature's scope was the column guard and the shared gate only.
- FP (AS-003 badge/view disagreement), FQ ("Turn into decision" trusting the browser), FR (test repair sweep) — all out of this feature's scope, unaddressed here, per the M3 scrutiny's own recommended-followups list.

## Blockers

(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: The feature spec names `accept_client_request_atomic`'s "client-facing branch" as a function to route through the shared gate, but the function as written bars the client role entirely — there is no branch reachable by a client. Interpreted this as "the one client-relevant gate remaining in this team-only function" (its `portal_enabled` check, since portal_enabled decides whether the client_requests row a team member is acting on is one a client could still see) and routed that single check through `client_gate` with both role/visibility flags off. Extended the same reasoning to `send_change_request_quote_atomic`, which was not named in the spec but shares `accept_client_request_atomic`'s exact preamble by the F016 migration's own header comment.

AUTONOMOUS_DECISION: Left `kind` and `severity` writable by the client author on `client_requests` (not pinned by the new trigger). Both are the client's own account of their own request, the same trust level the pre-existing `title`/`body` columns already carry — pinning them would be a policy change beyond "the client cannot forge the team's triage/quote/decision", which is what the spec's Defect 2 and AS-047's own reasoning describe.

## Notes for the next worker

- The transaction-local bypass flag (`app.client_requests_triage_guard_bypass`) is a new pattern in this schema — grep for it if you add a third legitimate writer of the twelve guarded columns; do not add a fourth ad-hoc exemption shape.
- `client_gate`'s `p_client_visible` parameter defaults to `true` (opt-out), not `false` (opt-in) — get this backwards in a new call site and the function will look like it's checking `client_visible` while actually skipping the check entirely. The function's own `comment on function` states this.
- No MCP tools used — Supabase MCP is not authorised for this mission per the task instructions; all schema work went through the CLI (`npm run db:apply`, `npm run db:gen-types`) against the live project already configured in `.env`.
