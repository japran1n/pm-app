# Mission State — AI Docs Assistant

Phase: RUN
Unblocked 2026-09-09: 20260909-linear-ds COMPLETE (13/13). Branch: feat/ai-docs-sidebar
Autonomy: FULL. User asleep and unavailable. ZERO_QUESTIONS until further notice.

## Gate before RUN may begin
- [x] 20260909-linear-ds reports all 13 features complete
- [x] Working tree clean (no uncommitted design work)
- [x] Design rules from its F013 read by the orchestrator and quoted into worker prompts

## Feature progress
- [ ] F001 — SDK install + client + Zod-compat spike
- [ ] F002 — Tool result envelope + shared schemas
- [ ] F003 — Tool: get_current_doc
- [ ] F004 — Tool: search_docs
- [ ] F005 — Tool: list_doc_templates
- [ ] F006 — Tool registry + system prompt builder
- [ ] F007 — Route handler with streaming + tool loop
- [ ] F008 — Client stream parser hook
- [ ] F009 — Sidebar shell
- [ ] F010 — Message thread rendering
- [ ] F011 — Tool call card
- [ ] F012 — Composer
- [ ] F013 — Empty state + suggestions
- [ ] F014 — Tool: propose_doc_edit
- [ ] F015 — Proposal card + diff rendering
- [ ] F016 — Apply accepted edit
- [ ] F017 — Tool: create_doc + Save
- [ ] F018 — Migration: ai_threads + ai_messages
- [ ] F019 — Thread persistence
- [ ] F020 — Guards: rate limit, cost ceiling, error states
- [ ] F021 — Tests: tools + route
- [ ] F022 — E2E + full gate sweep

## Known risks
- R-1 `betaZodTool` + Zod 4 compatibility unverified. Resolved in F001; fallback documented.
- R-2 `ANTHROPIC_API_KEY` absent. Build and unit tests unaffected; live e2e (AS-103/104
  against a real model) cannot pass until the user supplies it. Everything else can.
- R-3 Same working tree as the design mission. Never run concurrently.
- R-4 **The test suite runs against a live remote Supabase project**, not mocks
  (`vitest.config.ts`: testTimeout 30s and maxWorkers 4 exist specifically to absorb
  real Auth rate limits and connection-pool contention; the F278 comment records
  "575/575 green" only when the remote project is reachable and unthrottled).
  Consequence: a `npm test` failure in this environment is ambiguous — it may be
  environmental rather than a regression. F003's worker hit this and substituted
  `npx vitest run lib/` as a scoped deterministic gate. That substitution is ACCEPTED
  for per-feature gating, but AS-102 ("npm test passes") must NOT be marked PASS at
  F022 on the strength of a scoped run. The orchestrator is establishing the true
  baseline; whatever it turns out to be is recorded below and F022 compares against it.

## MEASURED TEST BASELINE (orchestrator, 2026-09-09) — this is the number F022 compares against

`npx vitest run lib/ tests/unit/` at commit `c69f4d35`:
```
Test Files  3 failed | 318 passed (321)
     Tests  4 failed | 2222 passed (2226)
```

The 4 failures are:
1. `tests/unit/app-sidebar-project-nav-list.test.tsx` — AS-509 (projects passed into sidebar)
2. `tests/unit/app-sidebar-project-nav-list.test.tsx` — AS-513 (empty project list still renders create action)
3. `tests/unit/f038-as024-coverage.test.ts` — AS-024 (CommandPalette tombstone map cleared)
4. `tests/unit/sign-out-back-navigation.test.ts` — AS-022 (workspace layout exports `dynamic = "force-dynamic"`)

**These are PRE-EXISTING and belong to mission `20260909-linear-ds`, not to this one.**
Proven, not assumed: the orchestrator created a detached worktree at `262bc20b` — the
design mission's final commit, before any AI-docs code existed — and ran those three
files there. All four failed identically. All three files sit in exactly the areas that
mission reskinned (F011 navigation/sidebar, F003 panel structure, command palette).

### Rules this imposes
- Do **not** fix these in this mission. They are another mission's regressions, that
  session is still live, and silently repairing them would hide the fact that a mission
  reported 13/13 COMPLETE with a red baseline.
- This mission's gate is **"no NEW failures beyond these 4"** — not "green".
- F022 must re-run the same command, compare against these exact 4, and report any
  difference. If the design session fixes them in the meantime, the target becomes green
  and F022 should say so.
