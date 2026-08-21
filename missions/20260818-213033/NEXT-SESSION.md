# Next session — start here

_Written 2026-08-21 at the end of the previous session. Read this file first; run-log.md's
bottom entries give full detail on anything summarized here._

## Where things stand

Milestone M19 (QA feedback Chrome extension, F280–F300) is **fully implemented and
independently verified** — every feature rebuilt, tested twice, and checked against its actual
code by the orchestrator, not just trusted from worker reports.

After M19 shipped, the user requested several rounds of follow-up work on the extension
(ad-hoc, not numbered mission features — tracked in run-log.md under "POST-M19" entries):

1. **Removed console-log and network-error capture** entirely (not needed) — deleted
   console-hook.ts, network-hook.ts, ring-buffer.ts, privacy-toggles, their tests.
2. **Replaced "capture full tab then crop" with "select region live on the page first"**
   (macOS Cmd+Shift+4 style) — new `region-overlay.ts`.
3. **UI/UX redesign** of the popup — design system (light/dark), icon-based annotation
   toolbar with tooltips, restyled form/success/error screens.
4. **Fixed a real architecture bug**: the popup closed the instant the user clicked the page to
   draw a selection (Chrome MV3 popups close on focus loss), which killed the capture flow
   entirely. Fixed by moving the whole select→capture→crop orchestration into the background
   service worker (`background/service-worker.ts`), relayed via `chrome.storage.local`
   (`capture/pending-capture.ts`) so a reopened popup picks up the result.
5. **Fixed inline image attachment previews** in the WEB APP's task detail view — attachments
   (screenshots especially) previously showed only as a filename link. Added a `mime_type`
   column (real migration, applied to the live linked Supabase project) and an inline thumbnail
   component (`components/task/attachment-list.tsx`).
6. **Fixed two more UX bugs** in the region-select flow: (a) required a wasted first click
   before drag-select worked — root cause was a window-focus timing issue, fixed with
   `window.focus()`; (b) popup didn't reopen automatically after capture — investigated
   `chrome.action.openPopup()` empirically (confirmed unreliable in this environment, does NOT
   silently fake a fix), implemented a guaranteed toolbar badge (✓) as the real fallback cue.

**Recurring gotcha across this whole session**: leaving a manually-started `npm run dev`
preview server running on port 3000 (started for the user's manual browser testing) blocks the
extension's own Playwright tests from spawning their own dev-server instances (Next.js refuses
a second `next dev` for the same project directory, regardless of PORT). If a full extension
suite run shows a wave of unrelated failures (10+ different test files), check `lsof -ti :3000`
first before assuming a real regression — kill any stray process there, then rerun.

## Next requested work (in order)

1. **Task detail sidebar redesign** — the user explicitly asked for this next. When a task is
   clicked in the app, the sidebar/sheet that opens (`components/task/task-detail-sheet.tsx`)
   should be **wider and more spacious/organized** — currently cramped. This is a pure UI/UX
   improvement request, not a new feature — read that component in full (it's substantial:
   title, description, status, assignee, priority, due date, tags, subtasks, comments,
   attachments all live in it) before touching anything, verify what layout/width constraints
   currently exist (check the Sheet/Dialog primitive it's built on — likely shadcn/ui — for its
   width prop conventions), and apply the same rigor as every other change in this session:
   spawn a worker, verify independently (rebuild if needed, run the relevant test suite twice,
   read the actual diff — don't just trust the worker's summary), log to run-log.md.
2. **Continue the original mission plan** after that, per the original NEXT-SESSION.md's
   ordering (superseded by this file, but the underlying task list is still valid):
   - M10 follow-ups: F132 (project-level visibility, referenced by several M13/M14 handoffs as
     scoped-around debt), F273, F274 (avatar MIME sniffing), F277, F278.
   - Improvement-list items 3–7, 9, 10 (F159–F193): multi-assignee, watchers, estimates, rich
     text, recurrence, templates, bulk actions, trash/undo.
   - Read each feature's spec/clarification file under `missions/20260818-213033/features/` and
     `clarifications/` before delegating, exactly as done throughout this session.

## Standing process rules (unchanged, still enforced every feature)

- Orchestrator never writes project code directly — always spawn a worker (in-process subagent,
  told to read `.claude/agents/worker.md` first).
- After every worker: verify independently before marking anything done — check `git status`,
  read the actual diff for the parts that matter, rebuild if it's the extension, rerun the
  relevant test suite (twice for the extension, to catch flakiness), and only then log to
  run-log.md and commit.
- Extension: `cd extension && npm run build` then `npx playwright test` (twice). App: relevant
  `npx vitest run <files>` for changed areas — the full suite is slow (~10 min) and this
  session found it isn't strictly necessary to run in full after every small change, but do run
  it after anything touching shared/critical paths (auth, task creation, RLS).
- Dev login for manual testing: `http://localhost:3000/dev-login?email=sasa@goodguys.se`
  (only works when a dev server is actually running — start one via the browser-preview tool,
  not by leaving a stray `npm run dev` around after the session ends).
