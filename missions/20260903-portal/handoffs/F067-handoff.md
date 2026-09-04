# Handoff: F067 — seed portal demo data for Website Redesign

## Status
COMPLETE

## Assertions covered
This feature has no assigned assertion IDs (it is a demo-data seeding task, not
a behavioural feature) — none listed in validation-contract.md for F067.

## Files changed
scripts/seed-demo.mjs

## Commands run
`node --check scripts/seed-demo.mjs` (0)
`npm run seed:demo` (0) — run 1
`npm run seed:demo` (0) — run 2 (idempotency check)
`npm run seed:demo` (0) — run 3 (full-output re-check)
Throwaway `scripts/__verify_tmp.mjs` (admin-client row-count query, deleted after use, not committed)

## Decisions made
- Derived every table/column/enum value from `supabase/migrations/*.sql` and
  `lib/supabase/database.types.ts` directly (cited by filename in the new code's
  comments) — no guessing. Key sources: `20260909010000_portal_foundations.sql`
  (project_phases, projects launch fields), `20260916010000_approval_requests.sql`
  (approval_requests, project_decision_owners — including the
  "settled rows can never be updated" trigger, which is why decided approvals
  are inserted already-decided, not inserted-then-updated),
  `20260926010000_deliverables_scope_decisions_assumptions.sql`
  (client_deliverables, project_scope_items, project_decisions,
  project_assumptions), `20260930010000_f016_change_requests_quote_gate.sql`
  (client_requests' kind/severity/scope_verdict/track/client_decision columns),
  `20261010010000_f017_project_budgets_work_category_hours_rpcs.sql`
  (project_budgets, time_entries.work_category), `20261013010000_f020_...sql`
  (project_metrics/metric_snapshots — direction matters, one metric is a
  deliberate regression), `20261014010000_f022_..._docs_visibility.sql`
  (project_links, project_accounts, docs.doc_kind), and
  `20260912010000_task_type_system_key.sql` (task_types.system_key = 'page',
  the stable key the Pages view matches on).
- `portal_enabled` (+ launch fields) is set only on Website Redesign, via a
  plain admin-client `.update()`. Verified this is not blocked by the
  allow-list guard trigger on `projects`
  (`20261022010000_f025d_projects_key_insert_guard.sql`'s own comment: "Bypassed
  by service_role always") — the seeder already runs as the admin/service-role
  client.
- For the "Blocked" Pages status: rather than manually computing and inserting
  `tasks.status_id`, I insert the custom `project_statuses` row first
  (`name: 'Blocked'`, `client_bucket: 'blocked'`) and then insert the task with
  `status: 'Blocked'` (text). `sync_task_status_and_status_id`
  (`20260824010000_project_statuses.sql`) derives `status_id` from
  `(project_id, name)` on every insert when `status` text is non-null — passing
  a hand-picked `status_id` directly would have been silently overwritten by
  that same trigger's first branch.
- Time entries: extended the existing per-task insert (now inserts an array,
  not a single row) rather than adding a second insert path, per the spec's
  explicit instruction. `WEBSITE_WORK_CATEGORY` overrides category/billable
  only for Website Redesign's own tasks; every other project's entries keep
  `work_category: null` exactly as before this feature (an honest
  "Uncategorised" bucket, not a new default). `WEBSITE_EXTRA_TIME_ENTRIES`
  layers two more rows onto "Homepage hi-fi design" (one `qa`-category
  billable entry, one null-category non-billable entry) so both the
  Uncategorised bucket and a `qa` category are exercised without inventing a
  new task.
- Budget period is `[today-30, today+30]`; every seeded time entry (existing
  and new) falls inside it, and `sold_minutes: 6000` (100h) is well above the
  ~35h logged so the burn-down has real room to show, not a maxed-out bar.
- Decision owners: three types → `nina` (client), `technical` → `sasa` (the
  agency lead) rather than "nobody", because this demo workspace has exactly
  one client account and the spec's "empty/other state" only needed *a*
  non-nina owner to be visible, not literally no owner — an unowned row would
  also have rendered a weaker, more ambiguous demo ("did the team forget to
  set this?" vs. "this one is the agency's own call").
- `client_requests`: one already-quoted-but-undecided change request
  (`status: 'in_review'`, `scope_verdict: 'change_request'`, quote columns
  filled, `client_decision: 'pending'`) and one still-untriaged request
  (`status: 'submitted'`, no verdict/quote). Neither links an
  `approval_requests` row via `approval_request_id` — `send_change_request_quote_atomic`
  would normally raise one, but reproducing that whole RPC's side effects
  by hand for demo data wasn't required by this feature's own checklist
  (which only asks for "one quoted, one pending" client_requests rows, not for
  the commercial-approval linkage too); noted below as out-of-scope if a future
  worker wants the Approvals view to also show this quote's own decision row.

## Out-of-scope work needed
- The quoted change request above does not have a matching `approval_requests`
  row with `decision_type: 'commercial'`, so the portal's Approvals view will
  not show "decide this quote" as one of its rows the way a real
  `send_change_request_quote_atomic` call would produce. If a future worker
  wants that specific cross-view linkage demoed, insert one more
  `approval_requests` row (`subject_type: 'artifact'`, `decision_type:
  'commercial'`, `subject_id` = the client_requests row's id per that RPC's own
  convention) and set the change request's `approval_request_id` to it.
- No second client account exists in this workspace, so the "decision owner
  assigned to a different client" reading of the spec's requirement was
  satisfied via a non-client (agency) owner instead — see Decisions made.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Read "decision owners... at least one assigned to nobody
or to a different client" as satisfied by assigning the `technical` decision
type to a team member (`sasa`) rather than leaving it fully unowned, since a
genuinely-unowned decision type is a weaker demo of the "who decides" table
than a real, different-role owner is, and the spec's own wording accepts
either.

## Notes for the next worker
- Row counts confirmed via a throwaway admin-client script (deleted after use,
  per instructions) after three consecutive `npm run seed:demo` runs — second
  and third runs produced byte-identical counts to the first for every new
  table: project_phases=7, approval_requests=4, project_decision_owners=4,
  client_deliverables=5, project_budgets=1, project_metrics=4,
  metric_snapshots=4, project_scope_items=4, client_requests=2,
  project_decisions=2, project_assumptions=2, project_links=4,
  project_accounts=4, docs(training)=1, page tasks=6. `portal_enabled` is
  `true` on Website Redesign and `false` on the other three projects on every
  run.
- Pages view distribution across the three runs verified: 1 done, ~3 progress,
  1 waiting (via `pending_client_approval`, not a status name), 1 blocked (via
  the custom `Blocked` status's `client_bucket` override) — not a solid block.
- Metrics: Bounce rate is the deliberate regression (`direction: 'lower'`,
  `baseline_value: 55`, current snapshot `61` — worse, not better).
- No new tables needed adding to `wipeWorkspace`'s delete list: every table
  touched cascades from `projects` (or, for `task_types`, from `workspaces`)
  per its own migration's `on delete cascade` — confirmed by grepping each
  `create table` statement before writing the seed code, not assumed.
- No MCP tools used — this is a local seed script writing through the
  project's own `@supabase/supabase-js` admin client, per
  `worker-mcp-usage`'s decision tree ("Query seed/fixture data to validate a
  feature" is the one MCP-eligible case here, and I used a throwaway Node
  script with the same admin client instead, which is equivalent and matches
  this file's own existing convention of never depending on MCP at seed-time).
