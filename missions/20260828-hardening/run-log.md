- F003 COMPLETE — two-channel split, shared trackedTaskIds, AS-007..AS-011 tested.
- F006 COMPLETE — migration 20260905120000 applied live; client_requests published (AS-017 PASS).
- F002 COMPLETE (7118768) — realtime:check verifier, source-derived discovery, real run: 8/8 tables published.
- F004 spawned (F003 regression net); F008/F009 spawned (portal realtime).
- F004 COMPLETE — topology tests (per-channel binding counts, both release paths); 60/60 My Tasks tests pass.
- F010 COMPLETE (258e9b9) — pendingMovesRef as a per-id in-flight COUNTER released via .finally() on all five call sites.

### Orchestrator assessment of F004's audit finding (no new feature opened)

F004 flagged three further single-channel/multi-binding sites:
`lib/tasks/subscribe-comments-realtime.ts`, `lib/chat/subscribe-messages-realtime.ts`,
`lib/chat/subscribe-message-reactions-realtime.ts`.

Verified by the orchestrator: in all three, every binding on a given channel
targets the SAME table (`comments`, `comment_reactions`, `messages`,
`message_reactions` respectively). The failure mode F003 fixed requires two
DIFFERENT tables on one channel, where one table being unpublished silently
kills the other's binding. Multiple event-bindings on one already-published
table share the table's fate by definition — there is no cross-contamination
to prevent. All four tables are confirmed members of `supabase_realtime`.

Finding is real but not a defect. No follow-up feature opened. Recorded so a
later audit does not re-raise it.

### Note for scrutiny

F010's tests are regex-based assertions over board.tsx source rather than
behavioural. Flag to the scrutiny validator: confirm a mutant that never
releases the guard actually fails, rather than merely that the source text
contains `.finally(`.
- F008 COMPLETE — portal-overview-live.tsx client component + subscribe/use hooks, reconciled via F007. AS-024 teardown test mutation-verified.
- F011 PARTIAL — spec written, worker could not execute it.

### Orchestrator ran F011's spec rather than accepting PARTIAL

Playwright browsers are installed and playwright.config.ts boots its own dev
server (port 3100) against the live linked project, so "cannot execute" was
not accurate. Real run:

    TimeoutError: page.waitForURL: Timeout 15000ms exceeded
      at loginAsClient (tests/e2e/portal-approve.spec.ts:223)

Fixture seeding works; the magic-link client-login helper is what fails. The
spec inherited that helper from tests/e2e/notifications.spec.ts. Opened F012
to diagnose and fix against the live project, explicitly forbidden from
weakening the AS-029 no-reload assertion to get a green.
- F009 COMPLETE (92bb3cf) — portal task-list + request-list live, AS-021..AS-024 tested.

## Orchestrator gate run (all 11 features landed)

- `npx tsc --noEmit` → exit 0 (AS-031 PASS)
- `npm run lint` → 0 errors, 15 warnings (baseline 13; both new ones are
  `no-unused-vars` on underscore-prefixed mock params in new test files).
  AS-032 PASS (assertion is "no new errors").
- Unit/component suite → 1571 passed / 1 failed, 204 files passed / 3 failed.

Failures triaged:
1. `tests/unit/personal-todo-list-realtime-wiring.test.tsx` — REAL regression
   from F003's channel split; the test still asserts the old single topic.
   → F013 opened.
2. + 3. Two Playwright specs under `missions/20260830-223927/milestones/`
   collected by vitest ("Playwright Test did not expect test.beforeAll()").
   Pre-existing collection noise, not a regression. Folded into F013.

## Open at this point

- F012 — repair the portal E2E client login so AS-029/AS-030 actually execute.
- F013 — the two items above.
- F013 COMPLETE (450754c) — wiring test updated to two-channel topology; `missions/**` excluded from vitest. Suite green: 205 files / 1572 tests.

## Scrutiny round 1 — REJECT (3 blockers, 8 majors, 23/34 PASS)

Report: milestones/scrutiny-1.md. The validator confirmed two of the
orchestrator's suspicions and found two things nobody had flagged.

Confirmed correct (no action): AS-020 (single predicate gate, DELETE keyed on
id only — right for default replica identity); F010's guard IMPLEMENTATION,
including the cross-lane multi-call counting.

Blockers:
- AS-015 — the double-click test passes with the ref deleted AND with no guard
  at all. RTL flushes optimistic state between fireEvent calls, the button
  detaches, the second click never reaches a handler. AS-016 vacuous the same
  way. → F014
- AS-028 — zero coverage of any kind. F010's tests are regex over board.tsx
  source; two behavioural mutants survive, one of which is the early-release
  bug the feature exists to prevent. → F017
