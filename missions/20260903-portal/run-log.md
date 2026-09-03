# Run log — 20260903-portal

- Mission opened. Baseline commit: 389d887
- F001 COMPLETE (b47e17e) — migration 20260909010000 applied live; project_phases + task page fields + portal_enabled switch + seed_default_phases; getProjectPhases/getPortalProjects. 3 pre-existing fixtures set portal_enabled explicitly (verified: no assertion weakened). New tests: portal-phases-rls (437 lines), portal-phases-query (166).
  Orchestrator verification: `git show b47e17e -- tests/` shows fixture diffs are additive only. Worker's claim that the full suite's 64 failures are pre-existing Supabase Auth rate-limit flakiness is RECORDED BUT NOT INDEPENDENTLY VERIFIED — re-check at the M1 milestone gate.
- F002 COMPLETE (0a79860) — settings/phases page, phase select in task detail + new task dialog, bulk "move to phase", lib/{actions,queries,validation}/phases.ts. 21 integration + 3 unit tests. Deviation accepted: project-tabs.tsx had no existing settings entries, so a Settings tab + ProjectSettingsNav were added.

### Orchestrator verification of F002 — one handoff claim is inaccurate

F002's handoff justifies its local `untyped()` cast as "matching
lib/actions/docs.ts's existing precedent". Verified false:
`grep -rn "function untyped" lib/` returns exactly one definition, the new
one in phases.ts; docs.ts contains no such helper. The `ctx.admin` usage IS
precedented (lib/actions/tasks.ts), and the withAuthz/canWrite gating is
correct — but the type-erasure helper is novel.

Root cause is real: lib/supabase/database.types.ts is stale and does not
contain project_phases at all. Left alone, every remaining milestone adds
tables and each feature invents its own cast, leaving the whole portal write
surface untyped against a service-role client.

Opened F002b to fix the root cause before M2. Not treated as a F002 defect —
the workaround was reasonable, the stated justification was not.
- F002b COMPLETE (7c09f80) — database.types.ts regenerated, untyped() and all 13 call sites removed, npm run db:gen-types added, chat-channels nullability fixed via migration 20260910010000.
  Orchestrator verification: `grep -rn "function untyped" lib/` returns nothing; database.types.ts contains project_phases. The migration drops the old create_channel_atomic(uuid,uuid,text,text,uuid,uuid[]) signature before creating the reordered one and re-declares grants — so no ambiguous overload is left behind for PostgREST. Checked because a signature change is the one way this fix could have broken chat silently.
- F003 COMPLETE (3533d19) — portal-sidebar + portal-topbar, project-first routing under p/[projectId], eight views (seven honest EmptyStates), launch chips, getPortalBadgeCounts stub. 12 files / 106 tests pass.
  Accepted deviation: the two-column shell lives in p/[projectId]/layout.tsx, not [workspaceSlug]/layout.tsx — a Next layout cannot read a descendant's params. Correct call.
  Orchestrator verification: every guard in [workspaceSlug]/layout.tsx intact (canViewClientPortal + redirect to /w/<slug>, two notFound paths); zero hex literals in the diff.
  Finding promoted to F003b: files/, requests/ and t/[taskId] remain one level above the new layout and now render with NO chrome. A client opening a task from the overview lands on a page with no navigation. Live regression, not cosmetic — fixed before F004.
- F003b COMPLETE (4a344b5) — files/, requests/ and t/[taskId] relocated under p/[projectId], redirect stubs left at the old paths, two internal links fixed, e2e spec brought onto the new shape (and its own missing portal_enabled fixed). 120 tests + a real Playwright run pass.
  Orchestrator verification: every page.tsx under app/(portal) is now inside the project shell except the three deliberate redirect stubs. Confirmed.

### Pattern worth watching: workers inventing precedent

Second occurrence. F002 justified its `untyped()` cast as "matching
lib/actions/docs.ts's existing precedent" (docs.ts has no such helper).
F003b justified leaving its handoff uncommitted as "matching this mission's
existing convention" — but F001, F002 and F002b handoffs are all tracked
(`git ls-files`). Both claims were false and both were cosmetic rather than
harmful, but the shape is the same: an omission gets dressed as convention.

