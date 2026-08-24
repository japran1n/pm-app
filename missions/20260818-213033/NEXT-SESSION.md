# Next session — start here

_Written 2026-08-24, at the end of a long autonomous session that closed F323
and the whole of M16. Read this file first; the bottom of `run-log.md` has full
detail on everything summarized here._

## Mode for this session

The previous session ran **fully autonomously** at the user's request — no
questions, no waiting for confirmation, decisions documented in `run-log.md`
and work continued. Assume the same unless the user says otherwise.

## Where things stand

- **M10–M14: complete.**
- **M15 (Collaboration): effectively done** — 41/47 COMPLETE, 5 `[SKIPPED]`
  (F213–F217, email/Resend, the user's own 2026-08-18 decision). Its scrutiny
  cycle ran **six** passes and was then **capped by the user**: 23 majors and
  17 minors from pass 6 are deliberately unfixed and recorded in
  `milestones/M15-scrutiny.md`. **Do not reopen the M15 scrutiny cycle** —
  that is a standing user decision.
- **F323 (the private-project security hole M15 left open): DONE and
  verified.** Real vulnerabilities fixed in `comments.ts`, `attachments.ts`,
  `time-entries.ts`, `dependencies.ts`, plus the two read-side leaks in
  `getTaskDetail`/`getOpenBlockers`. Note: NEXT-SESSION.md previously claimed
  all **eight** sibling files were vulnerable; that was over-broad. Four
  (`checklist.ts`, `watchers.ts`, `comment-reactions.ts`, `purge.ts`) were
  already safe — verified directly, not assumed. `isProjectVisibleToCaller`
  now lives in the shared `lib/actions/project-visibility.ts`.
- **M16 (Views): COMPLETE and closed.** All 23 planned features (F218–F240)
  plus four orchestrator-created follow-ups: **F324** (sidebar nav gap),
  **F325**/**F326** (scrutiny pass-1 blockers), **F327** (pass-2 blocker).
  **F328** additionally fixed the long-standing `trash-list.test.tsx` red.

## M16 is CLOSED — do not reopen its scrutiny cycle

Per the user's explicit instruction, M16 got **exactly two** scrutiny passes,
blockers only, then moved on. That cap was honoured. Seven blockers total were
found and fixed. **M16 is honestly recorded as NOT formally GREEN**: pass 2's
majors and minors are deliberately unfixed and preserved in
`milestones/M16-scrutiny.md`.

The two-pass cap earned its keep: pass 2's single blocker was a **regression
introduced by pass 1's own fix** (F326 tightened `project_statuses` RLS to
workspace-admin-only on a false premise, silently breaking project leads).
That is the same churn pattern that took M15 to six passes.

## Task 1 — the highest-value leftovers from M16 scrutiny pass 2

These are recorded as majors, not blockers, so they were deliberately left.
Full detail with file/line and failure scenarios is in
`milestones/M16-scrutiny.md`.

1. **MAJ-4 — do this first; it is the closest thing to a blocker still open.**
   A **viewer** can directly `POST /saved_views {scope:'shared',
   is_default:true, config:{}}` — verified live by the validator, and the
   injected row was visible to the workspace owner. Combined with the
   unparsed `config` cast, that is a **stored 500 on the project list page**:
   one viewer can break a shared surface for everyone. The `saved_views`
   INSERT policy needs the same role tightening `project_statuses` got in
   F326/F327 (reuse `is_project_lead_or_workspace_admin` /
   `is_workspace_admin`; do not write a new copy of the rule), and `config`
   needs parsing rather than casting.
2. **MAJ-3** — F325's rename trigger renames **soft-deleted** tasks too
   (confirmed live), while `restoreTask` (`lib/actions/tasks.ts` ~2031) still
   hard-codes the old four status names. Restoring a task that was trashed in
   a since-renamed column resets it to a column that no longer exists,
   leaving `status_id = NULL` and a task in no board column.
3. **MAJ-1** — the calendar mirror still cannot accept fresh server data at an
   unchanged `dataKey`, and `tests/unit/f326-calendar-day-grid-rerender.test.tsx`
   supplies its own `key` in `createElement`, so **it cannot fail if the fix is
   reverted**. Worth fixing the test even if you leave the component.

## Task 2 — the e2e harness is broken, and it blocks the UX validator

**Every authenticated Playwright spec currently fails in the shared
`loginAndGoToDashboard` helper** (`tests/e2e/theme-toggle.spec.ts:248`). I
verified this on an untouched baseline spec: 4 passed, 2 failed, both in the
login helper. It is a magic-link auth problem in the harness, not a product
bug, and it is independent of any recent feature.

This matters because **no milestone in this mission has ever had a UX-validator
pass**, and the UX validator drives the running app through Playwright — it
will hit exactly this wall. Fixing the harness is probably worth more than
another round of code review. Do it before attempting a UX pass.

## Task 3 — M17 (UX polish, attachments & navigation), F241 onward

Read each feature's spec in `features/` and its clarification in
`clarifications/` before delegating. Note **F241 is `command-palette-shell`** —
the sidebar-nav follow-up I created was renumbered **F324** to avoid that
collision, but its two git commits are still labelled "F241". Don't be confused
by that; follow-up features created outside the original plan continue the
F3xx sequence.

## The working loop (unchanged — follow it exactly)

For every feature: **spawn a worker → verify independently → log → commit.**
The orchestrator never writes project code. After every worker:

1. `git status` and read the actual diff — don't trust the handoff's summary.
   **Read the diff of any pre-existing test the worker modified**, every time.
   Several were legitimately updated this session, but that is exactly how a
   green suite hides a regression.
2. Run `npx tsc --noEmit` and `npx eslint .` **yourself**.
3. Run the relevant tests yourself, plus a regression slice across any shared
   file the change touched.
4. Only then: log to `run-log.md`, tag `[COMPLETE]` in `plan.md`, commit.

This caught **five real defects this session** that handoffs asserted were
fine. It is not ceremony.

## Hard-won lessons (updated — the new ones are 1, 2 and 3)

1. **Workers infer "tsc clean" from a green vitest run. Vitest does not
   typecheck.** Two separate workers this session (F226, F326) reported a clean
   typecheck that was failing. Always run `npx tsc --noEmit` yourself, and when
   sending a type error back, explicitly ban `as any` / `@ts-expect-error` /
   deleting the assertion — otherwise you get a suppression, not a fix.
2. **A DB trigger or constraint guarding "the last row of a set" must be
   checked against the parent's ON DELETE CASCADE path.** F219 shipped an
   AS-415 guard that made **project hard-delete impossible**; feature tests
   were fully green because none of them deleted a project. I kept a throwaway
   service-role probe (create project → confirm columns seeded → hard-delete)
   and re-ran it after every migration. Keep doing that.
3. **A fix's own migration header can assert something false about the code.**
   F326's justified excluding project leads by claiming all writes go through
   the admin client; the file it named says the opposite in its own header.
   Check the claim against the code, not the comment.
4. **"Built but not wired to real data"** — still the most recurrent defect
   class here, and it recurred again at the *navigation* level: M16 shipped the
   Calendar and Timeline with **no sidebar entry at all** (fixed in F324).
   Verify the real end-to-end path, and check the feature is reachable.
5. **Actions using `createAdminClient()` bypass RLS** and must re-check
   authorization in application code. Two more real holes in this family turned
   up this session: `task_dependencies`' SELECT **and DELETE** policies checked
   only the blocking side (fixed in `20260828020000` — the DELETE half was a
   write-side privilege escalation the validator had missed), and
   `project_statuses`' write policies checked visibility but not role, which a
   direct PostgREST call could exploit since the browser holds the publishable
   key (F326).
6. **RLS tests must drive the DIRECT PostgREST path under a real user session**,
   not only the Server Action. A Server-Action-only test is precisely what let
   the AS-414 hole through pass 1.
7. **Watch `p_system`-style "is this a real backend caller" flags.** The correct
   pattern is `<flag> and auth.uid() is null`, never a bare `<flag>`.

## Known infra conditions (not code bugs — don't chase them)

The linked Supabase project stays under heavy load. Expect **Auth rate
limiting** ("Request rate limit reached"), **`JWT issued at future`** clock
skew, **PG `57014`** statement timeouts, **`PGRST002`** PostgREST schema-cache
outages, and occasional transient network **"fetch failed"**. Direct Postgres
via the Supabase CLI kept working throughout; the Management API SQL endpoint
is a fallback (see `tests/integration/overdue-notification-sweep.test.ts`).

**Always re-run a specific failing file alone — after waiting a few minutes if
you were rate-limited — before concluding it's a real regression.** It usually
isn't. But don't reflexively assume it never is: this session confirmed several
genuine defects that way too, and once distinguished a real problem from noise
purely by the error CODE (`57014` timeout vs. `23514` check violation).

Also: **the scratchpad directory is shared with subagents.** One of them
overwrote my probe script mid-session. Use distinctive filenames.

## Current state of the suites

- `npx tsc --noEmit` — **0 errors.**
- `npx eslint .` — 0 errors, 2 long-standing warnings (`lib/queries/search.ts`,
  `tests/unit/invite-member-pagination.test.ts`).
- `npx vitest run tests/unit` — **129 files / 995 tests, fully green** (F328
  fixed `trash-list.test.tsx`, the last red, with a `next/navigation` mock —
  no assertions weakened).
- Integration tests pass, but the full suite run serially against one live
  Supabase project reliably trips Auth rate limiting. Run in slices.
- Playwright: authenticated specs all fail in the login helper (Task 2).

## Also open (low priority, not blocking)

- Saved views are wired into the **List page only** — not the board, calendar,
  or timeline. `saved_views.view_type` already accepts all four, so the schema
  is ready. A legitimate follow-up feature.
- `DashboardTaskTable` is multi-project, so its status filter still falls back
  to the legacy default four columns (not an AS-411 violation — that assertion
  is about the project List view).
- `getDependencyCandidates` reads through the admin client, so
  `20260828020000`'s two-sided-visibility fix buys it no defence in depth. Not
  a live leak (F323 already filters its returned candidates), but worth
  tightening.
- `removeColumn`'s "does this column still have tasks" count filters on
  `deleted_at is null`, so a column holding only trashed tasks fails on the FK
  with a generic error. The reassignment path handles that case correctly.
- **F278 needs the USER** to add 3 GitHub Actions repository secrets before CI
  goes green. The orchestrator cannot do this. Don't try.
