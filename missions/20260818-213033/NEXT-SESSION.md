# Next session — start here

_Written 2026-08-22 at the end of this session. Read this file first; run-log.md's bottom
entries give full detail on anything summarized here._

## Where things stand

Since the previous NEXT-SESSION.md (task-detail sidebar redesign + M10 follow-ups queued),
this session completed:

- **Task detail sidebar redesign** (ad-hoc, not a numbered feature): widened `TaskDetailSheet`
  from ~384px to `sm:max-w-2xl`, regrouped status/priority/assignee/due-date into a scannable
  grid above the description. Done and verified.
- **M10 follow-ups**: F132 (project visibility RLS), F273, F274, F277, F278 — all done. F132
  shipped a real regression (INSERT...RETURNING RLS bug) that was found and fixed the same
  session — see run-log.md's 2026-08-21T18:27Z entry for the full diagnosis.
- **M11 (Roles, permissions & project-level access)**: 9/10 done (F126–F129, F131–F135).
  **F130 (ownership transfer) is BLOCKED**, not by choice — it requires an atomic two-write
  Postgres RPC and the worker correctly refused to ship a non-atomic workaround. See "Known
  blocker" below.
- **M12 (Workspace admin, audit log & archive)**: 9/9 done (F136–F144). F144 found a REAL,
  currently-live bug (archived-project time was still leaking into `get_workspace_time_by_person`)
  — the fix is written but blocked on the same infra issue as F130 (see below). Migration:
  `20260822010000_active_project_tasks_view_and_time_report_fix.sql`.
- **M13 follow-up (F159–F168: multi-assignee, watchers, estimates)**: all 10 done and verified
  end-to-end (query-layer wiring included, not just UI — see the F167 gap noted below).

**M10, M11 (minus F130), M12, M13 (including this follow-up block) are now all complete.**

## Known blocker — needs your action

`supabase db push`/`migration list --linked` intermittently fails with
`LegacyPlatformAuthRequiredError: Access token not provided` — no `SUPABASE_ACCESS_TOKEN` in
the environment. It's **intermittent, not permanent** — worked for many workers this session
(F126, F132, F128, F134, F139, F137, F159, F163, F166, and several more), failed for others
(F129, F130, F142, F144). Two consequences sitting live right now:

1. **F130 (ownership transfer) cannot be implemented** until this is reliably fixed — it's a
   correctness-critical atomic two-write operation, not safe to work around.
2. **A real bug is live in production**: `get_workspace_time_by_person` still counts archived
   projects' logged time. Fix is written (F144's migration, see above) but unapplied.

To fix: either (a) get a Supabase personal access token (dashboard → Account → Access Tokens)
and add it to `.env` as `SUPABASE_ACCESS_TOKEN`, or (b) approve the Supabase MCP server
(currently "Pending approval" per `mcp-registry.md`). Once either is in place, apply every
migration file flagged as unapplied across F130/F142/F144's handoffs in one pass.

## A recurring gap worth watching for

Twice this session (F167 initially, and F135's `canDeleteTask` gap before it) a feature shipped
UI that rendered correctly in isolation but wasn't actually wired to real data because the
underlying page query never selected the new column/table. F165 explicitly avoided repeating
this by wiring `getTaskDetail` end-to-end from the start. **When briefing a worker on any
feature that adds a new column/table + a component to display it, explicitly require proof of
the round-trip from DB through the real page-level query**, not just a component-level render
test.

## Next work (in order, per the mission plan)

1. **M14 — Rich text, recurrence, templates, bulk actions & trash** (F169–F193, 25 features):
   Tiptap editor for descriptions/comments, recurring tasks, task templates, bulk
   select/update/delete, trash + restore + undo + purge.
2. **M15 — Collaboration** (F194–F212, ~19 features; F213–F217 email features already
   `[SKIPPED]` — Resend not connected, user's own 2026-08-18 decision): activity feed, comment
   edit/reactions, @mentions, notifications.
3. **M16 — Views** (F218–F240, 23 features): custom statuses, board swimlanes, saved views,
   My Tasks, calendar, timeline.
4. **M17 — UX polish, attachments & navigation** (F241–F267, 27 features): command palette,
   shortcuts, deep links, quick-add, empty states, onboarding, attachments dropzone/lightbox,
   sidebar favorites, mobile layout.
5. **M18 — Final QA** (F268–F272, 5 features): a11y/contrast pass, typecheck/lint clean, docs,
   e2e suite.

Read each feature's spec/clarification file under `missions/20260818-213033/features/` and
`clarifications/` before delegating, exactly as done throughout this session.

## Standing process rules (unchanged, still enforced every feature)

- Orchestrator never writes project code directly — always spawn a worker (in-process subagent,
  told to read `.claude/agents/worker.md` first).
- After every worker: verify independently before marking anything done — check `git status`,
  read the actual diff, run the relevant test suite, and only then log to run-log.md and commit.
  Do not trust a worker's "tests pass" / "tsc clean" claim without rerunning it yourself — this
  session caught at least two false claims this way (F135's tsc error, F138/F142's misdiagnosed
  "pre-existing" test failure that was actually a real regression from F140).
- Workers occasionally get interrupted mid-task by transient API errors (not real failures) —
  resume them with an explicit "read current state first, don't assume" instruction rather than
  restarting from scratch; check `git status` to see what's already there.
- When running 2+ workers in parallel that touch the same file, that's usually fine — they
  interleave correctly as long as each reads current state before editing. Verify the combined
  result carefully afterward (tsc, full relevant test regression) rather than assuming isolation.
- Full-suite runs frequently show Supabase Auth rate-limit flakiness (`Request rate limit
  reached`) under concurrent test-user sign-ins — always re-run the SPECIFIC failing file(s) in
  isolation before concluding a regression; if they pass alone, it's flakiness, not a bug. But
  don't reflexively assume every failure is this — investigate root cause first (see the F140
  regression note above).
- Handoff files are sometimes left untracked by workers (their own commit doesn't `git add`
  them) — check `git status` after every worker and commit the handoff separately if needed.
- Dev login for manual testing: `http://localhost:3000/dev-login?email=sasa@goodguys.se` (only
  works when a dev server is actually running — start one via the browser-preview tool).
