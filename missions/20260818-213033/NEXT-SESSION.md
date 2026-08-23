# Next session — start here

_Written 2026-08-23, session paused mid-work at the user's explicit request
("završi minimalno da zamrznemo milestone"). Read this file first; run-log.md's
bottom entries give full detail on anything summarized here._

## Where things stand

**M10–M14 are fully complete** (verified in prior sessions; M10 has 5
follow-up fixes landed but was never re-run through a fresh scrutiny pass to
confirm a formal GREEN — see "Known gaps" below).

**M15 (Collaboration) is NOT closed.** All 32 base features (F194–F212, +
F213–F217 deliberately `[SKIPPED]`, Resend not connected) were built, but the
milestone has failed **two consecutive scrutiny validation passes**:

- **Pass 1** (28 PASS / 11 FAIL / 2 INCONCLUSIVE, 9 blockers) — addressed by
  8 follow-up features **F301–F308, all COMPLETE and independently
  verified** (real security fixes: activity-log forgery hole in
  `write_task_activity_entry`, comment-authorship-reassignment hole,
  reactions-on-soft-deleted-comments leak, reactions-realtime cross-tenant
  leak, notification-error-swallowing, plus the "built but not wired"
  `getTaskDetail` read-path gap and several fan-out gaps).
- **Pass 2** (37 PASS / 7 FAIL / 10 DEFERRED, 5 blockers) — found F301–F308
  genuinely fixed most of pass 1's findings, but surfaced **a new class of
  defect** plus **one critical miss of my own**:
  1. **F309 — DONE, verified.** `create_notification`'s `p_system` branch
     was still unconditional (`if p_system then`, not `if p_system and
     auth.uid() is null then`) — I had fixed this exact bug class in
     `write_task_activity_entry` (F302) earlier the same session and missed
     that `create_notification` itself (which I'd also touched twice
     today, in F206 and its own earlier spoofing fix) still had it. Any
     authenticated client could inject a "System" notification into any
     workspace member's inbox. **Closed and verified** — migration
     `20260823100000_fix_create_notification_system_bypass.sql`, 13/13
     real-Supabase tests passing, confirmed F212's legitimate cron caller
     unaffected.
  2. **F310 — IN PROGRESS, UNVERIFIED. Resume here first.** The mention
     picker/chip rendering is broken end-to-end: `RichTextEditor`'s
     `getMentionItems: () => mentionSuggestions` closure is captured once
     at Tiptap `Editor` construction time (verified against
     `node_modules/@tiptap/core`'s actual source — `createExtensionManager`
     runs once in the constructor, `setOptions()` never re-runs it) and
     never updates, so typing `@` shows an empty picker forever (callers
     start with an empty `mentionSuggestions` and populate it async after
     mount), AND persisted mentions render as grey "Former member" forever
     after reload for the same stale-closure reason on the render side.
     This hollows out AS-371/372/373/376/377/378.
     - **Uncommitted work already done** (committed as WIP at `3c25094`,
       tagged `[UNVERIFIED]`): `components/editor/rich-text-editor.tsx`'s
       `useEditor` call now passes a `deps` array keyed on a joined string
       of mention-candidate ids, so the editor instance rebuilds (and its
       closure refreshes) whenever the real candidate list changes after
       mount. `tests/unit/mention-extension.test.tsx` was also touched
       (likely adding the "starts empty, populates after mount" test the
       scrutiny report explicitly asked for — check its diff).
     - **NOT done yet**: the render-time half of the same bug class — F203's
       `resolveMentionLabel` and F204's `resolveMentionDisplay`
       (`components/editor/mention-extension.ts`) need the same "read
       current data, not a frozen closure" treatment so a mention that IS
       resolvable in freshly-loaded data actually renders correctly instead
       of staying grey. Read the scrutiny report's finding #1 in full
       (`missions/20260818-213033/milestones/M15-scrutiny.md`) for the
       exact reasoning before continuing.
     - **NOT done yet**: `npx tsc --noEmit`, `npx eslint .`, and running the
       mention test suite (`mention-extension.test.tsx`,
       `comment-mentions.test.ts`, `mention-picker-narrowing.test.tsx`,
       `description-mentions.test.ts`) have not been run against this
       change at all this session. Do this FIRST before trusting or
       extending the WIP commit — it may not even compile/pass yet.
  3. **F311 — NOT STARTED.** `editComment` (lib/actions/comments.ts) calls
     `sanitiseMentionsForVisibility` but never `computeFanoutRecipients`/
     `createNotification`/watcher-upsert — mentioning someone by *editing*
     a comment (as opposed to posting a new one) notifies nobody. `addComment`
     already does this correctly (F207); `editComment` needs the same
     wiring. Assertion: AS-381.
  4. **F312 — NOT STARTED.** ~40 integration test files die on a 10-second
     `beforeAll`/`afterAll` hook timeout under full-suite contention, and
     vitest reports those as **skipped**, not failed — meaning a canonical
     `npm run test` run silently never executes the primary evidence for
     AS-358/359/360/374/375/380/381/382/384. The scrutiny validator
     confirmed this is pure contention (each affected file passes cleanly
     run alone) — not a code regression — but it's a real process risk:
     nobody can currently trust a canonical full-suite run to catch a real
     regression, which is how some of this session's earlier bugs went
     unnoticed. Needs either `vitest`'s `hookTimeout` raised, or the
     integration suite run with reduced concurrency
     (`--pool=forks --poolOptions.forks.singleFork` or similar), or a
     shared-test-user-pool pattern to cut down how many
     `auth.admin.createUser` calls happen concurrently. This is
     infra/process work, not a product feature — use judgment on scope.
  5. **AS-396 bookkeeping** — already correctly handled by F307 (recorded
     BLOCKED-on-F213-F217 in run-log.md, not falsely green). Pass 2
     confirmed this was the right call. No further action needed unless
     F213-F217 land.

