# Next session — start here

_Written 2026-08-19 at the end of the previous session. Read this file first, then `run-log.md` (bottom up), then `plan.md`._

## Where things stand

Mission `20260818-213033` (v2) is in the RUN phase. Plan APPROVED, connections VERIFIED
(Resend deliberately skipped — no API key; F213–F217 are `[SKIPPED]`).

- **M10 complete** (F118–F125) but **not GREEN**: its scrutiny report found 7 FAILs.
  Fixed so far: F275 (due-date display timezone), F276 (profiles RLS hole).
  **Still open: F273, F274, F277, F278.**
- **Improvement-list items done end to end:** 8 (task keys), 1 (subtasks + checklists), 2 (dependencies).
- **One red test:** `tests/integration/perf-budget.test.ts` — AS-156, p95 ≈ 520ms against a 500ms
  budget. Caused by F150 + F154 + F157 each adding a whole-project query to
  `getProjectBoardTasks`. **F279 exists to fix it. Do this first.**
- **M19 planned but not started:** the QA feedback Chrome extension (F280–F300, AS-531–AS-572).

## Do them in this order

1. **F279** — board query perf regression. One feature. Do not raise `PERF_BUDGET_MS`;
   consolidate the round trips into one RPC, or report PARTIAL with measurements.
2. **M19** — the QA feedback browser extension, F280 → F300 in order. The user called this
   "jako bitno". Research and decisions are already in `tech-decisions.md` §
   "QA feedback extension" — do not re-litigate them.
3. **The rest of improvement-list section 1** — items 3, 4, 5, 6, 7, 9, 10:
   F159–F168 (multi-assignee, watchers, estimates), then F169–F193 (rich text, recurrence,
   templates, bulk actions, trash/undo).
4. **The four open M10 follow-ups** (F273, F274, F277, F278) before declaring M10 green.

## Standing process rules learned the hard way in the last session

- **Workers must NOT run the full vitest suite.** They run their own tests plus
  `npx tsc --noEmit` and `npx eslint .`, then commit. The orchestrator runs the full suite
  between features. Four workers stalled by backgrounding the suite and waiting for a
  notification that only ever reaches the orchestrator.
- **Workers must not background anything and wait.** Everything in the foreground.
- **After every worker, verify independently** before marking a feature complete: HEAD moved,
  working tree clean, handoff exists with all sections, and read the actual diff for the
  assertion that matters. Six workers stopped mid-feature (API errors, stalls) while reporting
  progress; the check is what caught them.
- **Run the suite serially:** `npx vitest run --testTimeout=30000 --no-file-parallelism`.
  Parallel runs against the remote Supabase project hit Auth rate limits — and worse, the
  parallel run silently SKIPS ~63 tests the serial run executes.
- **Capture failing output before re-running.** One failure was lost that way and took an extra
  cycle to identify.
- **F132 debt:** M13/M14 tables scope RLS through the mission-1 `tasks → projects →
  workspace_members` pattern because F132 (project-level visibility) does not exist yet. Each
  handoff lists the policies it created; F132's spec has an added scope section listing this.
- **Worker mechanism:** in-process subagents, each told to read `.claude/agents/worker.md`
  first. Spawning `claude --agent worker` from Bash fails with an expired OAuth session.
  Because of that, the `pre-worker-exit` hook does not fire — hence the manual verification.
- **Preview:** `.claude/launch.json` in the session's working directory drives it. If the session
  runs from a different folder, add a `pm-app` configuration there (the previous session's
  folder had a stale entry pointing at a deleted `decel` project).
- **Dev login for manual testing:** `http://localhost:3000/dev-login?email=sasa@goodguys.se`
  (development only; returns 404 otherwise).

## Things deliberately left open

- Resend / email notifications (user deferred) — F213–F217 `[SKIPPED]`, AS-393–AS-402 open.
- Rate limiting on the extension's task endpoint (F292) — out of this mission's scope by the
  user's own cut; the exposure is noted, not silently fixed.
- Avatar MIME sniffing (F274) — flagged in M10 scrutiny, still open.