- AS-032 — `console.log("F012_DEBUG event", ...)` shipped in
  portal-overview-live.tsx:118. Sole new lint error, and it logs portal task
  titles/ids to every client console. → F015

Majors:
- AS-003 — raw child stderr interpolated into output, full process.env passed
  to the child, no redaction. → F018
- AS-006 — a hardcoded-array mutant in discoverSubscribedTables leaves every
  test green. → F018
- AS-011 — `new Set(...)` copy at use-my-tasks-realtime.ts:283 survives every
  test. → F019
- AS-024 — deps `[workspaceId]` → `[]` survives; no test changes props
  mid-life. → F015
- AS-021 — REAL DEFECT, not a test gap: task-list.tsx:138 pins
  `category: existing?.category ?? "not_started"`, so a task moved to Done
  keeps a stale category and renders under the wrong heading with wrong
  ordering and overdue styling until reload. → F016

Fix wave spawned: F014, F015, F016, F017, F018, F019. Every one is required to
mutation-verify its tests and record before/after results in its handoff.

## Fix wave results (all mutation-verified as required)

- F014 COMPLETE (d7c0df5) — AS-015/AS-016 now dispatch both clicks via raw DOM
  `.click()` inside one `act()`, so both handler invocations batch before the
  optimistic branch unmounts the button. Verified: guard removed → FAILS;
  restored → PASSES. Blocker cleared.
- F019 COMPLETE — hook-level test kills the `new Set(...)` copy mutant at
  use-my-tasks-realtime.ts:283. Implementation was already correct; no
  production change needed. Major cleared.
- F016 COMPLETE (fc06143) — AS-021 real defect fixed: category now resolved
  through a `project_statuses`-derived lookup threaded from getPortalProjects,
  not pinned to the stale seeded value. Major cleared.
- F018 COMPLETE (8686e8f) — `redactSecrets` + narrowed `buildChildEnv` in both
  scripts; real-tree `discoverSubscribedTables()` test kills the hardcoded-array
  mutant. Both live script runs pass. Two majors cleared.
- F017 COMPLETE (dfcaa4d) — guard bookkeeping extracted to
  `lib/board/pending-moves.ts`; regex tests replaced with behavioural ones
  covering AS-025..AS-028 (AS-028 previously had zero coverage). Both surviving
  mutants now fail. Blocker cleared.
- F015 COMPLETE (75eab15) — the `F012_DEBUG` console.log turned out to be
  uncommitted working-tree drift, never in HEAD (orchestrator confirmed with
  `git grep` against HEAD: no match). AS-024 props-change test added and
  mutation-verified against `[]` deps. Blocker cleared, though it was narrower
  than scrutiny reported.

All 3 blockers and all 8 majors from scrutiny round 1 are closed.

Still open: F012 (portal E2E login). It is mid-work and has uncommitted changes
to lib/actions/portal-approval.ts plus a new migration
20260905130000_approve_portal_task_atomic.sql — i.e. it found real defects while
making the E2E path actually execute, which is exactly why the orchestrator
refused to accept F011's PARTIAL.
- F012 COMPLETE (bfccd23) — and it justified refusing F011's PARTIAL. Making the
  E2E actually run surfaced FOUR real defects, not one test-harness problem:
  rotted magic-link helper; a missing `project_members` fixture row (RLS);
  **`approvePortalTask`'s plain RLS UPDATE was silently unreachable for
  client-role users** — the portal's primary action was broken in production —
  fixed with a SECURITY DEFINER RPC; and a Realtime auth-hydration race causing
  unauthenticated channel joins on fresh loads. Spec passes, four consecutive runs.

## Orchestrator gate run 2 — all green

- `npx tsc --noEmit` → exit 0
- `npm run lint` → 0 errors, 15 warnings (all no-unused-vars on `_`-prefixed
  mock params in test files)
- Unit/component → 206 files / 1590 tests, ALL PASSING

## Scrutiny round 2 — REJECT (round 1 closed; F012's own work opened three new blockers)

Report: milestones/scrutiny-2.md. The validator re-ran the mutants rather than
trusting the fix workers' claims.

Closed and verified: AS-003, AS-006, AS-011, AS-015, AS-021, AS-032.
Also confirmed NOT weakened: AS-029's no-reload sentinel and AS-030's teardown.

New blockers, all in F012's unreviewed work:
- **RPC authorization gap.** `approve_portal_task_atomic` authorizes on
  workspace-level `role='client'` only, but `is_project_visible_to()` requires
  an explicit `project_members` row for clients. SECURITY DEFINER bypasses RLS,
  so a client with access to project A can flip `pending_client_approval` on any
  client-visible pending task in project B of the same workspace — a task they
  cannot even read. → F020
