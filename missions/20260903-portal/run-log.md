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

### M1 third scrutiny: one blocker, and it names a class rather than a bug

Report: missions/20260903-portal/milestones/M1-scrutiny-3.md

AS-011, AS-015 and AS-017 confirmed genuinely fixed, tests confirmed capable of
failing. None of the five regression shapes I asked it to hunt had landed.

The finding that matters: **the RLS matrix is clean, and every remaining gap is
in code that never reaches RLS.** F006b swept reads, F006i swept writes, F006k
gated the column — three sweeps, each asking "is the policy right?", each
correctly answering yes, and none of them able to see the paths that consult no
policy at all: SECURITY DEFINER functions and Server Actions on the admin client.

Verified myself: decide_approval_atomic has zero portal/visibility/client_visible
checks in its body; get_open_task_counts has zero occurrences of auth.uid,
is_active_workspace_member or revoke; getAttachmentSignedUrl mints through
admin.storage.

get_open_task_counts is the one that should have been caught long before this
mission — SECURITY DEFINER, granted to authenticated, no authorisation of any
kind, and it predates all of this work. We only found it because the third sweep
finally asked a different question than the first two.

Opened F006l (the class, blocker) and F006m (guest regression from F006i, minor).
AS-002's remaining half — the badge counts approvals the client cannot decide,
and its mock discards eq arguments — folded into F009, which implements
decision-owner filtering anyway.
- F008 COMPLETE (7d4291e + code in 8dd5377) — one RequestApprovalDialog from three entry points (task sheet beside the existing toggle, project doc header, standalone artifact URL), requestApproval enforcing AS-020 server-side, submission blocked when the project has no decision owner for the type, per-subject snapshots (task fields inline, doc body to storage, artifact URL never fetched), plus withdrawApproval and the "Who approves what" settings UI. 10 integration tests against the live project.

### My mistake, not the worker's: commits interleaved

F008's code files landed in commit 8dd5377, which is one of MY docs commits. Cause:
I ran `git add -A missions/20260903-portal/ && git commit -m "docs(mission): ..."`
while a worker had its own files already staged. `git add` was correctly scoped;
`git commit` was not — it commits the whole index, not only what I just added.

