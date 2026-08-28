# Mission 20260828-hardening — Plan

**Goal:** close every finding in `docs/senior-review-findings.md` that is worth closing,
in dependency order, so the codebase survives a senior backend + senior frontend review.

**Baseline commit:** `abe0055`
**Source of truth for findings:** `docs/senior-review-findings.md`

**Scope decision (user, 2026-08-28):** the AI Edit feature is **removed entirely**, not
rate-limited. No AI in this project for now. Finding #4 is closed by deletion (W1).

---

## Milestones

| M | Theme | Features | Gate |
|---|---|---|---|
| M1 | Security — stop the bleeding | W1–W3 | No P0 remains; `tsc` clean |
| M2 | Green CI | W4–W6 | `npm run test` + `eslint` + `build` all pass |
| M3 | Data integrity | W7 | Multi-step writes atomic |
| M4 | Observability | W8 | No silent failures; structured logs |
| M5 | Performance | W9–W10 | Caching, streaming, pagination |
| M6 | Architecture | W11 | Single enforceable authz seam |

Milestones run in order. M1 and M2 are same-day. M6 is the largest and is deliberately
last, because it rewrites call sites that M3/M4 also touch.

---

## M1 — Security

### W1 — Remove the AI Edit feature entirely
**Files:** `app/api/docs/ai-edit/route.ts` (delete), `components/docs/markdown-editor.tsx`,
`.env.example`, `package.json`

- Delete the route directory.
- Strip from `markdown-editor.tsx`: `Sparkles` import, `aiInstruction`/`aiLoading`/`aiError`/`aiOpen`
  state, `handleAiEdit`, the toolbar button, the popover, and every prop that only existed
  to carry them into the toolbar sub-component.
- Remove `ANTHROPIC_API_KEY` from `.env.example`.
- Remove `@anthropic-ai/sdk` from `package.json` (verified: no other consumer) and refresh
  the lockfile.
- Leave the rest of the editor (Tiptap, markdown, toolbar, autosave) untouched.

**Done when:** `grep -ri "anthropic\|ai-edit" app/ components/ lib/ package.json` returns
nothing; editor still loads, edits, and autosaves; `tsc --noEmit` clean.

### W2 — Fix docs / doc_folders RLS
**Finding:** #1, #2, #3. **Files:** new migration.

Current policies gate on `is_active_workspace_member(workspace_id)` alone, which is
role-agnostic and project-blind. Consequences: `client` (external) and `viewer` (read-only)
get full CRUD, and project-private docs leak workspace-wide.

New policy shape for both tables, mirroring what `channels` already does correctly:

- **SELECT:** active member, **and** not `client`, **and** `project_id is null or is_project_visible_to(project_id)`
- **INSERT / UPDATE / DELETE:** the same, plus role not in `('viewer','client')`

Reuse the existing helpers (`is_active_workspace_member`, `is_project_visible_to`) and add
a role-aware helper only if one does not already exist. Do not edit prior migrations — new
file, forward-only.

**Done when:** integration test proves a `client` and a `viewer` cannot select/insert/update/delete
docs, a `member` can, and a doc in a private project is invisible to a non-member of that project.

### W3 — Fix `getWorkspaceChannels` query bugs
**Finding:** #6, #7. **File:** `lib/queries/chat.ts`

1. The unread query filters `.gt("created_at", new Date(0))` — matches every row ever, then
   filters in JS. Fetches the whole message history on every sidebar render and returns wrong
   counts once PostgREST truncates. Replace with a real per-channel `last_read_at` filter
   (an `or(...)` of `and(channel_id.eq.X,created_at.gt.T)` clauses, or a `plpgsql` RPC
   returning counts directly — prefer the RPC).
2. "Latest message per channel" takes `limit(channelIds * 2)` off a **globally** ordered set
   and assumes one row per channel. False: one busy channel starves the rest. Use a
   `distinct on (channel_id)` RPC.

`tests/unit/chat-workspace-channels-unread-count.test.ts` is currently failing — it must pass
without weakening its assertions.

---

## M2 — Green CI

### W4 — Fix the 4 lint errors
`components/docs/markdown-editor.tsx` (unused `Loader2` — may vanish with W1),
`lib/queries/docs.ts:101` (`any`), and 3× "setState synchronously within an effect".
Fix the cascading-render errors properly (derive during render, or `useSyncExternalStore`),
not by disabling the rule.

### W5 — Fix the genuinely failing tests

**Re-triaged 2026-08-28 after W1–W4. The failures split into two unrelated causes, and only
one of them is W5's.**

Current state: 48 failing assertions in 13 files, plus 17 files that run zero assertions.

