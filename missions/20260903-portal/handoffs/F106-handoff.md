# Handoff: F106 — Fix the second demo client's empty portal

## Status
COMPLETE

## Assertions covered
This feature is a seed-data fix, not tied to specific validation-contract assertion IDs (none were assigned in the mission's feature spec). No AS-NNN IDs apply.

## Files changed
scripts/seed-demo.mjs

## Commands run
`set -a; source .env; set +a; npm run seed:demo` (0) — run 1
`set -a; source .env; set +a; npm run seed:demo` (0) — run 2, identical console output/counts
`node --check scripts/seed-demo.mjs` (0)
Ad-hoc Node script against the admin client to count rows per table for the three portal-enabled projects (Website Redesign, Northwind Loyalty App — Phase 1, Meridian Ops Dashboard) after each run — counts identical across both runs.
Ad-hoc Node script signing in as `petra@demo.test` via the anon client (RLS-enforced) to confirm her visible workspaces/projects.

## Decisions made
- Treated the mission brief's "give both Cedarwood projects real portal data" as referring to the two portal-enabled projects that were previously thin — **Northwind Loyalty App — Phase 1** (Acme workspace, launched/finished) and **Meridian Ops Dashboard** (Cedarwood workspace, mid-flight/over-budget) — per the gap table in the spec, rather than literally "both projects in the Cedarwood workspace" (Meridian Compliance Audit is deliberately left with zero portal data by design, per the existing code comment: it's the private project even `petra`'s own workspace should not expose). This matches the spec's explicit constraint list (keep Meridian over budget, keep Northwind launched+warranty) and its "one mid-flight, one finished" character split.
- Extracted a shared `seedProjectPortalTables()` helper (phases, task→phase linking, decision owners, approval requests, deliverables, metrics+snapshots, scope items, decisions, links, accounts) generalised from the existing Website Redesign-only `seedPortalDemoData()`, so Northwind and Meridian reuse the exact same insert shapes/columns already verified against the migrations, rather than duplicating slightly-different logic. Website Redesign's own `seedPortalDemoData()` was left untouched (still has its own pages/docs/statuses logic that the other two don't need).
- Added 4 new tasks to Meridian Ops Dashboard's task list (data quality checks, liquidity forecast view, UAT, rollout & training) and set `clientVisible` flags on Northwind's existing 7 tasks (previously all implicitly `false`) so each project has enough client-visible tasks to produce genuine, non-uniform phase-progress fractions (1/1, 2/2, 0/0-tasks, 0/3, 0/2) — authored directly into the task list, never by editing a phase's own `state` after the fact.
- Deliberately kept one phase per new project with zero client-visible tasks: Northwind's "Technical foundation" (has a real task, "Points ledger schema", but it's internal) and Meridian's "Pipeline build" (has "ETL pipeline: positions feed", also internal) — a different flavor of "empty phase" than Website Redesign's Kick-off (which has no task at all), exercising the same render path from a different cause.
- Meridian's decision owners route `technical`/`commercial` to `petra` and `content`/`brand` to `sasa` (a data/ops dashboard has no brand or copy decisions to hand to a client) — the inverse emphasis from Website Redesign's owners, on purpose, so the two engagements read as genuinely different kinds of work.
- Approvals/deliverables/metrics for Meridian are a live mix (2 pending approvals — one overdue —, 1 overdue not-started deliverable, one metric in real regression: manual reporting hours are up because the old spreadsheet process still runs in parallel) matching the "mid-flight" character. Northwind's approvals/deliverables are all settled (approved/accepted/waived, none pending) matching "finished".
- `project_budgets` stayed exactly as `WORKSPACE2_BUDGET` (unchanged) for Meridian — the existing over-budget math (20h sold vs. tasks alone totalling well past that) was already correct and is untouched. Northwind intentionally gets no budget row, same as before — it's out of active billing (in warranty), not an over/under-budget case.
- `NORTHWIND_DECISION_OWNERS`/approvals reference `nina`'s user id directly even though she is not a member of this project (no `guestAccess`) — `project_decision_owners.user_id` and `approval_requests.decided_by` are plain FKs to `auth.users`, not scoped to project membership, and the existing code comment already documents that staff reach this project via "Preview as client".

## Out-of-scope work needed
None identified beyond this feature's scope. The seed script's existing Website Redesign-only extras (Pages/training doc/custom Blocked column) were deliberately not replicated for Northwind/Meridian — the spec's gap table and "what to add" list only names phases/approvals/deliverables/metrics/budget/links/accounts/scope items/decisions, and neither project's role in the demo set (finished vs. mid-flight over-budget) calls for a Pages walkthrough.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted "both Cedarwood projects" in the mission prose as the two previously-thin portal projects named in the gap table (Northwind Loyalty App, which is actually in the Acme workspace, and Meridian Ops Dashboard) rather than literally both projects inside the Cedarwood Partners workspace, since Meridian Compliance Audit's zero-portal-data state is explicitly called out elsewhere in the same file as intentional (the project petra's own workspace should not expose to her), and the spec's own constraints section only names Meridian Ops Dashboard and Northwind Loyalty App by their specific existing states (over budget; launched+warranty).

## Notes for the next worker
- Verified via a live query against the anon Supabase client, signed in as `petra@demo.test` (RLS-enforced, not the admin client): she sees exactly one workspace (`Cedarwood Partners`) and exactly one project (`Meridian Ops Dashboard`) — confirmed she cannot reach Acme Studio or Meridian Compliance Audit at the database/RLS layer.
- I could not drive a browser in this environment, so I did not visually walk `petra`'s portal UI end to end as the spec's "look at it" step asks — the RLS-level query above is the closest verification I could perform. A human (or an agent with browser tooling) should sign in as `petra@demo.test` / `Demo1234!` at `/w/cedarwood-partners` → Meridian Ops Dashboard → Client Portal and spot-check that phases/approvals/deliverables/metrics/links/accounts render with real content, not empty states.
- Per-table row counts confirmed identical across two consecutive `npm run seed:demo` runs, queried directly via the admin client: Meridian Ops Dashboard — 5 phases, 4 approvals, 5 deliverables, 4 metrics (+4 snapshots), 1 budget, 4 links, 4 accounts, 4 scope items, 2 decisions, 4 decision owners. Northwind Loyalty App — Phase 1 — same shape minus the budget (0, by design): 5 phases, 4 approvals, 4 deliverables, 4 metrics (+4 snapshots), 4 links, 4 accounts, 4 scope items, 2 decisions, 4 decision owners.
- Did not touch `components/portal/phase-timeline.tsx`, `components/portal/metric-comparison-card.tsx`, or the Results page, per instruction — only `scripts/seed-demo.mjs`.
