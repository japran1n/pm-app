# Next session — start here

_Written 2026-08-22, mid-session. Read this file first; run-log.md's bottom entries give full
detail on anything summarized here._

## Where things stand

Since the last checkpoint, this session completed:

- **F130 (ownership transfer) UNBLOCKED and done.** The user supplied a Supabase personal
  access token, added to `.env` as `SUPABASE_ACCESS_TOKEN` (working). F130's atomic
  `transfer_workspace_ownership` RPC shipped and verified with a genuine rollback-proof
  atomicity test. **M11 is now 10/10 fully complete.**
- Also unblocked as a side effect: F142's `archived_by` column and F144's real live-bug fix
  (`get_workspace_time_by_person` archived-project time leak) were BOTH found to have already
  been applied live (a later worker's `db push` during F159-F168 applied every queued pending
  migration, not just its own) — verified directly, the bug is genuinely fixed now.
- **M14 — Rich text, recurrence, templates, bulk actions & trash (F169–F193, 25 features) is
  now FULLY COMPLETE.** Five sub-chains, all done and independently verified:
  - F169-F174: Tiptap editor, description/comment rich-text storage, sanitised rendering (real
    XSS test coverage including an obfuscated `javascript:` bypass), paste degradation, inline
    checkbox lists.
  - F175-F179: recurrence storage, next-occurrence date maths (real month-end/DST test
    coverage), generate-on-completion (genuine DB-level idempotency via a unique constraint,
    with an empirically-found-and-fixed Postgres `ON CONFLICT`/partial-index bug), pg_cron
    scheduled generation (SQL/TypeScript date-math parity proven), recurrence UI.
  - F181-F184: task_templates table, create/apply/rename/delete actions, templates UI (real
    Playwright e2e proof), create-project-from-template (atomic RPC, correctly deferred the
    not-yet-built F218 columns concept rather than faking it).
  - F185-F187: list-view multi-select, bulk field updates (correct mixed-permission semantics:
    forbidden tasks excluded, not whole-batch-failing), bulk delete (failures reported by task
    key, not raw uuid — verified in the actual UI test).
  - F188-F193: trash view, task restore (AS-351 held by construction — never touches
    `projects.deleted_at` at all), comment restore (correct Realtime Broadcast workaround for
    F104's INSERT-only `postgres_changes` gotcha), undo toast, permanent purge (DB-level
    "never purge a live row" boundary, real Storage-object cleanup verified via `.list()`),
    and a final trash-exclusion sweep (F193, following F144's precedent — found no real gap
    this time, verified the "why" directly rather than trusting the claim).
  - Two "built but not wired to real data" follow-up gaps were found and closed immediately
    within this session (F179's card indicator, matching F167's earlier pattern) — see the
    recurring-gap note below, still worth watching for.
  - One real regression was caught mid-chain and fixed: `tests/unit/xss-sanitization-audit.test.ts`
    had a false positive from F171's own doc comment containing the literal audit-trigger
    string — fixed by rewording, not weakening the audit test's strict matching.

**M10, M11 (all 10/10), M12, M13 (+follow-up), and now M14 are ALL fully complete.**

## Known blocker — RESOLVED

The Supabase CLI push connectivity issue from earlier in this session is resolved —
`SUPABASE_ACCESS_TOKEN` is set in `.env` and has worked reliably for essentially every worker
since. Supabase MCP is still "Pending approval" (requires the user's own interactive OAuth
approval step, not something achievable headlessly) — not urgent now that the CLI token works,
but still open if the user wants to resolve it later.

## A recurring gap worth watching for (still relevant)

Multiple times this session (F167, F135's `canDeleteTask`, F179's card indicator) a feature
shipped UI that rendered correctly in isolation but wasn't actually wired to real data because
the underlying page query never selected the new column/table. F165 and F189 both explicitly
avoided repeating this by wiring their queries end-to-end from the start — that's the standard
to hold every future feature to. **When briefing a worker on any feature that adds a new
column/table + a component to display it, explicitly require proof of the round-trip from DB
through the real page-level query**, not just a component-level render test. When a worker's
own handoff flags this gap, close it immediately with a scoped follow-up rather than letting it
linger — this session did that successfully every time it came up.

## Next work (in order, per the mission plan)

1. **M15 — Collaboration** (F194–F212, ~19 features; F213–F217 email features already
   `[SKIPPED]` — Resend not connected, user's own 2026-08-18 decision, do not attempt): activity
   feed, comment edit, comment reactions (with realtime), @mentions, notifications (bell panel,
   realtime, preferences, overdue job).
2. **M16 — Views** (F218–F240, 23 features): custom statuses, board swimlanes, saved views,
   My Tasks page, calendar, timeline/Gantt. Note: F218 (custom statuses/columns) is a dependency
   several M14 features (F184's project-from-template) explicitly deferred against — once F218
   lands, go back and check those features' own "Out-of-scope" notes for what needs extending.
3. **M17 — UX polish, attachments & navigation** (F241–F267, 27 features): command palette,
   shortcuts, deep links, quick-add, empty states, onboarding, attachments dropzone/lightbox,
   sidebar favorites, mobile layout.
4. **M18 — Final QA** (F268–F272, 5 features): a11y/contrast pass, typecheck/lint clean, docs,
   e2e suite.

Read each feature's spec/clarification file under `missions/20260818-213033/features/` and
`clarifications/` before delegating, exactly as done throughout this session.

## Standing process rules (unchanged, still enforced every feature)

- Orchestrator never writes project code directly — always spawn a worker (in-process subagent,
  told to read `.claude/agents/worker.md` first).
- After every worker: verify independently before marking anything done — check `git status`,
  read the actual diff, run the relevant test suite, and only then log to run-log.md and commit.
  Do not trust a worker's "tests pass" / "tsc clean" claim without rerunning it yourself — this
  session caught several false/incomplete claims this way (F135's tsc error, F138/F142's
  misdiagnosed "pre-existing" test failure that was actually a real F140 regression, F171's
  XSS-audit false positive that two later workers noticed but didn't fix).
- Workers occasionally get interrupted mid-task by transient API errors or stalls (not real
  failures) — resume them with an explicit "read current state first, don't assume" instruction
  rather than restarting from scratch; check `git status` to see what's already there. This
  happened routinely throughout M14 and every resume worked cleanly.
- When running 2+ workers in parallel that touch the same file, that's usually fine — they
  interleave correctly as long as each reads current state before editing, including cases
  where one worker's edit to a shared file ends up landing inside another's commit due to
  timing (always disclosed honestly in handoffs when it happens — verify by diffing the actual
  commits, not just trusting the account). Verify the combined result carefully afterward (tsc,
  full relevant test regression) rather than assuming isolation.
- Full-suite runs frequently show Supabase Auth rate-limit flakiness (`Request rate limit
  reached`) AND occasional `JWT issued at future` clock-skew errors under concurrent test load —
  always re-run the SPECIFIC failing file(s) in isolation before concluding a regression; if
  they pass alone, it's flakiness, not a bug. But don't reflexively assume every failure is
  this — investigate root cause first.
- Handoff files are sometimes left untracked by workers (their own commit doesn't `git add`
  them) — check `git status` after every worker and commit the handoff separately if needed.
- Migrations needing a Postgres OUT-parameter shape change (adding a column to an RPC's return
  table) need `drop function` + `create function`, not `create or replace` — this pattern
  recurred across F161/F167/F168/F179's follow-up fixes this session.
- Dev login for manual testing: `http://localhost:3000/dev-login?email=sasa@goodguys.se` (only
  works when a dev server is actually running — start one via the browser-preview tool).
