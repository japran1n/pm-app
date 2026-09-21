# Handoff: F033 — create-from-template-guest-gate

## Status
COMPLETE

## Assertions covered
SB-034: PASS — createProjectFromTemplate now uses canCreateProject; role-matrix test drives the real action: 0 inserts for viewer/guest/client, 1 for owner/admin/member. Menu tests (real Chromium, desktop + 375px Sheet) pass.
SB-006: PASS — guest sidebar/account-menu filtering untouched (no changes to app-sidebar/account-menu); f009 guest tests still pass.

## Files changed
lib/actions/templates.ts
lib/auth/permissions.ts
components/nav/new-menu.tsx
tests/unit/f033-sb034-create-from-template-gate.test.ts
tests/unit/f009-sb033-sb034-new-menu.test.ts
missions/20260921-212654/handoffs/F033-handoff.md

## Commands run
`npx vitest run tests/unit/f033-sb034-create-from-template-gate.test.ts` (0, 9 pass)
`npx vitest run tests/unit/f009-sb033-sb034-new-menu.test.ts tests/unit/f031-sb034-create-project-gate.test.ts` (0, 64 pass)
Fix-removed check: reverted gate to canWrite temporarily -> 3 new tests failed (guest zero-insert, guest message, predicate-agreement); restored (fix in place).
`npx vitest run tests/unit` (1 = pre-existing failures): 46 failed files; diff vs baseline-failing-files.txt shows NO new failing files (f041-final-gate passed this run, i.e. baseline-only).
`npx tsc --noEmit` (0)
`npx eslint <touched files>` (0, no output)

## Decisions made
- Server: replaced canWrite with canCreateProject in createProjectFromTemplate; error message now "You don't have permission to create projects in this workspace." (guest-accurate, not viewer-only).
- Sweep of project-insert paths: (1) lib/actions/projects.ts createProject — already on canCreateProject (F031). (2) createProjectFromTemplate — fixed. (3) RPC create_project_from_template — REVOKEd from public, EXECUTE granted to service_role only (migration 20261128020000), so it is reachable only through the action; a guest cannot call it via PostgREST. (4) lib/seed/full-demo-project.ts (.from("projects").insert) — exempt: operator CLI seed (scripts/seed-full-demo.ts), not imported by app/ or any server action, service-role, no request context. No duplicate-project or import action inserts into projects (grep of app/lib for projects insert/rpc found only these).
- Task-menu decision: createTask's server gate is canWrite (lib/tasks/create.ts), which permits guests (subject to isProjectVisibleToCaller), and the in-project board/list UI also gates task creation on canWrite. So the menu's Task entry now uses canWrite; Project entry uses canCreateProject (+ isGuest deny). Guests now see "+ New" with Task only; viewer/client/null-membership still see no button (SB-034: entries the role cannot create are hidden; button hidden if nothing remains). This changes visible guest behaviour vs F031 (which hid the whole button); existing f009 tests were updated accordingly (guest -> ["Task"]).
- Fixed the misleading comment in new-menu.tsx and the permissions.ts doc comment (now lists all consumers and the exempt seed).
- No MCP used.

## Out-of-scope work needed
- Guest "+ New -> Task" outside a project routes to the Projects page; not verified that guests have a usable Projects list there (not tested live).

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Made guests see Task-only in the + New menu to match the server gate (per orchestrator instruction). If the product owner prefers guests to see no + New button, revert canCreateTaskEntry to canCreateProject and the f009 guest expectations.

## Notes for the next worker
- Not verified: live browser against real Supabase; guest task creation end-to-end via the menu on a real guest project. Verified: real Chromium mounted-component menu matrix (desktop + 375px), server action role matrix with recording DB mock.
- f041-final-gate and other flaky files not re-run in isolation because none newly failed.