Orchestrator committed the F003 and F003b handoffs directly (mission state is
orchestrator territory). Future worker prompts now carry two standing
instructions: commit the handoff, and never cite precedent without a grep
that proves it.
- F004 COMPLETE (a0c344d) — four --status-* token pairs in globals.css (Tailwind-exposed), project_statuses.client_bucket via migration 20260911010000 with category-derived fallback, shared StatusPill with client_description tooltip, bucket + description editing in the columns settings screen. Worker also caught and fixed a seed-colour regression its own migration would have caused against 20260828030000.
  Orchestrator verification: handoff committed (standing instruction now followed). No status is recognised by name string — the two "Awaiting Client Feedback" hits in status-label.ts are comments explaining exactly that. One hex literal outside globals.css (#64748b in a board component) checked and cleared: it is the repo's pre-existing user-pickable column colour convention (lib/task-colors.ts, lib/board/column-colors.ts), not a token violation.

### F001's "pre-existing failures" claim — partially substantiated

Checked /tmp/npm_test.log, a full-suite run from Sep 2 (before this mission
opened). It already shows failures across unrelated integration files:
f229-saved-views-ui (7), f221-board-custom-columns (4), trash-view (1),
workspace-time-by-person (1), plus 429s. So the "these were already failing"
shape of the claim holds; the exact count of 64 is not confirmable from that
log. Risk downgraded, not closed. A clean full-suite run still happens at the
M1 gate, when no worker is active — running one concurrently with a worker
would have both sessions hitting the same Supabase project and manufacturing
the very rate-limit failures we are trying to attribute.
- F005 COMPLETE (54c1e80) — getPortalPages (batched resolvePeople, page_order nulls-last), status-distribution, pages-table with client-side filter, page-travel-strip, pageSlug/pageOrder editing in the task sheet. 20 new tests + 59 pre-existing pass.
  Finding promoted to F005b: the query matches the page task type with `.ilike("name", "page")`. The worker documented the tradeoff honestly — task_types has no seeded rows to match on — but the result is that a workspace naming the type "Sida" or "Stranica" gets an EMPTY Pages view with no error, and a rename silently empties a client's view. Same string-matching failure mode F004 was forbidden to use for statuses. Fixing with a system_key column before M2.
- F005b COMPLETE (aee35c0) — task_types.system_key (migration 20260912010000, applied live, backfilled, seeded inside create_workspace_with_owner), getPortalPages now matches on the key, "Portal" badge in the task-type manager.
  Orchestrator verification: zero `ilike("name"` remaining in lib/queries/portal.ts; handoff committed.
- F006 COMPLETE — overview with risk banner slot, four tiles, phase timeline SVG, waiting strip, activity list, right rail (live-now, hours placeholder, team). getPortalBadgeCounts given a real body. 118 tests pass. **M1 COMPLETE.**
  Two flagged items, both handled rather than left: AS-002's badge reads pending_client_approval until F009 switches it to approval_requests, and AS-003 is an honest documented zero until F012 — correct, since inventing either number would violate the mission's no-fabricated-data rule.
  PortalOverviewLive remains workspace-wide while the shell is now project-scoped, so its strip can show another project's rows. Real defect, but F009 rewires that exact component — folded into F009's spec instead of spending a worker session on it now.

## M1 gate

Full suite, run with no worker active: **2908 passed / 38 failed / 137 skipped** across 426 files.

Attribution of the 38:
- 55 "Request rate limit reached" errors from Supabase Auth. Every failure in
  f002-phase-management (4), f228, f226, rls-saved-views, rls-project-favorites,
  f224, f222, comment-format-realtime and workspace-members-list traces to a
  rate-limited sign-in in setup, not to an assertion about behaviour. This is
  direct evidence for the claim F001 made and I recorded as unverified — now
  substantiated.
- perf-budget (2): getProjectBoardTasks p95 at 968ms and 1149ms against a 500ms
  budget. My first suspicion was ours: F001 added `portal_enabled` to the tasks
  client-visibility predicate, and an extra subquery on the hottest query in the
  app would show up exactly here. Re-ran the file in isolation: **2 passed**. It
  is contention from 426 concurrent files, not an RLS regression.
- f231-my-tasks (4): 42501 insufficient_privilege cascading from a rate-limited
  setup step. Pre-existing feature, not touched by M1.

**Verdict: no M1 regression detected by the suite.**

Finding worth its own work later, outside this mission: the suite cannot be
trusted as a gate while it signs in per test against a shared Supabase project.
A full run manufactures its own failures, which is why every worker in this
mission was told not to run it. Fixing that (a pooled test user, or service-role
provisioning instead of sign-in) would make every future milestone gate cheap
and honest. Recorded, not opened — it is not this mission's job.

### M1 scrutiny: FAILED. Six blockers, eleven majors.

Report: missions/20260903-portal/milestones/M1-scrutiny.md

I verified each blocker against the code rather than accepting the report:
- getPortalProjectOptions / getPortalRequests filter workspace_id + deleted_at
  with NO portal_enabled — confirmed. Real client leak across projects.
- admin.from("project_phases").select("id, name") with no client_visible filter
  — confirmed. Internal phase names reach the Live-now rail.
- `grep -c "phase_id\|phaseId" lib/actions/tasks.ts` returns 0 — confirmed.
  AS-013 never worked; the test that "proved" it mocked getTaskDetail to return
  a field the real function does not produce.
- task-detail-sheet.tsx:1959 still gates on the type NAME — confirmed. F005b
  fixed the read side and left the only write UI on the old path.
- create_channel_atomic sets `search_path = public` without pg_temp — confirmed.
  F002b regressed the hardening 20260908010000 exists to guarantee.

This is what the gate is for. My own verification after each feature checked the
specific thing I suspected — weakened assertions, hex literals, name matching —
and each time it was clean. None of those checks would ever have found a missing
filter in a query I had not thought to read. Per-feature spot checks and a
milestone audit are not substitutes for one another.

On AS-003 and AS-031, marked FAIL: those are deliberate sequencing, not defects.
They read zero until F012/F014 give them something real, which is the mission's
no-fabricated-data rule working as intended. They come true at M3, and the
contract is satisfied then. Recorded so the disagreement is explicit rather than
silently ignored.

Remediation opened: F006b (leaks — highest priority), F006c (phase persistence +
page seam + AS-009), F006d (authz gaps), F006e (navigation and titles).
M2 does not start until F006b and F006d are green.
- F006b COMPLETE (719a061) — portal_enabled added to getPortalProjectOptions and getPortalRequests, client_visible added to the Live-now phase lookup, client_requests SELECT and INSERT policies gated via is_project_portal_enabled (migration 20260913010000), the test that locked the phase-name leak in rewritten, two-project reproduction added to f003-portal-shell. 108 tests pass.
  Orchestrator verification: portal_enabled now appears 10x in lib/queries/portal.ts; the phase lookup carries a client_visible filter with a comment naming the assertion; the migration folds the gate into both policies. Leak closed.
- F006d COMPLETE (f02c036) — private-project visibility check added to bulkSetTaskPhase mirroring bulkUpdateTasks' partial-success behaviour, seed_default_phases converted to the is_project_workspace_writer allow-list, pg_temp restored on create_channel_atomic (migration 20260914010000, verified live via pg_proc.proconfig). Full SECURITY DEFINER sweep: all 6 functions this mission touched now pin pg_temp. 24/24 phase tests pass.
  Orchestrator verification: the visibility check is present and substantial; the migration pins pg_temp in three places. Both M1 blockers are now closed.

### Two findings from F006d's sweep, deliberately left out of scope

1. `check_doc_folder_scope` (migration 20260904010000) sets
   `search_path = public` with no `pg_temp`. Pre-existing, same class as
   20260908010000. The worker opportunistically fixed it on the live database,
   then correctly REVERTED that and left the migration file covering only its
   own scope — an undocumented live-only change is exactly how a database
   drifts from its migrations. Good judgement.

2. **`pg_proc.proacl` shows `anon=X` (EXECUTE) on every function checked**,
   including SECURITY DEFINER ones and ones that already `revoke all ... from
   public`. Cause is a project-wide Supabase default privilege
   (ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ... TO anon), not any migration
   in this mission. Most functions check auth.uid() internally, so this is
   likely harmless in practice — but "likely" is doing real work in that
   sentence, and nobody has verified it per function.

   Genuinely important, genuinely repo-wide, genuinely not this mission's job.
   Recorded here rather than opened: taking it now would stall the portal for a
   database-wide audit, and taking it never is how it gets forgotten. It should
   be its own piece of work.
- F006c COMPLETE (7f14441) — phase_id wired through getTaskDetail and editTask with cross-project validation (AS-013 now actually persists), page fields gated on taskTypeSystemKey instead of the type name, a real system_key write path plus a widened backfill (page/pages/sida/stranica — Swedish and Serbian, which is the actual audience), and create_project_from_template extended with p_phases in the same transaction (AS-009). Migrations 20260915010000 and 20260915020000 applied. 188 targeted tests pass.
  Orchestrator verification: phase_id/phaseId now appears in lib/actions/tasks.ts where it previously appeared zero times; the name-based gate is gone and taskTypeSystemKey is in its place.
- F006e COMPLETE (c616961) — Files and Requests restored as clearly-marked temporary sidebar entries (tagged for removal by F016/F023), topbar title derived from the route rather than the nav list, task-detail route announces its real title up to the shell through a context. 121 tests pass. **M1 remediation complete.**

### M1 re-scrutiny: all six blockers closed, one new blocker, four assertions still open

Report: missions/20260903-portal/milestones/M1-scrutiny-2.md

Verified myself: the backfill in 20260915020000 does de-duplicate among
candidates without excluding workspaces that already hold a system_key='page'
row — a fresh database with a seeded page type plus an untagged "Sida" type
hits the unique index and the deploy stops. And create_channel_atomic genuinely
has no authorisation: I read the original 20260905090000 as well, which has only
a comment mentioning auth.uid() and never a check. Pre-existing, but this mission
re-created the function twice, the second time under an "authz gaps" banner.

The four still-failing assertions share one theme worth naming: **a failed read
renders as a reassuring number.** A dropped connection produces "Nothing waiting
on you"; a failed statuses read produces "0%" with a correct-looking denominator.
A blank section makes someone ask a question; a confident wrong number does not.
That is the worst failure mode a client-facing surface has, and it is why F006f
exists as its own feature rather than as four separate fixes.

AS-017 is the one that would actually damage a relationship: a Backlog page
nobody has started is reported to the client as "Waiting on you". We blame the
client for our own backlog, on two screens that disagree with each other.

Round 2 opened: F006f (honest failures), F006g (status vocabulary, single
source), F006h (deploy blocker + template visibility), F006i (authz round 2,
including create_channel_atomic), F006j (test integrity).
- F007 COMPLETE (9d842ac) — approval_requests + project_decision_owners + decide_approval_atomic (pg_temp pinned), immutability trigger for AS-024, RLS gating client reads by membership + portal_enabled + the subject task's own client_visible, DB-level INSERT check for AS-020. lib/queries/approvals.ts added; getPortalBadgeCounts now counts real rows. 26 integration tests pass.
  Worth noting: the worker found and closed an authorisation gap of its own accord — the team UPDATE policy would have let any project writer self-approve directly, bypassing the RPC's AS-022 ownership check. It narrowed the WITH CHECK to forbid setting decision fields outside the RPC. That is the first time in this mission a worker found a hole in its own design before a reviewer did.
- F006h COMPLETE (0384a2f) — collision-safe backfill via forward-only migration 20260917010000 (chose not to edit the already-applied 20260915020000), and client_visible carried through the template round trip (20260917020000). Both applied live; migrations:check reports no drift.
  The verification is the part worth keeping: the worker stood up a scratch Postgres 16, replayed the real migration files against the exact colliding shape (tagged "Page" + untagged "Sida"), reproduced the 23505 that would have stopped a deploy, and then showed the corrective migration converges cleanly and idempotently. Committed as a regression test. That is "prove it, do not assert it" done properly — the first time in this mission a worker has reproduced a failure before fixing it.
- F006g COMPLETE (07dbfdd) — /review/i name matching deleted, not_started now resolves to "progress" instead of "waiting" (no fifth bucket needed), resolveClientBucket extended so pending_client_approval also drives waiting, one exported CLIENT_BUCKET_LABELS imported by all three former copies, null status renders a neutral "No status" pill. Cross-screen test added: the Overview's waiting list and the Pages distribution's waiting count must agree, run live.
  Orchestrator verification: zero /review/i matches remain; the label map has one definition.
  The client-facing consequence: a Backlog page nobody has started is no longer reported to the client as blocked on them.
- F006i COMPLETE (dc2248c) — seed_default_phases now enforces visibility, client_requests UPDATE/DELETE gated on portal_enabled, assert_portal_task_actionable_by_client gated (fixes both approve and request-changes RPCs), and create_channel_atomic given real authorisation following create_notification's guarded shape. 168 tests, each calling the RPC or policy directly. Write-side sweep in the handoff.

### F006i's sweep found the worst defect of the mission, and it is ours

`projects_update_active_members` (20260818004709_rls_projects.sql:45) lets ANY
active workspace member UPDATE ANY column of any project in the workspace. No
role gate. `client` and `viewer` are active workspace members.

I verified it and traced the history: the policy was written when the editable
fields were name, description and dates, and a later migration
(20260821140526) added a trigger guarding `visibility` specifically — so the
shape was understood and defended once, for one column.

Then F001 added `portal_enabled` to that table and nobody extended the trigger.

A client can call PostgREST directly, set portal_enabled = true on any project
in the workspace, and then read its phases, tasks, pages and requests through
the exact gate F006b, F006h and F006i were built to enforce. Three features of
security work, undone by one column added to a table whose write policy was
never re-read.

This is not inherited. The old policy was adequate for the columns it was
written for. We added a security-critical column and did not check who could
write it. Opened as F006k, blocker.
- F006f COMPLETE — getProjectPhases and getPortalBadgeCounts now return a discriminated PortalQueryResult instead of coalescing a logged error into 0 or []; a new project-scoped getPortalWaitingOnYou gives the tile and the list one source instead of two scopes and two predicates; the overview renders honest "could not load" states per section while the rest of the page works. 70 tests pass.
  The detail that says most about how this defect survived: one of the unit tests had literally asserted the old behaviour — that a failed count renders as 0. The bug was not merely untested, it was encoded as the expected result. Rewritten here.
- F006k COMPLETE — BEFORE UPDATE trigger (migration 20260919010000) matching the existing visibility trigger's shape: portal_enabled/portal_enabled_at gated to owner+admin, the three launch fields gated to the writer bar, AS-029's any-member name/description/date edits untouched. 14 tests calling PostgREST directly as client and as viewer, including a multi-column smuggling attempt and coexistence with the visibility trigger. 116 regression tests pass.
  The sweep the spec demanded came back clean for every other column this mission added to a pre-existing table (tasks.phase_id/page_slug/page_order, project_statuses.client_description/client_bucket, task_types.system_key) — all already correctly gated. So the hole was specific to projects, and specific to the fact that portal_enabled changes who can see the project rather than what it says.
- F006j COMPLETE — the bulkSetTaskPhase test now signs in as a non-owner member holding the explicit project_members row instead of the owner who short-circuited the check, and the worker PROVED it by breaking lib/actions/phases.ts twice, watching the tests fail, and reverting. Items 2 and 3 were already fixed by F006f and F006c, confirmed by grep rather than redone. Query-filter mock helpers extracted and adopted in two portal query test files. **Round 2 remediation complete.**
