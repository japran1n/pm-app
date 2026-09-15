# State — 20260915-status-sitemap-audit

Phase: RUN (started 2026-09-15).

| Track | Status |
|---|---|
| F1 — status surfaces (bulk update + task detail sheet) | IN PROGRESS — worker spawned |
| F2 — portal Site map parity | IN PROGRESS — worker spawned |
| DB cleanup + reseed (data op, not a feature) | IN PROGRESS — orchestrator, direct via Supabase MCP |

## DB cleanup + reseed — progress (2026-09-15)

Done directly by the orchestrator via Supabase MCP (project `qcipqonnqajmazdbysow`,
"ProjectManagement"):

- Deleted project `Good Guys — goodguys.se` entirely (tasks + all dependents).
- Deleted every other workspace, project, task and user in the database
  except workspace `Goodguys Demo` and its 6 real accounts
  (demo+owner/admin/client/member/viewer/guest@goodguys.test).
- Fixed the exact bug the status audit found in production data: 2 tasks
  in the kept project had `status='todo'` with `status_id = null`
  (orphaned by the very bug F1 is fixing) — corrected as part of the
  status redistribution below.
- Redistributed the kept project's 74 tasks/pages/sections across the real
  11-status set to read as ~80% complete (40 Completed, 10 Approved, then a
  tail of Awaiting Client/QA by Design/QA by Dev/In Dev/In Design/Blocked/To
  Do/Backlog), with realistic due dates (some intentionally overdue for
  testing overdue UI) and a blocked_reason on the 2 Blocked items.
- Set `launch_confidence`, `target_launch_date`, `launch_note` on the project.
- Renamed a handful of leftover placeholder task titles ("asdasdas", "2test",
  "Test", "Testiramo Extension") to realistic ones.
- Filled in previously-empty tables for this project: `project_decision_types`
  + `project_decision_owners` (client owns brand/design/content, owner owns
  technical), 3 more `approval_requests` (2 pending incl. one overdue, 1
  approved, 1 changes_requested) alongside the existing overdue pending one,
  2 more `client_deliverables` (delivered + waived) alongside the existing
  3, `project_metrics` + `metric_snapshots` (3 metrics with a 3-point history
  each), `project_improvements` (2), `project_accounts` (4 services),
  `page_links` (6, Figma/staging), `doc_links` (2), more `checklist_items`
  and `comments` spread across in-progress tasks, `task_custom_field_values`
  for every page (Figma link) and every top-level task (client ref number),
  ~7 `notifications` across the 3 team accounts, 5 `task_activity` entries,
  and 4 more chat `messages` in the project channel.
- Set `profiles.display_name` for all 6 kept accounts (was null everywhere).

Not yet done: a final sweep to remove test-fixture noise that the F1/F2
workers' own integration test runs create against this same hosted database
while they work (expected — they were told to use their own throwaway
fixtures rather than touch "Goodguys Demo"). Counts as of this checkpoint:
auth.users=16, workspaces=2, projects=4, tasks=77 (vs. the target 6/1/1/74) —
the delta is live worker test fixtures, not a mistake in the cleanup above.
**Orchestrator must re-run the same delete-all-except-kept-workspace sweep
once both F1 and F2 workers report done**, before declaring the mission
complete.

## DB cleanup + reseed scope (confirmed with product owner 2026-09-15)

- Keep workspace `Goodguys Demo` (id `e0b89b59-da49-4e34-9455-37c15d7c27b6`,
  slug `goodguys-demo`) and its two real accounts: `demo+owner@goodguys.test`
  (owner) and `demo+client@goodguys.test` (client).
- Keep and enrich project `Goodguys Demo — Website Relaunch` (id
  `bf4c4868-c038-4c8a-aea6-ecd9d430fa01`, key GDWR, portal already enabled)
  to ~80% completion, fully populated across every feature table, so the
  product owner can exercise the whole app (workspace + portal) end to end.
- Delete project `Good Guys — goodguys.se` (id
  `a1b2c3d4-0000-4000-8000-000000000001`).
- Delete every other workspace/project/user in the database — confirmed to
  be E2E-test fixture noise (~3493 workspaces, ~3746 other projects, ~8080
  auto-generated `@example.com` accounts from Playwright/vitest runs), not
  real data.
