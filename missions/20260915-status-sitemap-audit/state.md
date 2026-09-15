# State — 20260915-status-sitemap-audit

Phase: COMPLETE (2026-09-15).

| Track | Status |
|---|---|
| F1 — status surfaces (bulk update + task detail sheet) | DONE — branch `fix/status-surfaces-parity` (commit `318a1254`), merged to `main` locally |
| F2 — portal Site map parity | DONE — branch `feat/portal-sitemap-parity` (commit `43076eea`), merged to `main` locally |
| DB cleanup + reseed (data op, not a feature) | DONE — orchestrator, direct via Supabase MCP |

## Final gate (orchestrator, after merging F1 + F2 into `main`)

Both branches merged into `main` with `--no-ff`, zero conflicts (disjoint
files). Full gate re-run on the merged tree:
- `npx tsc --noEmit`: clean.
- `npx eslint .`: clean.
- `npx vitest run tests/unit`: 423 files / 2717 tests passed, 1 file / 3
  tests skipped (pre-existing, unrelated).
- `npm run build` (next build, Turbopack): clean, all routes generated.
- Hosted integration re-check: `bulk-update-tasks.test.ts` +
  `move-task-status.test.ts` against the live Supabase project: 19/19 pass.

Not pushed to `origin` and no PR opened — local `main` only, per no explicit
request to push. Branches `fix/status-surfaces-parity` and
`feat/portal-sitemap-parity` still exist locally alongside the merge commits.

## Browser verification (2026-09-15, dev server + dev-login)

Logged in as both `demo+owner@goodguys.test` (workspace) and
`demo+client@goodguys.test` (portal) against the merged `main` build:
- Workspace List view bulk "Set status" now shows all 11 real project
  statuses (Backlog…Completed), not the old 4 — confirmed visually.
- Task Detail Sheet status picker shows the same real 11 statuses with the
  task's actual status checked — confirmed visually.
- Portal Site map: tree view renders with folder synthesis (a synthetic
  "Legal" folder grouping Cookie Policy + Terms of Service), CMS pages tint
  correctly (Services, Blog), component-linked sections tint green, and the
  Components panel lists every shared component with correct instance
  counts (Navigation Bar ×5, Footer ×5, Hero ×3, Card Grid ×2, Stats Bar ×2,
  Contact Form/Blog Post/Team Bios ×1) — scoped correctly to client-visible
  sections only (AS-6), confirmed by a since-fixed unused component
  ("Testimonial Slider") correctly NOT appearing in the client panel.

Found and fixed one gap while verifying: most of the project's 16
architecture pages/sections were `client_visible = false` (pre-existing data,
not something either worker introduced), so the newly-built Site map tree
had almost nothing to show. Set `client_visible = true` on 8 more pages
(Blog, Contact, Branding, SEO & Marketing, Web Design, Case Study, Cookie
Policy, Terms of Service) and cascaded it to their direct child sections —
matching F003's own "sharing a page offers to share its sections too"
behavior — while deliberately leaving a few pages hidden (Privacy Policy,
"Om oss", two leftover test-slug pages) so the visibility toggle itself
stays testable both ways. Also renamed 2 more leftover junk titles found
only once real content rendered ("Gasdasd" → "Testimonials Carousel").

## Final DB state (verified after the last hosted test run)

`auth.users`=6, `workspaces`=1, `projects`=1, `tasks`=74, orphaned
(`status_id is null`) tasks=0 — matches the confirmed scope exactly. Ran the
delete-all-except-kept sweep twice: once right after the initial reseed, and
again after the F1/F2 workers' and the orchestrator's own hosted test runs
had (expectedly) added their own throwaway fixtures back in.

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