Both F309 and F310's partial work are visible in `plan.md` under "M15
scrutiny re-validation follow-ups" — F309 is tagged `[COMPLETE]`, F310/F311/
F312 are NOT tagged yet.

## Exact resume sequence

1. `git status` / `git log -5` to confirm you're picking up at commit
   `ca36283` (or later) with `3c25094`'s WIP diff already in history.
2. Finish F310:
   a. Run `npx tsc --noEmit` and `npx eslint .` against the current WIP
      state — fix anything broken.
   b. Read `components/editor/mention-extension.ts`'s `resolveMentionLabel`
      and `resolveMentionDisplay` and apply the equivalent "read current
      data live" fix for the render path (not just the picker/insert path
      already touched).
   c. Run the full mention test suite (see file list above) — all must
      pass, including whatever new "starts empty, populates after mount"
      test was already added to `mention-extension.test.tsx`.
   d. Verify the fix actually closes the "grey Former member forever"
      symptom with a real assertion, not just that the picker test passes.
   e. Log to `run-log.md`, tag `plan.md`'s F310 line `[COMPLETE]`, commit
      (this will likely be a normal `fix(F310): ...` commit superseding/
      building on the `3c25094` WIP commit — do not just re-tag the WIP
      commit as done without actually running the verification above).
3. F311 (editComment fan-out) — spawn a worker mirroring F207's `addComment`
   fan-out wiring, applied to `editComment`. Should be a small, well-scoped
   fix given F207/F304's shared helpers (`computeFanoutRecipients`,
   `createNotification`) already exist and just need a second call site.
4. F312 (test suite hook-timeout stabilization) — investigate and fix per
   the description above. Use judgment on the exact mechanism.
5. Re-run the scrutiny-validator subagent for M15 a THIRD time. Do not
   assume pass 2's remaining findings are the only ones — a third pass is
   mandatory per this mission's own hard rules ("do not advance to the UX
   validator until scrutiny is fully green, no FAIL").
6. Only once scrutiny is GREEN: spawn the ux-validator subagent for M15.
7. Once both are GREEN: mark M15 GREEN in `plan.md`, then proceed to M16
   (Views, F218 onward) — read `missions/20260818-213033/plan.md` around
   F218 and the corresponding `features/`/`clarifications/` files.

## Known gaps outside M15 (lower priority, noted for completeness)

- **M10** had 5 scrutiny-found follow-ups (F273–F278), all individually
  fixed and verified, but the milestone was never re-run through a fresh
  scrutiny pass to confirm a formal GREEN, and no milestone has ever had a
  **UX validator** report at all (M10 nor M15). This is a process gap
  worth closing eventually, not urgent.
- F278 (M10) requires the user to add 3 GitHub Actions repository secrets
  before CI will actually go green — this cannot be done by the
  orchestrator; flagged, not forgotten.
- One stray handoff exists for **F280** (M19, extension milestone) marked
  COMPLETE despite M19 not having formally started — worth a quick
  `cat missions/20260818-213033/handoffs/F280-handoff.md` + `git log
  --all --oneline -- '*F280*'` sanity check at some point to understand
  whether this is real prior work or a stray/erroneous artifact, but not
  blocking anything right now.

## Recurring patterns worth knowing before continuing (carried over, still true)

1. **"Built but not wired to real data"** recurs across this mission
   (F167/F179 in earlier sessions; `getTaskDetail`'s comment
   metadata/reactions in this session, fixed by F303; now the mention
   picker's frozen-closure bug in F310). Always check the REAL read/write
   path a feature depends on, not just that its own isolated tests pass —
   this class of bug consistently escapes unit tests that supply data as a
   hand-built prop instead of exercising the real fetch.
2. **Workers occasionally make false "tsc/eslint clean" claims.** Caught
   once for real this session (F304's integration test had a genuine
   `TS7006` implicit-any error the worker's own report claimed was clean).
   Always run these commands yourself, never trust the report alone.
3. **Security holes hide in `p_system`-style "is this a real backend
   caller" flags.** Two separate SECURITY DEFINER functions
   (`write_task_activity_entry`, `create_notification`) both shipped with
   a caller-controlled boolean that bypassed auth checks when true, with
   no verification that the caller genuinely had no session. Any future
   SECURITY DEFINER function with a similar "system/service" escape hatch
   needs the SAME scrutiny: `<flag> and auth.uid() is null`, never a bare
   `<flag>`.
4. **Full-suite `npm run test` runs are currently unreliable** — both
   genuine Supabase Auth rate-limiting/PostgREST connectivity flakiness
   (documented pattern, present since earlier sessions) AND (per F312's
   finding) a hook-timeout-under-contention issue that makes vitest
   silently skip rather than fail affected files. Always re-run a
   SPECIFIC file alone before concluding a full-suite failure is either a
   real regression or safe-to-ignore noise — never assume either without
   checking.
5. **Trust but verify, always** — this session repeatedly caught real
   defects a worker's own handoff claimed were fixed (F309's incomplete
   mirror of F302's pattern; F310's underlying bug entirely, on a fresh
   scrutiny pass, after F203/F204's original handoffs both claimed the
   mention system worked). Never mark a feature or milestone done without
   independently reading the actual diff and running the actual commands.
