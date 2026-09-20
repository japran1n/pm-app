# M4 — UX validation report (run 1)

Mission: 20260920-124226 · Date: 2026-09-20 · Verdict: **PASS**

App booted with `npm run dev` (Next.js 16.3.5, http://localhost:3000, ready in
267ms). Auth via the repo's existing E2E technique (admin `generateLink`
magic link → session cookie injection), driver script
`/private/tmp/claude-501/-Users-sasajapranin-Desktop-pm-app/f211a173-a7ca-4c35-bbb5-510ee9292f2b/scratchpad/m4.mjs`
(scratchpad, not committed; no project code was modified).

Seed used as the adversarial fixture: a workspace + project + **three tasks
with `due_date` on Mon/Tue/Wed of the displayed week, all assigned to the
signed-in user** (`task_assignees` rows). Under the pre-M4 Planner these are
exactly the rows that produced all-day task strips. All seed data was deleted
after the run.

## Results

| ID | Verdict | Evidence | Reproduction |
|----|---------|----------|--------------|
| AS-033 | PASS | `missions/20260920-124226/milestones/evidence/M4/calendar.png`, `calendar.txt` | Sign in, seed 3 tasks due in the current week assigned to self, open `/w/<slug>/calendar`. Week header row goes straight from the day-name row (`14 Mon … 20 Sun`) to the 07:00 time grid — no all-day strip band, no chips. Page innerText contains 0 occurrences of the seeded task titles. |
| AS-034 | PASS (with SSR caveat, see below) | `evidence/M4/calendar.txt` (full request log) | Same navigation with request interception. Every request is the document GET, static chunks/fonts, `/api/csp-report`, and one server-action POST to the same route. **Zero task-shaped requests** (`/task/i` filter over all URLs returned `[]`). |
| AS-035 | PASS | `evidence/M4/calendar.png` | Only controls on the Planner are `Add time off`, `←`, `Today`, `→`. No status/priority/assignee/project filter controls anywhere on the page. |
| AS-036 | PASS | `evidence/M4/calendar-stale-params.png`, `calendar-stale-params.txt` | Navigate to `/w/<slug>/calendar?status=open&priority=high&assigneeId=<uid>&projectId=<pid>`. HTTP 200, no error boundary, no "something went wrong" text, zero console errors (`evidence/M4/console-errors.txt` is empty). Render is pixel-equivalent to the unparameterised week view. |
| AS-080 | PASS (behavioural proxy) | `evidence/M4/my-tasks.png`, `my-tasks.txt` | Navigate to `/w/<slug>/my-tasks`. HTTP 200; page renders "My Tasks", the Personal to-dos card, and all 3 seeded assigned tasks. Confirms task functionality outside the Planner is intact. |

## Notes on scope of each verdict

- **AS-034 caveat.** The Planner is a server component, so a DB query it made
  would not appear in the browser network tab. What is directly observable is
  (a) no client-side task request, and (b) no task data reaching the DOM
  despite fixtures designed to surface. The server-side half of this assertion
  is a code-level invariant and is covered by scrutiny (GREEN) plus the unit
  test `tests/unit/f016-calendar-page-no-task-query.test.ts`.
- **AS-080 wording mismatch.** The validation contract's AS-080 reads "Tests
  covering task behaviour inside the Planner are deleted rather than skipped or
  commented out" — that is a repository invariant, not observable from the UI,
  and properly belongs to scrutiny. The task brief restated AS-080 as "My Tasks
  route still works", which is what was actually exercised above. Supporting
  check on the contract's literal wording: `grep` for `.skip(`/`.todo(` across
  `tests/unit/*calendar*` returned no matches, and no Planner task spec remains
  in `tests/e2e`.
- An onboarding overlay ("Welcome to pm-app") appears on first visit to a fresh
  workspace; the driver dismisses it via **Skip** before screenshotting. It is
  unrelated to M4.

## FAILs

None.

## Suggested fixes

None. No code change is warranted by this run.

## Teardown

Dev server stopped; seeded workspace, project, tasks, assignees and auth user
deleted by the script's cleanup step.
