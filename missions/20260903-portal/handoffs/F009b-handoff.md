# Handoff: F009b — Close the second approval path

## Status
COMPLETE

## Assertions covered
AS-022: PASS — `decide_approval_atomic` and `approve_portal_task_atomic`/`request_portal_task_changes_atomic` now share one predicate (`is_project_decision_owner`); tested directly, as four callers (decision owner, client who owns nothing, client of another project, client of a portal-disabled project) against every path in `tests/integration/f009b-close-second-approval-path.test.ts` (12/12 pass).

## Files changed
supabase/migrations/20260925010000_f009b_close_second_approval_path.sql
lib/actions/approvals.ts
lib/supabase/database.types.ts (regenerated)
tests/integration/f009b-close-second-approval-path.test.ts

## Commands run
`npm run db:apply -- supabase/migrations/20260925010000_f009b_close_second_approval_path.sql` (0)
`npm run db:gen-types` (0)
`npx tsc --noEmit` (0)
`npx eslint .` (0, 20 pre-existing warnings unrelated to this change)
`npx vitest run tests/integration/f009b-close-second-approval-path.test.ts tests/integration/f009-decide-approval-action.test.ts tests/integration/f007-approvals-rls.test.ts tests/integration/f008-request-approval-action.test.ts tests/integration/f011-decide-approval-creates-task.test.ts tests/unit/portal-approval-action.test.ts tests/unit/portal-overview-queries.test.ts` (0 — 106/106 pass)

## Decisions made

- **Did not literally route the task page through `decide_approval_atomic`, and here is why, in the terms the spec asked for.** The legacy `pending_client_approval` flow (`lib/actions/client-visibility.ts:199`) flips a boolean directly and never creates an `approval_requests` row (confirmed: `grep -rn pending_client_approval app lib supabase/migrations`, no insert into `approval_requests` from that file or `client-visibility.ts`). There is no `decision_type` and no `request_id` for the task page to pass `decide_approval_atomic` — that RPC's whole shape (`p_request_id`) assumes a first-class request exists. Forcing one into existence for every legacy toggle would be a second, larger feature this spec's own Definition of Done forbids ("the legacy pending_client_approval toggle still works for what it is for" — i.e. keep it working as it is, not replace its data model).
- **What I did instead, and why it satisfies "one gate, not two copies that must agree forever":** both existing decision paths already delegate to exactly one gate function each — `decide_approval_atomic` is its own single call site, and `approve_portal_task_atomic` / `request_portal_task_changes_atomic` both already delegated their entire authorisation check to one shared helper, `assert_portal_task_actionable_by_client` (confirmed: `grep -n assert_portal_task_actionable_by_client supabase/migrations/20260906010000_portal_task_actions_project_visibility.sql` shows both RPC bodies calling it and nothing else checking authorisation in either body — this predates F009b). So the fix that keeps the two SURFACES (Approvals view vs. task page) from drifting apart again is a new shared SQL function, `public.is_project_decision_owner(p_project_id, p_decision_type, p_user_id)`, called from both `decide_approval_atomic` (with the request's own `decision_type`) and `assert_portal_task_actionable_by_client` (with `p_decision_type := null`, meaning "owns at least one decision type on this project"). One predicate, two callers, changed together in one migration — the same shape design constraint #6 asks for, and the closest database-checkable analogue of "named decision owner" for a boolean that was never raised against a specific decision type. This is technically option 2 from the spec's menu (gate the second RPC too) but implemented as a single shared primitive rather than a second inline copy, which is what the spec's own worry ("two functions that must agree forever") is actually about.
- **`p_decision_type := null` semantics chosen deliberately as "owns at least one," not "owns all."** This matches the defect exactly as reported: "a client who owns no decision type is refused on the Approvals view and succeeds on the task page." A client who owns exactly one decision type (any type) now succeeds on the legacy toggle too, same as before this fix for owners — the fix closes the "owns nothing" gap, not a new "must own every type" restriction nobody asked for.
- **`subject_id` cross-project validation added inside `decide_approval_atomic` only** (per the spec's own scope item 2: "In the RPC, not in Zod"), for all three subject types that carry a `subject_id` (`task`, `doc`, `phase`), checked against `v_project_id` before the function touches the subject at all. Raises `P0002` ("approval request not found") rather than silently skipping the subject-touching writes, since a mismatched subject means the row is malformed — same reasoning F-1 in the M2 report gives. Did not add the same check to the `approval_requests_insert_team` / `approval_requests_select_client` RLS policies (F-1's other half, and follow-up FK) — out of scope for this feature (see below); `requestApproval` (`lib/actions/approvals.ts`) already checks `taskRow.project_id !== ctx.projectId` / `docRow.project_id !== ctx.projectId` in TypeScript for its own writes, so the only remaining reachable path for a mismatched subject is a raw PostgREST insert bypassing the app, which the RPC-level check now defangs at decision time regardless of how the row was created.
- **`requestApproval` portal gate implemented as a new `portalEnabled` field on `loadProjectExtra`'s existing `ProjectExtra`**, following the exact pattern the decision-owner check already uses in the same function (explicit lookup, explicit "sent into a void" style refusal, before the decision-owner check runs). Placed first (before the decision-owner lookup) since it's the cheaper, more fundamental gate.
- Migration file dated `20260925010000` (after `20260924010000_f011b_...`, the most recent migration in the mission), following this mission's date-ordered filename convention.
- Errcode for `assert_portal_task_actionable_by_client`'s rejections is `P0001` (Postgres's default for `raise exception` with no explicit `using errcode`), not `42501` — verified this is pre-existing and unchanged by this migration (`grep -n "raise exception" supabase/migrations/20260906010000_portal_task_actions_project_visibility.sql supabase/migrations/20260918010000_f006i_authz_round_2.sql` shows no branch in that function ever sets an errcode). Not something this feature was asked to fix; the new test documents the actual code rather than the code I initially assumed.

