# Next session — start here

_Written 2026-08-22, end of session. Read this file first; run-log.md's bottom entries give
full detail on anything summarized here._

## Where things stand

**M10, M11 (10/10), M12, M13 (+ follow-up), and M14 (all 25 features, F169–F193) are ALL
fully complete and independently verified.**

**M15 (Collaboration) is in progress:**
- F194–F196 (activity feed chain) — **complete.**
- F197–F198 (comment-edit chain) — **complete.**
- F199–F200 (reactions chain, part 1) — **complete** (`comment_reactions` table, `toggleReaction`
  action). F200's worker stalled mid-session before committing; the orchestrator verified its
  already-correct work directly and committed it rather than re-running the feature — see
  run-log.md's 2026-08-22T23:13Z entry.
- **F201 (reaction UI) is next**, then F202 (live reactions via realtime), which closes the
  reactions chain and this mission-2 mini-arc.
- Still to come in M15 after that: F203–F205 (@mentions), F206–F212 (notifications:
  db-schema, fan-out, bell panel, realtime, deleted-target handling, preferences, overdue job).
  F213–F217 (email) are `[SKIPPED]` — Resend not connected, user's own 2026-08-18 decision, do
  not attempt.

## Known infra state

`SUPABASE_ACCESS_TOKEN` is set in `.env` and has worked reliably for the CLI (`supabase db
push`, `migration list --linked`, `gen types typescript`) for essentially every worker across
M14 and M15 so far. Supabase MCP is still "Pending approval" (needs the user's own interactive
OAuth step) — not urgent, the CLI path works fine.

## Recurring patterns worth knowing before continuing

1. **"Built but not wired to real data" gap.** Multiple features this session (F167, F135's
   `canDeleteTask`, F179's card indicator) shipped UI/logic that worked in isolation but wasn't
   actually fed by the real page-level query. F165, F189, and F196 all explicitly avoided this
   by wiring their queries end-to-end from the start — hold every future feature to that
   standard. When a worker's own handoff flags this kind of gap, close it immediately with a
   scoped follow-up (this session did that successfully every time, e.g. F167's and F179's
   follow-up fixes).
2. **Workers stall or hit transient API errors mid-task fairly often** (roughly 1 in 4-5 this
   session). This is NOT a real failure — resume with an explicit "read current state first,
   don't assume" instruction, or (as with F200) if the work left behind is already complete and
   verifiable, the orchestrator can verify and commit it directly rather than re-running the
   whole feature.
3. **Migrations that change an RPC's OUT-parameter shape need `drop function` + `create
   function`, not `create or replace`** — Postgres refuses the latter. Recurred across
   F161/F167/F168/F179's follow-up fixes.
4. **Full-suite test runs show two classes of pre-existing, non-regression flakiness**:
   Supabase Auth `Request rate limit reached` under concurrent test-user sign-ins, and
   occasional `JWT issued at future` clock-skew errors. Always re-run the SPECIFIC failing
   file(s) alone before concluding a regression — but don't reflexively assume every failure is
   this either; this session found and fixed several real regressions this way too (F140's
   stale test mock, F171's XSS-audit false positive).
5. **Handoff files are sometimes left untracked by workers** (their own commit doesn't `git add`
   them) — check `git status` after every worker and commit the handoff separately if needed.
6. **Trust but verify, always** — this session repeatedly caught workers' incorrect "pre-existing,
   unrelated" dismissals of real regressions (F138/F142 on F140's mock breakage), false "tsc
   clean" claims (F135), and unverified claims about query wiring. Never mark a feature done
   without independently running tsc/eslint/tests yourself and reading the actual diff for
   anything security- or correctness-sensitive.

## Next work (in order, per the mission plan)

1. **F201 (reaction UI)** — reaction chips under comments (emoji + count, caller's own reaction
   marked, accessible reactor-names tooltip/popover, keyboard-operable emoji picker limited to
   `REACTION_EMOJI_ALLOWLIST` from `lib/validation/comment-reactions.ts`).
2. **F202 (live reactions)** — realtime delivery of reactions to other viewers, mirroring
   `comment_edited`'s broadcast pattern from F197 (recall: `postgres_changes` may be
   INSERT-only on this channel per F104's earlier fix — check whether a Broadcast event is
   needed here too, the same way F191 needed one for comment restore).
3. **F203–F205 (@mentions)**, **F206–F212 (notifications)** — rest of M15.
4. **M16 — Views** (F218–F240, 23 features): custom statuses, swimlanes, saved views, My Tasks,
   calendar, timeline. Note: F218 is a dependency several M14 features (F184's
   project-from-template) explicitly deferred against — once F218 lands, revisit those
   features' "Out-of-scope" notes for what needs extending.
5. **M17 — UX polish, attachments & navigation** (F241–F267, 27 features).
6. **M18 — Final QA** (F268–F272, 5 features).

Read each feature's spec/clarification file under `missions/20260818-213033/features/` and
`clarifications/` before delegating, exactly as done throughout this session.

## Standing process rules (unchanged, still enforced every feature)

- Orchestrator never writes project code directly — always spawn a worker (in-process subagent,
  told to read `.claude/agents/worker.md` first). The one exception this session (F200) was
  committing a stalled worker's already-complete, independently-verified work rather than
  discarding it — not writing new code, just finishing the paperwork on work already done.
- After every worker: verify independently before marking anything done — check `git status`,
  read the actual diff, run the relevant test suite, and only then log to run-log.md and commit.
- Dev login for manual testing: `http://localhost:3000/dev-login?email=sasa@goodguys.se` (only
  works when a dev server is actually running — start one via the browser-preview tool).
