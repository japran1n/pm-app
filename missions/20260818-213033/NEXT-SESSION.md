# Next session — start here

_Written 2026-08-23, end of a long session that closed out M15's scrutiny cycle.
Read this file first; run-log.md's bottom entries give full detail on anything
summarized here._

## Mode for this session

**Work autonomously. Do not ask the user questions and do not wait for
confirmation.** Make reasonable decisions yourself, document them in the
run-log, and keep going. The user wants to walk away and come back to
finished work.

## Where things stand

- **M10–M14: complete.** (M10 had 5 scrutiny follow-ups, all landed. No
  milestone in this mission has ever had a formal UX-validator pass — see
  "Process note" below.)
- **M15 (Collaboration): effectively done — 41/47 COMPLETE, 5 `[SKIPPED]`
  (F213–F217, email/Resend, the user's own 2026-08-18 decision), 1 open
  (F323, below).** It went through **six** adversarial scrutiny passes
  producing 23 follow-up features (F301–F323). Every blocker-severity
  finding across all six passes is fixed and independently verified —
  including six real security holes and two data-loss bugs. The user then
  explicitly **capped the cycle**: 23 majors and 17 minors from pass 6 are
  deliberately NOT being fixed, and stay recorded in
  `missions/20260818-213033/milestones/M15-scrutiny.md` for later. M15 is
  honestly recorded as NOT formally GREEN. **Do not reopen the M15 scrutiny
  cycle.**

## Task 1 — F323 (do this first, it's a known open security hole)

`F323 enforce-private-project-access-in-sibling-action-files-and-read-paths`
— AS-227, AS-228, AS-229. Already in plan.md.

F322 (last session) fixed a real privilege escalation: single-task mutation
actions in `lib/actions/tasks.ts` wrote through the service-role admin client
(which bypasses RLS) while checking only workspace membership + role, never
whether the caller could SEE the task's project — so a workspace member off a
private project could edit/delete its tasks. F322's audit then found the
**identical pattern in eight sibling files, still unfixed**:

`lib/actions/checklist.ts`, `comments.ts`, `dependencies.ts`,
`attachments.ts`, `watchers.ts`, `time-entries.ts`, `comment-reactions.ts`,
`purge.ts`

Plus a **read-side leak**: `getTaskDetail` and `getOpenBlockers`
(lib/actions/tasks.ts) also use the admin client and check only workspace
membership, so any workspace member can READ a private project's task detail.

**How to fix:** reuse `isProjectVisibleToCaller` (the helper F322 added in
`lib/actions/tasks.ts`) — export it or move it somewhere shared; do NOT write
a third/fourth copy of the rule. Read F322's handoff
(`missions/20260818-213033/handoffs/F322-handoff.md`) for the full reasoning
and its test structure, and mirror both. For the read path, return the
existing "Task not found" convention rather than a permission-denied message
(a read leak shouldn't even confirm the task exists).

**Tests must drive the real Server Actions, not raw RLS-scoped queries** —
that's exactly why `rls-project-visibility.test.ts` missed this entire bug
class. Per action: outsider-rejected-AND-DB-genuinely-unchanged /
owner-succeeds / explicit-project-member-succeeds / workspace-visible-project
regression. F322's `tests/integration/f322-single-task-project-visibility.test.ts`
is the template.

## Task 2 — M16 (Views), F218 onward

23 features: custom statuses, swimlanes, saved views, My Tasks, calendar,
timeline. Read each feature's spec under `missions/20260818-213033/features/`
and its clarification under `clarifications/` before delegating.

**Note:** F218 (custom statuses) is a dependency several M14 features
explicitly deferred against — e.g. F184's project-from-template. Once F218
lands, revisit those features' "Out-of-scope" notes for what needs extending.

## The working loop (unchanged, follow it exactly)

For every feature: **spawn a worker → verify independently → log → commit.**

The orchestrator never writes project code — always spawn a worker (tell it
to read `.claude/agents/worker.md` first). After every worker:

1. `git status` and read the actual diff — don't trust the handoff's summary.
2. Run `npx tsc --noEmit` and `npx eslint .` **yourself**. Workers have
   claimed "clean" when it wasn't (caught for real in F304).
3. Run the relevant tests yourself, including a broader regression slice
   across any shared file the change touched.
4. Only then: log to `run-log.md`, tag `[COMPLETE]` in `plan.md`, commit.

## Process note on milestone validation — READ THIS

M15's scrutiny cycle ran **six passes and generated 23 follow-up features**.
It found genuinely serious bugs, so it wasn't wasted — but passes 4 and 5 each
found a bug *introduced by the previous pass's own fix*, which is the signal
that churn was starting to generate its own defects.

**For M16, cap it upfront:** run the scrutiny validator, fix blockers only,
run it a second time, fix any new blockers, then move on regardless of what
majors remain (record them, don't fix them). Do not run a third pass. Apply a
strict bar for "blocker": security holes, data loss/corruption, or an
assertion flatly unmet in normal use — not test-quality gaps, polish, or
theoretical fragility.

Also: no milestone in this mission has ever had a **UX-validator** pass. That
is probably worth more than another round of code review — consider running it
for M16 once scrutiny is settled.

## Known infra conditions (not code bugs — don't chase them)

The linked Supabase project has been under heavy load all session. Expect:

- **Supabase Auth rate limiting** — `auth.admin.createUser` intermittently
  slow (observed up to 200s) or failing with "Request rate limit reached".
- **`JWT issued at future`** clock-skew errors under concurrent test runs.
- **`PGRST002`** (PostgREST schema-cache) outages — the REST layer only;
  direct Postgres via the Supabase CLI kept working throughout. If PostgREST
  is down, the Management API SQL endpoint is a working fallback — see
  `tests/integration/overdue-notification-sweep.test.ts` for the pattern.

**Always re-run a specific failing file alone before concluding it's a real
regression.** It usually isn't. But don't reflexively assume it never is —
this session found several genuine regressions that way too.

`vitest.config.ts` already has `hookTimeout: 30_000` and `maxWorkers: 4` to
reduce this contention (F312).

## Hard-won lessons worth keeping

1. **"Built but not wired to real data"** recurred repeatedly (F167, F179,
   `getTaskDetail`'s comment metadata, the mention picker). Always verify the
   REAL read/write path end-to-end, not just that a feature's own isolated
   tests pass. Tests that hand-build props instead of exercising the real
   fetch will not catch this.
2. **Workers sometimes claim "tsc/eslint clean" when it isn't.** Run it
   yourself, every time.
3. **Watch `p_system`-style "is this a real backend caller" flags.** Two
   separate SECURITY DEFINER functions shipped with a caller-controlled
   boolean that skipped auth checks when true. The correct pattern is
   `<flag> and auth.uid() is null`, never a bare `<flag>`.
4. **Actions using the admin client bypass RLS** — that's the whole point of
   F322/F323. Any action writing or reading through `createAdminClient()`
   must re-check authorization in application code. RLS will not save it.
5. **Trust but verify.** This session repeatedly caught real defects that a
   worker's own handoff claimed were fixed.

## Also open (low priority, not blocking)

- `tests/unit/trash-list.test.tsx` is a pre-existing **M14** regression
  (F189's `TrashRestoreButton` needs a router mock). Red across several
  scrutiny passes. Small fix, worth picking up.
- An unhandled `cookies() was called outside a request scope` rejection from
  `getMentionCandidates` in test rendering — noisy, fails nothing.
- **F278 needs the USER** to add 3 GitHub Actions repository secrets before
  CI goes green. The orchestrator cannot do this. Don't try; just leave it.