**Cause A — real test failures (W5 owns these). 48 assertions, 13 files:**

| Failing | File |
|---|---|
| 9 | `unit/chat-send-message-action.test.ts` |
| 8 | `integration/f228-saved-view-actions.test.ts` |
| 5 | `integration/checklist-actions.test.ts` |
| 5 | `integration/f226-swimlane-collapse-persist.test.ts` |
| 4 | `integration/create-workspace-owner.test.ts` |
| 4 | `integration/trash-view.test.ts` |
| 3 | `integration/dependency-ui-actions.test.ts` |
| 3 | `integration/f229-saved-views-ui.test.ts` |
| 2 | `integration/f219-status-management.test.ts` |
| 2 | `integration/f325-status-rename-sync.test.ts` |
| 1 | `unit/app-sidebar-project-nav-list.test.tsx` |
| 1 | `unit/optimistic-pending-audit.test.tsx` |
| 1 | `integration/comment-format-realtime.test.ts` |

**Rule: fix the code, not the test.** Where a test is genuinely wrong, say so explicitly in
the handoff with reasoning.

**Cause B — environmental, NOT broken tests. 17 files. Belongs to W6, not W5.**

These 17 files report "failed" with every assertion `skipped`. Proven by experiment:

- `rls-tasks.test.ts` alone → 9/9 pass
- All 17 run together → 105/105 pass
- All 193 integration files → the same 17 fail

The mechanism is a `beforeAll` hook timeout, not an assertion failure. Each of these files
creates throwaway users via Supabase Auth in `beforeAll`; under full-suite parallelism they
contend for Auth rate limits and the connection pool on the single shared remote project.
When a hook times out, vitest marks the file failed and its tests skipped — so the
assertions never execute and a run can silently not test what it claims to.

**This was already known.** `vitest.config.ts` documents it verbatim under F312 and mitigates
with `hookTimeout: 30_000` and `maxWorkers: 4`. The mitigation is insufficient — 17 files
still fail this way, and it costs wall-clock time (8m 25s for the suite).

W5 must not "fix" these by loosening assertions or adding skips. They are correct tests
starved of a database.

### W6 — CI: add build; give the tests their own database

- Add `npm run build` between lint and test (currently absent — a build break only surfaces
  on Vercel after merge).
- Stop running integration tests against the production database.

**Preferred approach — ephemeral local Supabase in CI, no new project required.**
GitHub Actions `ubuntu-latest` runners have Docker, so CI can `supabase start`, apply all
migrations to a throwaway local stack, and run the suite against it. This removes the
production dependency entirely, removes the Auth-rate-limit contention that causes Cause B
above, and needs nothing from the user.

**Prerequisite VERIFIED by the orchestrator, 2026-08-28 — the route is viable.**

Replayed all 137 migrations against an empty local PostgreSQL 16 database with a minimal
Supabase-compatible scaffold (`auth` schema + `auth.uid()/role()/jwt()`, `storage.buckets`/
`objects`, `cron.schedule` stubs, the four Supabase roles, and a `supabase_realtime`
publication).

**Result: 136/137 applied cleanly.** The one failure is `create extension pg_cron`, which the
scaffold cannot provide and real Supabase does have. Resulting schema: 37 tables, 1 view,
110 functions, 107 RLS policies, 126 indexes.

A first pass with an incomplete scaffold produced 15 failures and appeared to show a genuine
ordering bug — `active_project_tasks` (created as `select t.*`, so its column list is frozen at
creation) seemed to be missing `status_id`, breaking two later migrations. **That was wrong.**
The view is recreated by `20260824060000_status_category_semantics.sql`, which had itself
aborted at line 39 on `grant … to postgres` because the scaffold lacked the `postgres` role.
With the role present, the view is recreated correctly and carries `status_id`. Recorded here
because it is the second time in this mission that an apparent defect turned out to be an
artefact of incomplete verification setup.

Still to create: `supabase/config.toml` (does not exist).

**Fallback** if migrations do not replay cleanly: a separate staging Supabase project. That
one does need the user to create it and hand over credentials.

Note: Docker is not installed on the current dev machine, so local runs would still hit the
remote project until a developer installs it. CI is the priority.

---

## M3 — Data integrity

### W7 — Make multi-step writes atomic
**Finding:** #8. 130 `insert`/`update`/`delete` calls against only 15 RPCs.

Audit `lib/actions/` for every mutation that issues more than one write without a transaction.
Known instance: `setTaskAssigneesCore` (delete-then-insert — a failed insert silently strips
all assignees). Also check status reassignment, checklist reorder, template application,
dependency edits.