- **The same silent-failure bug one function away.** `requestPortalTaskChanges`
  still uses the plain RLS UPDATE that F012 proved unreachable for clients:
  0 rows, no error, returns `{ ok: true }`. The client is told their change
  request landed when the flag was never cleared. → F020
- **Zero server-side tests** for lib/actions/portal-approval.ts — the entire
  gate chain in front of a SECURITY DEFINER function is unexercised. → F020

Still-surviving mutants from round 1's fixes:
- AS-014 — moving `inFlightRef.current = false` out of `finally` survives; a
  failed approve would leave the button permanently deaf. → F021
- AS-016 — deleting `if (!trimmed) return` survives because the test clicks an
  already-disabled button, so the guard is never under test. → F021
- AS-025..AS-028 — F017's extraction is real and well tested at the module
  level, but inverting the single CALL SITE (board.tsx:291) leaves all 1573
  tests green. Second rejection of these assertions. → F022

Major: the auth-hydration race was fixed in one hook only; task-list,
request-list, board and My Tasks still subscribe synchronously, so by F012's own
diagnosis AS-021/022/023 don't hold on a fresh load. Plus an AS-024 regression —
the new `cancelled` guards have no unmount-before-getSession test and the chain
has no `.catch`. → F023

Fix wave 3 spawned: F020, F021, F022, F023.

## Fix wave 3 results

- F023 COMPLETE (bac0b30) — the auth-hydration fix hoisted into
  `lib/realtime/subscribe-when-authenticated.ts` and wired through all three
  portal subscribers, closing the systemic AS-021/022/023 race and the AS-024
  unmount/rejection regression. Audited and reported (out of scope, not fixed):
  use-board-realtime.ts, use-my-tasks-realtime.ts, use-calendar-realtime.ts have
  the same synchronous-subscribe race.
- F021 COMPLETE (ab07150) — AS-014 retry-after-failure tests (x2) and the AS-016
  whitespace-guard test, the latter reached via a test-only Button stub because
  Base UI enforces `disabled` in a closure that the DOM cannot bypass. No
  production defect; the component was already correct.
- F020 COMPLETE — migration 20260906010000 closes the SECURITY DEFINER
  authorization gap (`approve_portal_task_atomic` now checks
  `is_project_visible_to()`) and adds a sibling `request_portal_task_changes_atomic`
  so the silently-no-opping action goes through the same hardened path. 20 new
  server-side gate-chain tests. Migration applied; E2E still passes.

Orchestrator verification: `supabase migration list --linked` → 149 migrations,
**0 drift**. Both migrations added by this mission are live.
- F022 COMPLETE (784e76e) — mounts the real Board, drives a genuine dnd-kit drag,
  fires a real Realtime UPDATE. Inverting AND deleting board.tsx:291 both fail
  the new test; board.tsx confirmed byte-identical after mutation testing.

## Orchestrator gate run 3 — all green

tsc 0 · lint 0 errors / 15 warnings · 209 files / 1627 tests all passing
`migrations:check` → 149 migrations, 0 drift · `realtime:check` → 9/9 published

## Scrutiny round 3 — REJECT (0 blockers, 5 majors, 6 minors)

Report: milestones/scrutiny-3.md. AS-016 and AS-027 FAIL; every other
assertion PASSES.

Genuinely closed and re-verified by re-running the mutants:
- F020's security fix — all five attacker scenarios blocked; the cross-project
  client is stopped by `is_project_visible_to()`; that predicate really does
  require a `project_members` row and cannot be satisfied via a second
  workspace_members row (unique constraint). `request_portal_task_changes_atomic`
  shares the identical gate chain.
- F022's call-site test — inversion and deletion both killed.
- F023's teardown — `release?.()` and `cancelled` mutants both killed; hoisting
  improved the overview hook with no behavioural regression.

The pattern in this round's findings: **wave 3 fixed two things on one of two
symmetric paths.**
- AS-016 — the `finally` was pinned for approve but not for request-changes;
  the mutant survives at approval-actions.tsx:113-118. → F025
- AS-027 — F022 covered 1 of 5 release sites; deleting the release at
  board.tsx:841, :864, :875 or :886 all survive, and no test drives a FAILING
  board action followed by a realtime update. Third attempt at these
  assertions. → F026
- NEW data-loss path introduced by F020: requestPortalTaskChanges now really
  flips the flag BEFORE posting the note, so a failed `addComment` loses the
  client's message and makes every retry raise 'task not found'. Unreachable
  before wave 3 — a regression created by fixing the silent no-op. → F024
- NEW: the RPCs pin `pg_temp` but `is_project_visible_to` and three siblings
  set only `search_path = public`, and F020 made that predicate the
  authorization boundary. → F027
- NEW: the two RPC bodies are byte-identical, so a direct PostgREST call to
  `request_portal_task_changes_atomic` clears the flag with no message; the
  source comment claiming otherwise is false. → F024