## Out-of-scope work needed

- **F-1's other half (RLS/FK level `subject_id` validation on INSERT).** `approval_requests_insert_team` and `approval_requests_select_client` (`20260916010000_approval_requests.sql`) still have no `t.project_id = approval_requests.project_id` predicate in their `EXISTS` clauses. A raw PostgREST insert as a project-A writer could still create a row whose `subject_id` belongs to project B; `decide_approval_atomic` now refuses to *act* on it (this feature closes that), but the malformed row itself can still be created and would sit forever as `pending` (visible to project A's team, invisible to anyone who could fix it). M2's own recommended follow-up **FK** describes exactly this, unclaimed by this feature.
- **F-3/F-4/F-5/F-6 and B1/B3/B4** from `M2-scrutiny.md` — all outside this feature's four scope items (guest guard on the approvals queue, trashed-subject leak, doc-subject viewability, layout-render cost, colour-token drift, AS-002's test-mirrors-implementation defect). Untouched.
- **`project_decision_owners_update_team`'s missing membership `WITH CHECK`** (noted in B2's "Secondary" paragraph) — any project writer can still point a decision type at a user who isn't a member of the project/workspace. Not touched; would need its own migration and is a distinct defect from the one this feature closes.

## Blockers

(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: Chose the shared-predicate form of "option 2" over literally routing the task page through `decide_approval_atomic`, because the legacy toggle carries no `decision_type`/`request_id` to route with and the DoD requires it keep working unchanged in shape. Documented full reasoning above per the spec's explicit "if you choose the second, say why" instruction.

AUTONOMOUS_DECISION: For the legacy toggle's decision-owner check, used "owns at least one decision type on this project" (`p_decision_type = null`) rather than requiring a specific type, since the boolean flag was never associated with one. This is the narrowest predicate that closes the reported defect ("owns no decision type... succeeds") without inventing a new restriction the spec never asked for.

## Notes for the next worker

- The new shared function is `public.is_project_decision_owner(p_project_id uuid, p_decision_type text, p_user_id uuid) returns boolean`, `SECURITY DEFINER`, `search_path = public, pg_temp`, granted to `authenticated`. Any future third decision-consuming surface should call this rather than re-inlining the `project_decision_owners` lookup.
- `assert_portal_task_actionable_by_client`'s rejection errcode is `P0001`, not `42501` — worth normalizing to `42501` in a future pass for consistency with `decide_approval_atomic`'s explicit codes, but that's a cosmetic change with its own blast radius (every existing caller/test keyed to the current message-only oracle), left alone here.
- No MCP was used — mission's Supabase MCP is not authorised per the task instructions; migrations applied via `npm run db:apply` / `npm run db:gen-types` (CLI scripts) as instructed.