Convert each to a `plpgsql` function, following the shape this repo already uses correctly in
`stop_timer_atomic`, `reassign_and_delete_project_status`, and `apply_status_template`.

**Done when:** each converted path has a test that forces the second write to fail and asserts
the first is rolled back.

---

## M4 — Observability

### W8 — Real logging; stop swallowing errors
**Finding:** #9 (partly), #14. 405 `console.*` calls, 120 `non-fatal` swallowed catches, no APM.

- Add Sentry (`@sentry/nextjs`) — server, client, and edge configs.
- Introduce `lib/observability/logger.ts` with structured levels and request/workspace/user
  context; replace `console.error` in `lib/` and `app/` with it.
- Every `non-fatal` catch reports to Sentry instead of vanishing. Keep them non-fatal to the
  user where that is the right UX, but they must be *visible* to operators.
- Convert the serial notification fan-out loops (8 sites) to batched inserts so a 40-watcher
  task is one round-trip, not 40 in the user's request path.

Orchestrator registers the Sentry project and writes the DSN into `.env`; user supplies the
account/credentials only.

---

## M5 — Performance

### W9 — Caching, request dedup, streaming
**Finding:** #11, #12.

- Wrap per-request-stable queries (`getWorkspaceBySlug` and friends — `from("workspaces")`
  appears in 40 route files) in `React.cache()` so a layout and its page share one query.
  Verified still 0 uses of `React.cache()` in the repo.
- `Promise.all` the independent awaits in the worst **pages**: timeline 8, columns-settings 7,
  calendar 7, projects 6, project-settings 6, my-tasks 6, trash 5, templates 5.

  **Already done, do not redo:** commit `3d5a96d` ("perf(ui): parallelise layout fetches…")
  already converted the **layouts** — the workspace layout went from 8 serial awaits to a
  single `Promise.all`, and project layout / notifications / list page were batched too. It
  also added `tasks_project_open_idx`, a composite notifications index, and the
  `get_open_task_counts` RPC. Re-verified 2026-08-28: the page-level counts above are
  unchanged by that commit, so the remaining work is genuinely pages only.
- Add `<Suspense>` boundaries around slow panels so pages stream instead of blocking on the
  slowest query.
- Audit `"use client"` (187 files vs 179 components) and push the boundary down where a
  component does not actually need interactivity. This is a survey + targeted fixes, not a
  full rewrite — report what is realistically convertible.

### W10 — Pagination
**Finding:** #13.

- `lib/queries/tasks.ts` has no `limit`/`range` at all: board and list fetch every task in a
  project. Add cursor pagination + a UI affordance.
- `getChannelMessages` already accepts `{ before, limit }` but no UI calls it — users are
  capped at the last 50 messages with no way to reach history. Wire up load-on-scroll in
  `message-list.tsx`.

---

## M6 — Architecture

### W11 — Single authorization seam
**Finding:** #5, #15. `lib/actions/tasks.ts` is 5,111 lines; the same ~90-line preamble
(Zod → `getUser` → admin client → load row → resolve workspace → `requireActiveMembership`
→ `canWrite` → `isProjectVisibleToCaller`) is duplicated 16× in that file and again across
~40 action files.

Build `withAuthz(...)` — a higher-order function that runs the whole pipeline once and hands
the action a validated, authorized context. Migrate `tasks.ts` first as the proof, then the
rest. Expected: −2,000 LOC and an invariant that is checkable in one place instead of forty.

**Explicitly out of scope for this mission:** migrating every write off the admin client onto
RLS (review finding #5's option (a)). That is a larger decision. W11 delivers option (b) —
one seam that cannot be forgotten — which captures most of the safety benefit at a fraction
of the risk. Revisit after M6 lands.

---

## Deferred (documented, not scheduled)

- **#16** — 2,318 `F###` + 2,833 `AS-###` internal mission-ID references in comments. A
  mechanical strip is risky and reviewer-visible; propose doing it as a single dedicated pass
  once the code beneath stops moving.
- **#17** — 135 migrations, no squashed baseline. Worth a baseline snapshot, but only after
  M1–M3 stop adding migrations.
- **#18** — 6 stale feature branches. Needs a human decision per branch; orchestrator will
  list what is unmerged and let the user choose.

---

## Execution rules

- One worker per W-item, spawned serially within a milestone.
- Workers commit before exiting; handoff goes to `missions/20260828-hardening/handoffs/W<N>-handoff.md`.
- After each milestone: run `tsc --noEmit`, `eslint .`, `npm run test`, `npm run build`.
- The mission does not advance past a milestone whose gate is red.