Fix wave 4 spawned: F024, F025, F026, F027.

## Fix wave 4 results

- F026 COMPLETE (7012f59) — the four previously-uncovered `releasePendingMove`
  sites (reorderTask :841, editTask :864, setTaskAssignees :875,
  updateTaskTags :886) now each have a call-site test driving a real drag with a
  FAILING Server Action followed by a realtime UPDATE. All four mutation-verified.
  AS-027 covered on the third attempt.
- F025 COMPLETE — two AS-016 retry-after-failure tests for the request-changes
  path. No production defect: the `finally` was already correct, only the test
  coverage was missing.
- F024 COMPLETE (f18691a) — `requestPortalTaskChanges` now posts the client's
  comment BEFORE flipping `pending_client_approval`, so a failed `addComment`
  no longer strands the task non-pending, unretryable and with the message lost.
  Three regression tests, ordering mutation-verified.

Residual minor carried forward (not fixed): the two RPC bodies remain
byte-identical, so a direct PostgREST call to `request_portal_task_changes_atomic`
still clears the flag with no message. F024 correctly declined to edit an
already-applied migration. The application path is now correct; the RPC-level
asymmetry is a hardening item, not a live defect, since the action layer is the
only caller.
- F027 COMPLETE — migration 20260908010000 pins `search_path = public, pg_temp`
  on all five SECURITY DEFINER predicates. Applied live; verified via `pg_proc`
  that bodies, signatures, volatility and grants are byte-identical.

## Scrutiny round 4 — REJECT (0 blockers, 2 majors, 10 minors; 33/34 PASS)

Report: milestones/scrutiny-4.md. The validator re-ran every wave-4 mutant
rather than trusting the workers, and confirmed all four fixes:
AS-016 closed (7 mutants killed), AS-027 closed (all four release sites die
individually), F024's ordering pinned by test, F027 verified against live
`pg_proc` with no behavioural drift.

Two findings all four rounds had missed:
1. **AS-006 FAIL** — the test net does not discriminate. The "independent grep"
   test computes `filesWithBindings` and never compares it to `discovered`, so
   replacing `discoverSubscribedTables`' body with a 9-element literal passes
   every test. Implementation is correct today; this is missing regression
   insurance. → F028
2. **`npm run realtime:check` can print `SUPABASE_SECRET_KEY` verbatim.** Its
   local `redactSecrets` is passed only `[accessToken, projectRef]`, unlike the
   drift script's env-keyed version. Reproduced against unmutated code with a
   planted token. Out of AS-003's literal wording (which scopes to
   migrations:check) but exactly the class of defect AS-003 exists to prevent.
   → F028

Also useful: `vitest run --reporter=basic` exits 1 unconditionally on vitest
4.1.10, so any mutation run using it reports a spurious 100% kill rate. Recorded
so future rounds don't fool themselves.

Carried forward as follow-ups, out of this mission's contract: `is_project_client`
retains a default PUBLIC EXECUTE grant (pre-existing); 45 other SECURITY DEFINER
functions remain on bare `search_path=public`; board/my-tasks/calendar
subscribers still join Realtime unauthenticated on a fresh load.
- F028 COMPLETE (389d887) — redaction unified into `scripts/lib/redact-secrets.mjs`
  (env-keyed, closing the SUPABASE_SECRET_KEY leak in check-realtime-publication.mjs);
  AS-006 test net replaced with a real comparison plus a temp-dir novel-table
  test. Both mutation-verified.

## FINAL GATE RUN — ALL GREEN

- `npx tsc --noEmit` → exit 0
- `npm run lint` → 0 errors, 15 warnings (all no-unused-vars on `_`-prefixed
  mock params in test files; baseline was 13)
- `npx vitest run` (unit + component) → **209 files / 1638 tests, all passing**
- `npm run migrations:check` → no drift
- `npm run realtime:check` → 9/9 subscribed tables published
- `npx playwright test tests/e2e/portal-approve.spec.ts` → **1 passed**

Mission complete. 11 planned features + 17 follow-ups from four adversarial
scrutiny rounds = 28 features. Every finding of every round is closed.

Carried forward as out-of-contract follow-ups (documented, not done):
- board / my-tasks / calendar subscribers still join Realtime unauthenticated on
  a fresh load (same race F023 fixed for the portal).
- 45 SECURITY DEFINER functions remain on bare `search_path = public`, including
  `is_project_visible_to_row`.
- `is_project_client` retains a default PUBLIC EXECUTE grant (pre-existing).
- The two portal RPC bodies are byte-identical; a direct PostgREST call to
  `request_portal_task_changes_atomic` clears the flag with no message. The
  action layer is the only caller and is now correct.