The tree is coherent and nothing was lost (verified: working tree matches history,
F008's files are present and correct). Only the commit labelling is wrong, and
rewriting history to fix a message is not worth the risk.

Two changes to my own practice:
1. Commit mission docs with an explicit pathspec — `git commit -- missions/...` —
   so another agent's staged work can never ride along.
2. Back to one worker at a time. I had been running two in parallel since the
   remediation rounds because the file areas looked disjoint. They were. The
   index is not.
- F006l COMPLETE (e9368db) — the four RLS-bypassing paths gated (migrations 20260920010000 and 20260920020000, comments.ts, attachments.ts), with the comment-before-RPC ordering in requestPortalTaskChanges preserved as instructed. Class sweep documented in the handoff.

### F006l's sweep found five more, and they are worse

bulk_delete_tasks_atomic, duplicate_task_atomic, restore_task_atomic,
set_task_assignees_atomic, accept_client_request_atomic — all SECURITY DEFINER,
all granted to `authenticated`, all with ZERO authorisation checks. Verified
each individually: no auth.uid, no membership check, no visibility check, no
raise exception. A caller needs only a task id.

All five predate the portal. Before it, "any authenticated user" meant "a
colleague" — the functions were written inside a trust boundary where every
account belonged to the agency, which is why nobody noticed. The portal
dissolves that boundary by design: it puts external clients into the workspace
as authenticated users.

So this is ours to fix, not to file. We are the ones moving outsiders inside the
perimeter these functions assume. Shipping the portal on top of them would hand
every client the ability to delete their agency's tasks.

Opened F006n as a blocker. This is the third time the same question — "what can
a client actually reach?" — has produced a new class of answer: first RLS reads,
then RLS writes, then paths that never reach RLS, now pre-existing RPCs whose
threat model the portal itself invalidates.

### Correcting my own progress reporting

I audited what this mission's commits actually claim, scoped to 389d887..HEAD:
24 of the contract's 55 assertions. Of those, the third scrutiny still has
AS-007 FAILING (F006l fixed four paths, F006n has five more) and AS-002 FAILING
(the badge counts approvals the client cannot decide, folded into F009).

So roughly 22 assertions are genuinely green, not the 30-32 I have been
reporting. The feature count (24 of 40) is the more flattering number and I have
been leaning on it. Assertions are the contract; features are the plan. Reporting
against the plan while the contract lags is how a project convinces itself it is
further along than it is.

Corrected figure going forward: report both, lead with assertions.
- F006n COMPLETE (b94b8f3) — all five RPCs given membership/role/visibility checks mirroring their own Server Actions, plus portal_enabled and a client-cannot-accept-own-request gate on accept_client_request_atomic. 19 guard clauses, 5 revokes, 21 direct-RPC tests plus 48 regression tests.
  Orchestrator note: this handoff answered the completeness question the way I have been asking three rounds of workers to answer it. It states the basis for believing the sweep is complete, names exactly what that claim covers, and then explicitly refuses to widen it — "that's a narrower claim than 'the codebase has no more authz gaps of any kind', and I'm repeating it at that same narrower scope, not widening it." It also declines to re-derive 80+ function bodies and says why, rather than claiming a thoroughness it did not perform. That is the standard.
  **M1 blockers all closed.**
- F006m COMPLETE (bf42ff8) — seed_default_phases now replicates isProjectVisibleToCaller's exact rule (workspace-visible admits any role including guest; private requires explicit project_members unless owner/admin) instead of the stricter SQL helper. Both directions tested: the guest case works, F006i's private-project denial survives. **M1 remediation complete across all three rounds.**

### Not running a fourth M1 scrutiny

Three rounds have run. Round 1 found six blockers, round 2 found one new blocker
plus a class, round 3 found a class the first two structurally could not see, and
every blocker from all three is now closed and verified. A fourth full pass would
re-read code that has been read three times.

The remaining risk is not in M1's code, it is in the seam between M1 and M2 —
which is exactly what M2's own gate will exercise, with the approvals flow
running through the phases, statuses and portal_enabled gates M1 built. Folding
M1's final verification into that gate is a better use of a review than a fourth
pass over the same files.

If M2's gate surfaces an M1 regression, that judgement was wrong and I will say so.
- F009 COMPLETE (7bfb494) — ApprovalCard, ApprovalHistory and DecisionOwnersGrid on the approvals page, decideApproval action calling decide_approval_atomic, the AS-002 badge scoped to the client's own decision types, PortalOverviewLive given a projectId prop closing the cross-project realtime leak F006 flagged, and the badge mock migrated to F006j's shared query-filter helper. 136 tests across 9 files.
  Accepted deviation: the worker kept components/portal/approval-actions.tsx rather than deleting it as the spec said, because the task detail page's separate legacy pending_client_approval toggle still uses it. Correct call — my spec assumed the two flows were the same one. Reasoning documented in the handoff rather than done silently.
- F010 COMPLETE (5232227) — workspace approvals queue at /w/[slug]/approvals: oldest-waiting-first, derived "what it blocks" (task title + phase, batched, no N+1), summary strip with open count / oldest age / past-due count, Withdraw and Copy-link, sidebar item with badge. No fake Remind button.
  Thin on tests: 2 integration tests for a new screen. Acceptable for a read-mostly presentation surface built on queries F007 and F009 already covered, but flagged for the M2 gate to look at rather than waved through.
- F011 COMPLETE — decide_approval_atomic extended (migration 20260923010000) so a changes_requested decision atomically creates a client_visible=false task carrying the note, links it through the new resulting_task_id, and posts the note as a comment on the subject task; round tracking in requestApproval; a round>=3 suggestion in the dialog; a non-linking "logged as work" line on the portal card. Tests cover the primary success AND the forced-failure atomicity case. **M2 COMPLETE.**

## M2 gate

### M2 gate: FAILED. One blocker, four majors. One of them is my error.

Report: missions/20260903-portal/milestones/M2-scrutiny.md

The core is sound and the review says so: decide_approval_atomic read as a whole
is correct, F006l's portal gate and F007's owner check both sit above F011's new
branch so both fire on every path, and there is no EXCEPTION block anywhere in
the function — so F011's atomicity holds by construction rather than by test.

**Blocker, verified:** F011's `resulting_task_id uuid references tasks (id) on
delete set null` is written only on rows it simultaneously settles. A referential
SET NULL is a real UPDATE and fires row triggers, so the immutability trigger
aborts the parent delete. Client requests changes -> task created -> team trashes
it -> purge_task fails permanently. The migration header asserts this cannot
happen; true for direct writes, false for the path it created. F011's own test
afterAll hits it and swallows it.

**The second finding is mine.** F009's worker kept approval-actions.tsx instead of
deleting it as its spec said, explained that the task page's legacy toggle still
uses it, and I accepted that and wrote it into this log as a correct call. It was
correct about why the file exists. Neither of us checked what that path calls:
approve_portal_task_atomic, which has ZERO project_decision_owners lookups.
Verified. So a client who owns no decision type is refused on the Approvals view
and succeeds on the task page.

The worker answered the question it was asked. I did not ask the next one — "and
does that other path enforce the same rule?" — because the reasoning I was given
was locally sound. That is exactly how the M1 defects survived too: every
individual answer was right.

Opened F011b (blocker) and F009b (the two paths, plus subject_id validated only
in TypeScript and requestApproval missing its portal gate). AS-021's missing doc
"Open" control and AS-002's vacuous test follow in F009c.
- F011b COMPLETE — prevent_approval_request_settled_update rewritten to guard the four decision fields via IS DISTINCT FROM instead of blocking every column on a settled row (migration 20260924010000). The FK's referential SET NULL now passes through during purge while AS-024 still holds. afterAll now throws on cleanup errors instead of swallowing them, plus two new AS-024 tests.
  The right call: AS-024 says a recorded DECISION cannot be edited. The original trigger enforced something stronger and unstated — that no column of a settled row may ever change — and that stronger rule is what made deletion impossible. Narrowing it to what the contract actually says fixes the bug without weakening the guarantee.
- F009b COMPLETE (982d24e) — extracted a shared is_project_decision_owner predicate used by BOTH decide_approval_atomic and the assert_portal_task_actionable_by_client helper that approve_portal_task_atomic and request_portal_task_changes_atomic already share, so the two surfaces cannot drift again. Database-level subject_id/project validation added inside the RPC; requestApproval gated on portal_enabled. 12 tests covering four caller types against every path, plus 106 side-effect tests.
  Structurally the right answer: it removed the requirement that two functions agree, rather than making them agree today. That is the difference between fixing this instance and fixing the shape.
- F009c COMPLETE (96d9991) — getApprovalDocSnapshotUrl mints an RLS-scoped signed URL mirroring getAttachmentSignedUrl, and the doc-subject card now has a real Open control, so the stored snapshot finally has a reader. The AS-002 mock migrated to the shared query-filter helper, and the worker demonstrated the test now fails when .eq("user_id", user.id) is removed, then reverted. **M2 remediation complete.**

### M2 gate: PASSES on the second pass. M3 started.

Report: missions/20260903-portal/milestones/M2-scrutiny-2.md

The blocker is gone and AS-024 holds — the narrowed trigger fires for service_role
too, proven by four separate per-column updates through the admin client. The
second approval path is genuinely closed: the reviewer diffed the new shared
helper against the version it replaced and found the checks byte-identical plus
the owner call, which was the specific way a rewrite could have silently dropped
the portal gate. The signed URL is clean — authorisation happens in the RLS
client's own select, and both attacks I named return null before storage is
reached.

Two things banked rather than fixed, opened as F009d:
- The narrowing left service_role able to rewrite four unguarded columns on a
  settled row. Nothing does today. But a deny-list goes stale the moment someone
  adds a column, and that is the shape this mission has been caught by four
  times — so it becomes an allow-list.
- A correct refusal reads as "Something went wrong" when a project has no
  decision owners configured. Right outcome, useless message.

One consequence recorded as intended, not a defect: a doc-subject approval now
lets a client open the body snapshot of a doc they could not otherwise read.
That is the feature working — the team deliberately asked this client to approve
that document, and the snapshot is the scoped disclosure that request implies.
Requiring the doc to be client-visible first would make doc approvals useless.
- F012 COMPLETE — client_deliverables, project_scope_items, project_decisions and project_assumptions (migration 20260926010000), RLS copied from the current client gate including portal_enabled, no client write path on any of the four. Read-side queries in lib/queries/{deliverables,project-records}.ts. 23 tests: the three-per-table leak set (select, count, RPC predicate) plus client_visible absence and write-path denial. project_risks and flag_assumption_atomic correctly left out per spec.
  AS-003 stops being a deferred zero here: getPortalBadgeCounts now carries the real overdue-blocking-deliverables count instead of F009's placeholder, and the stale "table doesn't exist yet" fixture was updated rather than left to rot.
- F013 COMPLETE (d9f134a) — accept_deliverable_atomic, sweep_overdue_blocking_deliverables on pg_cron following the F212 precedent, a backward-compatible deliverables[] section in the project-template payload, and the team management panel at /settings/deliverables. 10 integration + 4 unit + 2 template round-trip tests.
- F014 COMPLETE (fa04c53) — mark_deliverable_delivered_atomic (migration 20260928010000), client-authorised upload action, the "what it holds up" derivation, and getPortalRisks finally given a body so F006's dormant risk banner renders. AS-003, AS-029, AS-030 and AS-031 all covered by tests. The overview banner that has been shipping as a no-op since M1 is live.
- F015 COMPLETE (5ce594a) — team Record panel (scope/decisions/assumptions), "Turn into decision" in the comment menu, the portal Scope view with all four sections, and flag_assumption_atomic which writes flagged_by_client_at and flagged_note but never `state`. 8 integration + 4 unit tests.
  Correctly deferred: the "Raise a change request from this" action on a flagged assumption, because F016's dialog does not exist yet. Folded into F016's prompt rather than left as a loose end.
- F016 COMPLETE — client_requests triage/quote columns, accept_client_request_atomic hardened with a database gate (SQLSTATE CR047/CR048) so a change request cannot become a task before client approval and an expired quote is refused, send_change_request_quote_atomic for triage, and a trigger syncing the client's decision from F007's own approval_requests rather than a second decision path — inserting the scope item on approval. Portal change-requests table filled in; team quote dialog with the three-question track proposal and a "how the client will see this" preview. **M3 COMPLETE.**

### One loose end, deferred twice, now owned

"Raise a change request from a flagged assumption" was deferred by F015 (F016's
dialog did not exist yet) and again by F016 (needs a team-write authorisation
surface its spec did not name). Both refusals were locally correct. Together they
are exactly how a small piece of connective tissue vanishes from a project: every
feature declines it for a good reason and nobody owns it.

Opened as F016b rather than mentioned a third time in someone else's prompt. It
is the process rule "an assumption that turns out wrong is a change request, not
a surprise" made mechanical — without it the rule stays a sentence in a document,
which is where it lives today and why it is not followed.

## M3 gate

### M3 gate: FAILED. One blocker, five majors. The class has now recurred five times.

Report: missions/20260903-portal/milestones/M3-scrutiny.md

The security core is genuinely good and the reviewer said so: all four tables copy
the client gate faithfully, none has a client write policy, AS-045's client_visible
lives in the policy so counts are safe by construction, mark_deliverable_delivered_atomic
takes no state parameter at all, and accept_client_request_atomic survived its second
modification with F006n's auth firing above every new branch.

**Blocker, verified:** client_deliverables.task_id has no same-project constraint,
and the actions write it service-role without checking. The sweep then joins tasks
on id alone while resolving the Blocked status from the deliverable's project — so
cron writes a foreign project's task, hourly. And resolveHoldsUpContext reads task
titles by id through the admin client, so another workspace's task title can render
as a "holds up" label in this client's portal. Its own doc comment says that cannot
happen.

**And flag_assumption_atomic checks three of the four client gates.** Not portal,
not visibility, not client-ness — those are all there. It misses client_visible,
the one the table's own SELECT policy applies.

That is the fifth occurrence: F006b reads, F006i writes, F006k a new column, F006l
paths bypassing RLS, F009b a second approval path, now this. Every instance was
fixed correctly and the class kept generating new ones, because the gate is a
checklist a human must remember at each new call site. Patching the sixth instance
would be the same mistake as patching the fifth.

So F016d's real deliverable is a single shared predicate every client-callable RPC
calls, so that there is exactly one place left where this can be got wrong and
writing a new client RPC without it becomes visibly odd rather than invisibly
normal.

Opened F016c (blocker) and F016d (the shared gate + the fifteen unpinned
client_requests columns). The remaining majors — AS-003's badge/view mismatch,
AS-048's created_by scoping, re-quote duplicating scope items, and the sweep
re-blocking a manually unblocked task — follow in F016e.
- F016c COMPLETE — composite FKs client_deliverables(task_id, project_id) -> tasks(id, project_id) and the same for phase_id, backed by new unique(id, project_id) constraints, with PG15 "ON DELETE SET NULL (col)" so project_id is not nulled. Sweep join scoped, both admin reads in resolveHoldsUpContext scoped, defence-in-depth validation in the actions. Existing rows checked for cross-project pairs before applying — none found.
  The worker found something the reviewer did not: phase_id had the identical defect. It fixed both rather than only the one it was pointed at, and it repaired two more filter-discarding mocks while it was in that file.

## Decision rules for the unattended run (2026-09-04)

The user has gone to sleep and asked me to finish autonomously. Recording the
rules I will apply, so the calls I make overnight can be audited rather than
guessed at.

**What stops a milestone:** a blocker, or a major that lets a client read or
write something they should not. Those get remediated before the next milestone
starts, however many rounds it takes.

**What does not stop a milestone:** cosmetic defects, thin test coverage on a
read-only surface, a wrong error message, defence-in-depth that has no live
exploit. Those get opened as specced follow-up features and recorded, not chased.
Three gates have now taught me that a reviewer will always find more if asked to
keep looking; the judgement is which findings are worth a worker session tonight.

**Where I will not compromise:** anything a client can reach. This mission's
entire premise is that a client is a limited participant inside a workspace built
for colleagues, and every serious defect so far has come from that boundary being
newer than the code around it.

**If a gate fails three times on the same class**, I will stop patching instances
and change the structure instead — as F016d is doing now. Two rounds of the same
finding is bad luck; three is a design problem.

**What I will not do:** mark a milestone passed because the remaining findings
are inconvenient, report a percentage I have not counted with a command, or leave
a deferred item unowned. If I run out of useful work before the mission is
complete, I will say so plainly rather than manufacturing activity.
- F016d COMPLETE — public.client_gate() extracted (migration 20261001010000) and six client-callable RPCs routed through it with per-call flags: flag_assumption_atomic (closing AS-046's missing client_visible check), mark_deliverable_delivered_atomic, decide_approval_atomic, assert_portal_task_actionable_by_client, accept_client_request_atomic, send_change_request_quote_atomic. Plus a BEFORE UPDATE trigger on F006k's pattern pinning F016's twelve triage/decision columns against author writes, with a transaction-local bypass for the two legitimate SECURITY DEFINER writers. 109 tests.
  This is the first fix in the mission aimed at a class rather than an instance. Five times the same gate was applied in some places and forgotten in another; there is now one predicate to forget, and forgetting it means not calling a function that every sibling RPC calls — visible in review rather than invisible.
- F016e COMPLETE — one unified deliverables-past-due query serving both the badge and the view (AS-003), change requests scoped by project in RLS rather than by created_by so two people from one client company see the same picture (AS-048), re-quoting withdraws the prior approval with a partial unique index making the scope-item insert idempotent, and the sweep records swept_at so a human's decision to unblock outlasts the next cron tick. The test named for that case now actually re-runs the sweep. Migration 20261002010000.

### M3 re-scrutiny: three blockers. One of them is a call I got wrong in M1.

Report: missions/20260903-portal/milestones/M3-scrutiny-2.md

The cross-workspace blocker is genuinely closed, and verified properly this time:
the reviewer read pg_get_constraintdef and pg_constraint.confdelsetcols on the
APPLIED catalog and executed cross-project writes inside rolled-back transactions
rather than reading the migration text. The PG15 ON DELETE SET NULL (col)
construct does exactly what F016c believed.

**Blocker 1 — the class moved from UPDATE to INSERT.** F016d's guard trigger is
BEFORE UPDATE only, and client_requests_insert_own pins none of the thirteen
triage columns. A client can POST a request with client_decision='approved',
defeating AS-047's gate outright, and can set approval_request_id to hijack the
sync trigger into writing their own text into project_scope_items. Sixth
occurrence of the same class, in the one shape nobody had checked.

**Blocker 2 — the default ACL, which I deferred in M1 and should not have.**
`revoke all ... from public` does not remove Supabase's default per-role grants.
pg_default_acl here is {postgres=X, anon=X, authenticated=X, service_role=X}, so
sweep_overdue_blocking_deliverables — SECURITY DEFINER, zero authz — is callable
by anyone with the publishable key, and purge_task, which has no internal check
at all, hard-deletes any trashed task in any workspace.

F006d found this in M1. I read it, judged it "likely harmless because most
functions check auth.uid() internally", noted that "likely is doing real work in
that sentence", and deferred it. The judgement was wrong in the way that matters:
I reasoned about the population and never checked the exceptions. Two functions
in that population have no check at all and one of them is destructive.

Round 1 of this milestone's own review also asserted the sweep was "granted to
postgres, service_role only" — wrong, and it agreed with my earlier conclusion,
which is exactly when a wrong belief is hardest to dislodge.

**Blocker 3 — F016e over-corrected.** swept_at is never reset and is stamped on
every overdue deliverable of a task rather than the one acted on, so a task that
should be re-blocked for a second deliverable never is. It also silently reverted
send_change_request_quote_atomic off client_gate one migration after F016d put it
there, and dropped F016c's project join predicate while leaving F016c's comment
claiming it.

Opened F016g (the ACL blocker — running first, because an anon-reachable
destructive function is the worst thing on this list), then F016f (the INSERT
hole and the two silent reverts), then F016h (sweep semantics and the two
assertions whose render paths have no tests).
- F016b COMPLETE (bd46b0e) — raise_change_request_from_assumption_atomic matching accept_client_request_atomic's existing team-writer gate rather than inventing an authorisation surface, a button on flagged assumptions opening F016's unmodified QuoteDialog pre-filled, and the sync trigger extended to invalidate the originating assumption when the quote is approved. 5 tests. The item deferred twice now exists.
  It also surfaced a stale failing test (client-requests-rls, out of date against F016e's intentional RLS widening). Folded into F016f rather than left as known-failing noise.
- F016g COMPLETE (a8ea497) — EXECUTE revoked from public, anon and authenticated on all existing functions AND on future defaults, with the deliberate call surface restored explicitly (57 functions, 19 also to anon) after verifying each against explicit grants, .rpc() call sites, RLS policy qual/with_check bodies and CHECK constraints. purge_task given an owner-only internal check mirroring canPurge. The sweep left callable only by postgres and service_role. Full before/after pg_proc audit in the handoff.
  The part that justifies the caution I asked for: two functions broke quietly and were caught only by running the suites, not by reading — is_project_client is used INSIDE RLS policy bodies, and is_valid_timezone inside a CHECK constraint. Neither appears as a .rpc() call site, so a grep-only audit would have shipped a database where inserts fail at runtime. This is the class of fix that breaks things silently, and it did.
- F016f COMPLETE — the triage-column guard extended to BEFORE INSERT OR UPDATE, closing the AS-047 INSERT bypass; send_change_request_quote_atomic restored to client_gate with a unit test that asserts the function body calls it, so a third silent revert fails a test rather than passing review; the sweep's project join predicate restored so code and comment agree; the stale RLS test updated to F016e's intended behaviour with a real negative case added rather than just relaxed.
- F016h COMPLETE (24650a1) — swept_at made per deliverable-task pair with a trigger clearing it on acceptance, waiver or a due-date change, so a task swept for one obligation is still blockable by the next; isDeliverablePastDue extracted so the badge and the view share one classifier; the missing "Expired" branch added to quoteStateLabel. 22 new tests, and the worker verified every one fails against the exact mutation named in the review before reverting it to passing. **M3 remediation complete.**

### M3 third gate: one blocker, three majors. Much closer, and both findings are instructive.

Report: missions/20260903-portal/milestones/M3-scrutiny-3.md

**F016g did not break anything** — and the reviewer earned that conclusion:
it checked every non-.rpc() invocation path against the applied catalog (column
defaults, generated columns, CHECK constraints, index predicates, view bodies,
RLS USING/WITH CHECK, other functions' bodies, PostgREST computed columns,
dynamic SQL, pg_cron) and confirmed no dynamic SQL exists anywhere, so nothing
is invisible to a static scan.

**But its forward-looking half is a no-op.** `alter default privileges ... revoke
execute on functions from public` removes nothing, because Postgres merges the
stored default ACL with the built-in EXECUTE TO PUBLIC. Proven, not inferred:
F016h's own new function is anon-executable today, and a throwaway function in a
rolled-back transaction reproduces it. Exposure today is nil because that
function returns `trigger` — but every function M4 adds is anon-callable unless
its migration remembers, and M4 adds functions that read billable hours. Blocks
starting M4, not M3's assertions.

**Seventh instance of the class.** client_requests.origin_assumption_id, added by
F016b, is client-writable at INSERT, missing from F016f's guard list, and
dereferenced with no project predicate — the exact shape F016f closed one
migration earlier.

The pattern is now clear enough to name precisely. F016d fixed the RPCs
structurally and no RPC has regressed since. F016f extended the guard to INSERT
and that held. What neither did was make the guard's COLUMN LIST self-maintaining
— it is still a hand-written enumeration, so any migration adding a column opts
out of protection silently, and F016b did exactly that within a day. So F016j
inverts it to an allow-list, and F016i replaces "someone must remember to revoke"
with a catalog-derived test that fails in CI.

All three round-2 blockers confirmed closed. Nothing reverted again.
- F016i COMPLETE (432839d) — the reviewer's proof verified live first, then F016g's no-op default-privileges statement replaced with a ddl_command_end event trigger on CREATE FUNCTION that revokes public/anon/authenticated EXECUTE the first time a function's oid is seen, tracked in a table backfilled with all existing functions so CREATE OR REPLACE on an already-granted function is left alone. Event triggers turned out to be permitted here. clear_client_deliverable_swept_at retro-fixed.
  The catalog-derived test earned its place immediately: on its first run it caught a real bug — the event trigger function's own grants — and a pre-existing unrelated anon grant on is_valid_timezone, which the worker allow-listed with a documented follow-up rather than blind-revoking something outside its scope. "Someone must remember" is now "CI says no".
- F016j COMPLETE — the client_requests author-write guard inverted from a hand-enumerated deny-list to an allow-list computed against live pg_attrdef, which automatically protects origin_assumption_id, kind, severity and eight previously-unguarded columns; a project predicate added where origin_assumption_id is dereferenced; F016b's insert wrapped in the existing bypass flag. The regression test adds a column via raw SQL inside a rolled-back transaction and proves the guard covers it without being edited.
  That test is the thing that ends the class. Seven instances came from a list a human had to remember to update; the list now updates itself and a test proves it.
- F016k COMPLETE (e60791f) — the AS-003 tautology fixed by making the badge call isDeliverablePastDue in TypeScript rather than re-expressing it as PostgREST filters, with the joint test now exercising both real surfaces and verified to fail when either is mutated alone; both untested swept_at clearing branches covered, with the failure proven by mutating the trigger on the live database and then reapplying the migrations in order; the client_gate guard made behavioural, verified to fail when the gate's flags are neutered rather than only when the call is deleted.
  On `waived`: the worker chose to give it its action rather than delete it — accept_deliverable_atomic now takes 'waived' and the panel has a Waive button. Right call. A PM deciding not to chase an obligation is a real thing, and the enum was describing a gap in the product rather than dead code.
  **M3 remediation complete across all three rounds.**

### M3 fourth gate: one blocker, and it is the sharpest finding of the mission

Report: missions/20260903-portal/milestones/M3-scrutiny-4.md

Everything I asked about is clean — the event trigger fires and revokes on new
functions, leaves CREATE OR REPLACE ACLs intact, is postgres-owned so only the
owner can disable it, and rolls back with an aborted transaction; the allow-list
guard self-maintains against a column added in a rolled-back transaction; the
waived branch sits after all of accept_deliverable_atomic's gates.

**But F016i's own bookkeeping table has no RLS.** public.f016i_gated_function_oids
is the only RLS-less table in public, with anon SELECT/INSERT/UPDATE/DELETE live
over PostgREST — proven over the wire, not inferred: an anon-key POST with
{"oid": 999999} returned 201, and the probe row was deleted again. Anon inserting
plausible future oids makes the event trigger skip those functions, so every
function a future migration creates stays anon-executable. The hole F016i closed,
reopened through the state F016i created to close it.

What this is an instance of, and the reason I am recording it rather than just
fixing it: F016i audited functions, because functions were its subject. The table
it created in order to perform that audit was not in scope of anything — not its
own test, not the three review rounds before it. Four gates have asked "is this
change correct?" and none has systematically asked "what did this change add that
nothing is now checking?"

M4 and M5 add tables of their own. That question goes into their gates.

Keeping M4 running rather than rolling back — the fix is one migration and touches
nothing M4 builds on, which the reviewer verified before recommending it.
- F017 COMPLETE — project_budgets with a btree_gist exclusion constraint rejecting overlapping periods, time_entries.work_category, and the two separate RPCs the spec insisted on: project_hours_team with full entry detail, and project_hours_client which structurally never selects any tasks column, so AS-037 holds by construction rather than by filtering. 13 new integration tests.
  It also found a real gap in F016i's guard, exposed by its own CREATE EXTENSION btree_gist: the event trigger does not fire for extension-installed functions, and postgres lacks privilege to revoke on supabase_admin-owned objects. Documented in the migration and allow-listed in the catalog test with justification rather than silently excluded. F016i's test caught it — which is what that test exists for.
- F016l COMPLETE — RLS enabled and anon/authenticated grants revoked on f016i_gated_function_oids, plus a catalog-derived test asserting no public table lacks RLS, with wire-level anon-key rejection proofs for all four verbs. **M3 blocker closed; M3 remediation complete across four rounds.**
- F018 COMPLETE — project budget CRUD with viewer/client write rejection, work_category editable in place and defaulted from the task, a team hours view marking the billable/client-visible subset so a PM can see what the client sees without switching context, and a daily idempotent threshold sweep notifying leads once per project/threshold/period with per-row exception handling so one bad project cannot silence the rest. Migration 20261012010000.
- F019 COMPLETE — portal Hours view: four tiles, the inline-SVG burn-down (solid brand Used with area fill and a labelled endpoint, dashed muted Planned, labelled budget ceiling, legend, one shared crosshair tooltip, honest degenerate cases), single-hue by-category bars, by-month table. Grep-confirmed that nothing under app/(portal) or components/portal imports the team hours query — the separation F017 built structurally is now verified at the import layer too.
- F020 COMPLETE (61b57fa) — project_metrics, metric_snapshots, project_improvements, projects.baseline_frozen_at and a NAMED-FIELD freeze trigger (F011b's lesson applied rather than repeated), the team Measurement panel, and a non-blocking phase-2 exit warning. 24 tests including the client_visible-absence failure test and the F016i/F016l catalog suites as side-effect checks.
- F021 COMPLETE (bd5e44c) — portal Results view: before/now/target bars honouring `direction` so a regression is drawn and labelled as one rather than hidden, an honest "not measured yet" state instead of a zero bar, an improvements list that reads without images and shows them when they exist, and the baseline-frozen header line. **M4 COMPLETE.**

## M4 gate

### M4 gate: three blockers. The class has an eighth instance, and it shows what we missed.

Report: missions/20260903-portal/milestones/M4-scrutiny.md

Money and privacy are clean, and the reviewer verified it properly: project_hours_client
builds an explicit three-key jsonb per row, never selects a task column, note or user
id, its error branch is a constant string, both RPCs are anon-non-executable, the team
RPC refuses is_project_client, and F019's grep claim holds across the whole portal tree.
The M3-round-4 question — what did this milestone add that nothing checks — came back
negative: no RLS-less table, no new bucket, all four new tables carry the two-tier policy
shape with pg_temp pinned.

**B1, verified:** the hours page asks for 2000-01-01 to today while sold_minutes comes
from one budget by overlap. A project with a closed 2025 budget and a current 2026 one
reports Used 45h, Remaining 0h, "+5h Over". Wrong in the direction that starts a false
overrun conversation, which is the most damaging thing this particular view can do.

**B2, verified:** F020 added projects.baseline_frozen_at and did not extend F006k's
projects guard — zero occurrences in that migration. projects_update_active_members has
no role restriction, so a client or viewer can PATCH baseline_frozen_at to null and the
freeze that the entire Results view rests on is gone.

That is the eighth instance of the class, and this one shows what we actually missed.
F006k's own sweep of "every column this mission added to a pre-existing table" came back
clean — because F020's column did not exist yet. F016j then solved this properly for
client_requests by inverting its guard to an allow-list computed from the live schema.
**We never applied that inversion to projects.** One table became self-maintaining, the
other stayed a list somebody has to remember, and the very next column added to it walked
straight through.

**B3, verified:** the improvement calculation never compares measured_at to baseline_at —
zero references. A snapshot from before the baseline renders as "Improved" in green. And
the AS-041 test passes arguments that omit the field the assertion turns on, so it cannot
fail for its own reason. Sixth test in this mission incapable of failing for the thing it
names.

Opened F020b (invert the projects guard — the structural fix, not the patch), F021b
(hours period scoping) and F021c (pre-baseline snapshots plus three majors).
- F021c COMPLETE (960dcec) — deriveMetricMeasurementStatus now compares measuredAt to baselineAt, with the fix's test verified to fail when the comparison is removed and then reverted; the sweep's project_id UPDATE moved inside its per-row exception block with a RAISE WARNING for leadless projects rather than silence; results/page.tsx renders a failed metrics read as an error state instead of "nothing measured yet".
  The worker also caught and corrected an accidental commit of a concurrent worker's staged files — the same mistake I made myself earlier in this mission, found and fixed by the agent that made it rather than by a later review.
- F022 COMPLETE (ecbac6f) — project_links (client_visible default false, so a link added in a hurry does not reach the client), project_accounts (default true, since that table answers "what do I actually own"), a shared looks_like_credential CHECK on the free-text fields, and docs.client_visible/doc_kind added through an ADDITIVE client SELECT policy that leaves the existing team docs RLS — written to close a real leak — untouched. 27 integration + 12 unit tests; the existing docs RLS suite passes unchanged, which was the thing most at risk.
- F021b COMPLETE — project_current_budget_period RPC picking exactly one period (current, or most recently ended), and the portal hours page plus lib/queries/hours.ts scoped to that period's own bounds instead of the unbounded 2000-01-01 window. The fixture reproduced the defect first — 2700 minutes reported where the truth was 300 — and then confirmed the fix. That reproduction is why this feature is trustworthy: the defect was invisible to every single-budget test, which is exactly how it shipped.
- F023 COMPLETE — portal Your site view: links with a muted mono destination label and rel="noopener noreferrer", the launch-day card, the accounts table that answers "what do I actually own", and the training-doc guides list. warranty_until/warranty_terms added and role-gated through the EXISTING F006k trigger rather than a new mechanism — the worker read the trigger before adding the columns, which is precisely what F020 did not do and what F020b now exists to fix. The temporary Files sidebar entry from F006e removed and reached from this view instead, as its comment instructed.
- F020b COMPLETE (54023bb) — the projects field-role trigger inverted into a self-maintaining pg_attrdef allow-list mirroring F016j's technique, extended to BEFORE INSERT OR UPDATE, baseline_frozen_at folded into the writer bar, and F020's freeze trigger extended to guard project_metrics.direction and to block DELETE of a baseline-carrying metric on a frozen project — closing the delete-then-reinsert bypass as well. 13 new tests plus F006k, F020 and F021b's suites.
  Both hand-written column guards in this codebase are now self-maintaining. The class that produced eight instances required a human to remember a list; neither list needs remembering any more.
  **All three M4 blockers closed.**
- F024 COMPLETE — client preview implemented the way the spec demanded: a REAL Supabase session minted for the chosen client via admin.auth.admin.generateLink (the mechanism app/dev-login/route.ts already uses), stored in /portal-path-scoped cookies, so the existing portal route tree is served by the client's own RLS-backed session. No previewAsClientId parameter anywhere. Picker route, non-dismissable banner, "View as client" shortcuts in the task sheet and doc editor, audit row on every entry. 17 tests.
  For the final gate: minting a real client session for an admin raises a question the spec did not — whether a previewer can ACT as the client, for instance approve an approval on their behalf. That would be worse than the leak this feature prevents. Flagged for the M5 gate rather than assumed either way.
- F025 COMPLETE (d86cc12) — two derived suites: the table triple-sweep deriving its list live from information_schema for every client_visible-bearing table and failing if one has no fixture, and the route walk that walks app/(portal) for every page.tsx, statically derives which query functions each route imports, calls them as a real client session and scans the SERIALISED payloads for planted leak markers. Both carry the required proof that they can fail. ~11.6s combined.
  It found a real leak on its first run and, as instructed, documented it rather than patching: client_requests.quoted_amount has no read gate separating a price the team is still thinking about from one actually sent. Opened as F025b.
  The way it was found is the argument for the whole feature: the sweep planted a value in a field nobody had thought to check, and the payload assertion caught it. Four leaks in this mission arrived through exactly that shape, and this is the first one caught by a test rather than by a reviewer.
- F025b COMPLETE — an explicit quote_sent_at column written only by send_change_request_quote_atomic, and a security_invoker view masking the five quote columns for a client caller until it is set, with the portal's only client-reachable read pointed at the view and the base table left intact for the team and the RPCs. The worker rejected approval_request_id as the "sent" signal for a grep-verified reason: F016f NULLs it during re-quoting for unrelated bookkeeping.
  It also found that F025's own sweep had a parser gap which meant getProjectChangeRequests was never actually called — the sweep was passing vacuously for the exact function this leak lived in. Seventh vacuous test in this mission, and the first found by a worker rather than a reviewer.

### F025b's side-effect run found two functional regressions, one of them mine

- **F020b's allow-list guard blocks accept_client_request_atomic's own task insert**,
  because the tasks insert trigger bumps projects.task_counter and the guard raises
  "task_counter cannot be changed directly". Accepting a client request — a core flow —
  fails today.

  This is my error. F020b was my structural fix for the eighth instance of the
  missing-guard class, and I specified its allow-list in terms of what a human member
  may write, without accounting for what the application itself writes through
  triggers. F016j's equivalent guard had already solved that with a transaction-local
  bypass for its legitimate SECURITY DEFINER writers; I did not carry that requirement
  into F020b's spec.

- **notifications_kind_check rejects the kind decide_approval_atomic writes**, so
  deciding an approval raises inside the RPC. If that insert shares the transaction, a
  client clicking Approve gets an error and nothing is recorded.

Opened F025c. Both are blockers: they are core flows, not edge cases.
- F025c COMPLETE — a transaction-local app.projects_field_guard_bypass flag set by assign_task_number() around its task_counter UPDATE, using F016j's technique rather than widening the allow-list by hand; and notifications_kind_check restored to include approval_decided and assumption_flagged.

### The second regression was worse than reported, and it was also ours

The worker established what I asked it to establish first: the notification insert
DOES share decide_approval_atomic's transaction. So the missing kinds meant every
Approve click rolled the entire decision back. A client pressing Approve got an
error and nothing was recorded — the worst outcome this system has available, and
precisely the failure AS-023 exists to forbid.

And the kinds were not missing by omission. **F018's migration silently dropped them
from the check constraint.** That is the third time in this mission that one feature's
migration has quietly undone another's, after F016e's two reverts. The pattern is
specific: a migration that re-creates a constraint or function to change one thing,
written from the author's mental model of what it contains rather than from what it
actually contains.

Worth stating plainly: AS-023 has been false since F018 landed, and no gate caught
it — three scrutiny rounds ran over that period. It surfaced from a side-effect test
run in an unrelated feature. The lesson is not about F018; it is that re-creating a
database object from memory rather than from its current definition is a move this
codebase punishes, and it has now punished it three times.
- F009d COMPLETE — the approvals immutability trigger inverted from a four-column deny-list to a two-column allow-list (updated_at, resulting_task_id), grep-verified against every UPDATE call site, with NO service_role exemption since that was the hole; and the "no decision owner" refusal split out of the shared not-found oracle so the legacy Approve control now says "No one is assigned to decide this yet." matching the Approvals view's wording, instead of "Something went wrong."
  All three column guards in this codebase — client_requests, projects, approval_requests — are now allow-lists derived from the live schema. **All planned features and all remediation are complete.**

## Final gate

### Final gate, first finding: the F025c bug on the INSERT branch

projects_assign_key is a BEFORE INSERT trigger that populates projects.key, `key`
is in none of the allow-list's four tiers, and its schema default is ''. Postgres
fires same-timing row triggers in name order and projects_assign_key sorts before
the guard, so the guard sees a populated key, compares it to '', and raises.
Any project creation through an authenticated session fails.

Two masks kept it invisible, and both are worth recording:

- The product creates projects with the service-role client, which the guard's
  first branch exempts. The shipped path never touches it.
- The only INSERT test asserts `expect(error).not.toBeNull()`, so it passes
  whether the error is the one it names or this one — and the suite's own fixture
  project is created with the admin client, so nothing ever performs a clean
  authenticated INSERT.

That second mask is the eighth vacuous test in this mission, and a new species of
it: not a test that cannot fail, but one that cannot tell which failure it caught.

The review also cleared the other two guards properly rather than by inspection —
it enumerated every non-plain writer of approval_requests and client_requests,
found each either pending-scoped, allow-listed or bypass-wrapped, and established
that accept_client_request_atomic is safe structurally (its acceptor set and the
author set are disjoint by role) rather than incidentally. That is the standard of
answer I have been asking for all mission.

Opened F025d.

### Final gate: the parent stalled, two children reported

The gate agent stalled waiting on its own children; two of them completed and
their findings stand on their own. Questions 1, 2 and 5 — whether a previewing
admin can ACT as the client, preview session hygiene, and spot-checking three
assertions — went unanswered and are being re-run focused.

**M5 audit: no blocker.** It verified the good parts properly rather than by
inspection: RLS enabled on both new tables with all four conjuncts in the client
policies, pg_temp pinned on every predicate, no client write path at either the
policy or the action layer, the view genuinely security_invoker with no anon
grant, and every quote-column read going through it. It also noted the one place
this mission's recurring "new column walks through the guard" defect was actually
avoided: F020b computes unknown columns generically, so F023's warranty fields
were covered without anyone remembering them.

Two majors, both the same gap from two sides:

- The portal's guides, links and accounts queries rely on RLS alone, where every
  sibling query in this codebase is double-guarded — and one of those siblings
  explains in its own comment why the explicit filter exists. Not a live leak;
  the layout redirects non-clients and F024's preview uses a real client session.
  But three functions whose payload carries a staging URL and an account ledger
  are standing on one guard.
- The AS-054 sweep disables its `docs` RPC leg with a comment that was true when
  F025 was written and that F023 made false. The one table whose production query
  lacks its own filter is the one whose third leg is switched off.

And the AS-049/050/051 tests re-implement the query inline rather than calling the
production function, so they would stay green if it regressed. Ninth vacuous test,
familiar species.

Opened F025e.

### F024 review: YES, a previewing admin can act as the client. Blocker.

Report: missions/20260903-portal/milestones/F024-preview-review.md

Next.js Server Actions POST to the URL of the page that invoked them, so an action
fired from any /portal/* page carries the path-scoped preview cookies, and
createClient() returns the impersonated client INSIDE the action rather than only
inside the render. Nothing consults those cookies except the banner. Every portal
write path is reachable: approve, request changes, decide an approval, flag an
assumption, deliver a deliverable, create or withdraw a request, comment — each
attributed to the client.

decideApproval is the worst of them: it has no application-level authorisation at
all, the entire check being the RPC's auth.uid() decision-owner test, which the
impersonated session satisfies by construction.

**This is worse than the leak F024 exists to prevent.** The decision log is the
artefact AS-023, AS-024 and AS-026 exist to protect, and its whole value is that it
records what the client decided. A feature built to make the team trust the
visibility model instead handed them the ability to forge the evidence, while the
audit log shows only that an admin opened a preview.

The gap is in my specification. I wrote F024's spec entirely in terms of what a
previewer can SEE — the prohibition on filter-based fakes, the banner, the audit
row — and never once said what they must not DO. The worker implemented what was
asked, correctly. Nine milestones of insisting that authorisation belongs in the
database rather than the UI, and I specified a feature whose entire risk was that
it would pass every database check.

Two more from the same review: sign-out under preview revokes the real CLIENT's
Supabase session while leaving the preview cookies and the admin's session intact;
and AS-053 fails open, because writeAudit swallows errors and the row is written on
start rather than on entry, with no cookie TTL.

Opened F024b. The fix is a default-deny assertNotPreview() seam every portal action
routes through — default-deny because this mission has eight instances of the
opposite arrangement and every one of them eventually fired.
