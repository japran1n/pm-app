# M1 — UX re-validation report (Optimistic UI hardening)

Mission: 20260830-223927 · Milestone: M1 · Run 2 (re-validation) · Date: 2026-08-31
Validator: UX validator subagent (Playwright, Chromium, 1400x950)
Scope: the two assertions that FAILED in `M1-ux.md` (AS-005, AS-007), plus a
spot-check of AS-006 and AS-008. AS-001–004 and AS-009–014 already PASSed in
run 1 and were not re-run.

## Environment / how this was run

- App booted per `tech-decisions.md` "How to run": `npm run dev` → Next.js 16.3.1
  on `http://localhost:3000`. Boot succeeded.
- Real auth against the real linked Supabase project. Throwaway workspace
  (`m1ux2-<ts>`), admin member, project and one task (`M1 Alpha Task`,
  status `todo`, priority `low`) seeded with the admin client; a real
  `signInWithPassword` session injected as the `sb-<ref>-auth-token` cookie
  (same technique as `tests/e2e/board-reorder.spec.ts`).
- **"Before the server responds" was measured, not assumed.** All Server Action
  POSTs (`next-action` header) were intercepted with `page.route`:
  - `delay` mode — request held **4000 ms** before being forwarded. Any UI change
    inside that window provably happened before the server responded.
  - `fail` mode — `route.abort("failed")`, i.e. the mutation never reaches the
    server (the "server rejects" simulation).
- Seeded workspace / project / task / auth user deleted afterwards and verified
  empty (`leftover workspaces: []`, `leftover users: []`). Dev server stopped.
  **No project code was modified.**
- Evidence: `missions/20260830-223927/milestones/M1-evidence-2/`
  (`trace.txt`, `trace-supplemental.txt`, `results.json`,
  `results-supplemental.json` + per-step screenshots).

## Results

| ID | Verdict | Evidence | Reproduction / observation |
|---|---|---|---|
| AS-005 | **PASS** (was FAIL) | `M1-evidence-2/AS-005-status-change-1.png`, `AS-005-status-change-2.png`, `AS-005b-change-1..3.png`, `AS-005b-change-4-done.png`, `trace.txt`, `trace-supplemental.txt` | One open sheet, each change with the Server Action held 4000 ms. To do→In progress **119/168 ms**; In progress→In review **137/159 ms**; In review→To do (3rd change, same sheet) **137 ms**; →Done (4th change) **769 ms** — all well inside the 4000 ms hold. The run-1 defect (2nd+ change frozen for the full delay) is gone. |
| AS-006 | PASS | `M1-evidence-2/AS-006-status-revert.png`, `trace.txt` | Sheet showing "Done", Server Action aborted → choose **To do**. Toast "Failed to set status to To do"; badge stayed/returned to "Done". |
| AS-007 | **PASS** (was FAIL) | `M1-evidence-2/AS-007-priority-change-1.png`, `AS-007-priority-change-2-clear.png`, `AS-007-priority-change-3.png`, `trace.txt` | Same open sheet as AS-005, POST held 4000 ms each time. Low→Urgent **141 ms**; Urgent→**No priority** (clear, 2nd change) **109 ms**; No priority→Medium (3rd change) **143 ms**. Clearing to "No priority" is optimistic even as a non-first change. |
| AS-008 | PASS | `M1-evidence-2/AS-008-priority-revert.png`, `trace.txt` | Sheet showing "Medium", Server Action aborted → choose **High**. Toast "Failed to set priority to High"; badge stayed/returned to "Medium". |

**Score for the re-validated set: 4 PASS / 0 FAIL / 0 INCONCLUSIVE.**
Combined with run 1's untouched rows: **14 PASS / 0 FAIL** across AS-001…AS-014.

## Note on one apparent stale reading (harness artifact, not a defect)

In the first pass of this run, the 3rd status change (In review → **Done**) read
stale for the whole 4000 ms window. Root cause is the harness, not the app:
`handleStatusChange` awaits `confirmIfMovingToDone(task.id, next)` **before**
touching the optimistic state, and that guard performs its own Server Action
round trip (`getOpenBlockers`, see `components/task/blocked-done-guard.tsx:104`).
The blanket route rule was holding that guard fetch too, so the optimistic
update had not yet been reached.

Re-run isolating it (`m1b`, `trace-supplemental.txt`): the guard's single POST was
let through undelayed and only the `moveTaskStatus` mutation held 4000 ms — the
badge then flipped to "Done" in **769 ms**, i.e. optimistically, before the
server replied. A 3rd, non-done change (In review → To do) with the blanket
delay still applied was immediate at 137 ms, confirming ordinal is no longer a
factor.

Worth knowing (not an assertion failure): a move to **Done** is inherently gated
on a real server round trip before any optimistic paint, by design (the guard
must not trust the possibly-stale local `blockedBy` prop). On a slow network the
Done badge will lag by that round trip. AS-005 does not require otherwise and
this is a deliberate correctness gate for AS-281, so it is not scored as a fail.

## Verification of the fix under test

Commit `df7edd6` (F024) moves `setConfirmedStatus(undefined)` /
`setConfirmedPriority(undefined)` to just **before** `startSaveTransition`, so the
clear is an urgent update rather than one deferred until the transition settles.
The behaviour observed here matches: the confirmed mirror no longer masks the
optimistic value on the 2nd, 3rd or 4th change in a single open sheet, for either
field, including the clear-to-"No priority" path.

## Suggested fixes

None. Both previously failing assertions now pass.

## Carried-over observations from run 1 (unchanged, not re-tested)

- **AS-010, chained edits.** `handleTitleBlur` captures `previousTitle = task.title`
  (the server prop), not the currently displayed title, so a failed save after an
  un-propagated successful rename reverts to the older title. AS-010 is scored on
  the single-edit case, which passes.
- The first-run onboarding tour dialog overlays the list view for a new user; this
  run pre-set `localStorage["pm-app-tour-dismissed"] = "1"` to skip it.

## Not exercised in this milestone

AS-015 … AS-024 (realtime for My Tasks, Calendar, command palette) are outside
M1's assigned range.
