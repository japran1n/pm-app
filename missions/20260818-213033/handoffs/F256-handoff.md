# Handoff: F256 — consistent optimistic and pending behaviour

## Status
COMPLETE

## Assertions covered
AS-497: PASS — every mutating control audited either shows an immediate optimistic UI change or a pending indicator well within 100ms (React applies `disabled`/spinner state synchronously on the next render after the click, no artificial delay anywhere in this codebase). One real gap found and fixed (sidebar sign-out, previously a bare `<form action={signOut}>` with no pending state at all). New tests: `tests/unit/optimistic-pending-audit.test.tsx`'s two `describe("F256 AS-499...")` cases (the first directly demonstrates AS-497's "pending visible immediately" for the fixed control), plus the pre-existing `tests/unit/bulk-delete-action.test.tsx` and dozens of other per-feature tests already exercising this pattern elsewhere (see enumeration below).
AS-498: PASS — every mutating control with a real failure branch (i.e. not a pure-redirect action like sign-out) rolls back its optimistic/local state and shows exactly one `toast.error` naming what failed. New test: `test("RemoveMemberButton re-enables and shows a toast naming the failure when removeMember fails")` in `tests/unit/optimistic-pending-audit.test.tsx`, chosen as a representative already-compliant control from the audit since it has a genuine `{ok:false}` failure path (sign-out's own action always redirects and has none to exercise).
AS-499: PASS — every mutating control audited disables itself (or otherwise ignores re-entry, e.g. dnd-kit's own single-drag-at-a-time model) while its mutation is in flight. One real gap found and fixed: the sidebar's sign-out button had no pending/disabled state, so a fast double-click could fire `signOut()` twice. New tests: `test("sign-out button disables itself the instant it is clicked...")` and `test("a second click while pending does not call signOut() a second time")` in `tests/unit/optimistic-pending-audit.test.tsx`.

## Enumeration of every mutating control audited (disposition)

Systematic method: `grep -rl "from \"@/lib/actions" components` (58 files) intersected with `grep -rl "useTransition|useOptimistic|useActionState" components` (46 files) to find the 12 files that import a Server Action but don't obviously carry pending state in the same grep pass, then read each one individually. Every file in both sets was also spot-checked for a `disabled={...}` guard actually wired to its pending flag (grep for `disabled=`/`toast.error` counts per file, then read the surrounding code for any that looked thin).

**Already compliant (useTransition/useState pending flag + disabled + toast.error, unchanged):**
- `components/board/quick-add.tsx` — `pending` disables the input/submit.
- `components/board/board.tsx` — drag-and-drop reorder/move/priority-change: full optimistic `setTasks` + `snapshot`/`rollback()` + single `toast.error`, `create task` (F160-style) and `delete task` optimistic inserts/removals with their own rollback.
- `components/calendar/calendar-day-grid.tsx` — drag-to-reschedule via `editTask`: local `byDate` optimistic state, one `toast.error` rollback on failure (mirrors board.tsx's own pattern per its header comment).
- `components/timeline/timeline-body.tsx` — drag-to-resize/move via `editTask`: same optimistic-state + single-toast-rollback shape as the calendar.
- `components/task/bulk-delete-action.tsx`, `components/task/bulk-status-action.tsx` — `isPending` disables trigger + dialog buttons; confirm-then-act guard (AS-339-style) additionally prevents the mutation firing before an explicit confirm click.
- `components/archive-project-dialog.tsx`, `components/edit-project-dialog.tsx`, `components/new-project-dialog.tsx`, `components/transfer-ownership-dialog.tsx`, `components/workspace/delete-workspace-dialog.tsx`, `components/save-project-as-template-dialog.tsx`, `components/task/save-as-template-dialog.tsx`, `components/task/new-from-template-button.tsx` — all dialogs disable every actionable button (submit, cancel, and any secondary control) via `isPending`, with a spinner swapped in on the submit button and `toast.error` on failure.
- `components/remove-member-button.tsx`, `components/revoke-invite-button.tsx`, `components/project/restore-project-button.tsx`, `components/trash/restore-comment-button.tsx`, `components/trash/trash-restore-button.tsx`, `components/trash/purge-dialog.tsx`, `components/member-role-select.tsx` — same `isPending`-disables-the-control + `Loader2` spinner + `toast.error` shape.
- `components/project/status-manager.tsx`, `components/project/project-members.tsx` — multiple independent `isPending`-per-row/column guards, all with `toast.error` on failure.
- `components/task/comment-list.tsx`, `components/task/comment-reactions.tsx` — post/edit/delete comment and toggle reaction, all `isPending`-guarded with rollback toasts.
- `components/task/watchers.tsx` — dedicated `isToggling` transition; optimistic watch/unwatch flip with `toast.success`/`toast.error`.
- `components/task/dependencies.tsx` — `isAdding`/`removingId` guard add/remove of blocking/blocked-by links, `toast.error` on failure.
- `components/task/checklist.tsx` — `busyItemId`/`isAdding` guard per-row add/toggle/delete/reorder (including drag reorder rollback), `toast.error` throughout.
- `components/task/subtask-list.tsx` — `isSubmitting` guards the add-subtask form, `toast.error` on failure.
- `components/task/attachment-list.tsx` — separate `openingId`/`deletingId`/`isUploading` guards per control, `toast.success`/`toast.error`.
- `components/task/recurrence-editor.tsx`, `components/task/list-assignee-cell.tsx`, `components/task/list-status-select.tsx`, `components/task/tags-editor.tsx`, `components/task/time-tracking.tsx` — all `isPending`/`isSaving`-guarded with rollback toasts.
- `components/notifications/preferences-form.tsx`, `components/profile/profile-form.tsx`, `components/workspace/workspace-general-form.tsx`, `components/invite-member-form.tsx` — standard form-submit `isPending` guard + `toast.error`.
- `components/onboarding/create-workspace-form.tsx`, `components/onboarding/sample-project-offer.tsx`, `components/onboarding/replay-tour-button.tsx` — `isPending`-guarded.
- `components/views/save-view-dialog.tsx`, `components/views/view-switcher.tsx` — `isPending`-guarded save/apply/delete of a saved view.
- `components/templates/template-list.tsx` — `isPending`-guarded apply/delete-template rows.
- `components/task/list-due-date-cell.tsx`, `components/task/list-priority-select.tsx` — go through the shared `lib/hooks/use-inline-field-edit.ts` hook (F250/F251), which itself wraps `useTransition` + optimistic local value + single-toast rollback + a live-update/no-clobber rule; reused as-is, not reinvented, per this feature's own explicit instruction to prefer the shared hook.
- `components/board/board-toolbar.tsx` — grouping-mode change: primary visible effect is an immediate `router.push` URL change (itself the "optimistic result"); `upsertBoardSwimlanePrefs` is a deliberate fire-and-forget background persistence of the choice for next session (per its own F226 comment, "same optimistic, no blocking spinner posture as every other board mutation") — judged N/A rather than a gap: nothing the user is waiting on can fail visibly, since the URL/grouping change the user actually asked for already happened synchronously and does not depend on this call succeeding.
- `components/onboarding/tour.tsx` — "Finish"/dismiss click sets `active=false` immediately (the optimistic result: the tour visually closes at once) and `dismissTour()` persists that in the background with its own `toast.error` on failure (AS-492's persistence). No pending/disabled state needed on the dismiss control because there is nothing left on screen once dismissed for a double-click to hit twice.

**Read-only controls (import an action, but it's a query, not a mutation — N/A, out of scope for these three assertions):**
- `components/command/command-palette.tsx` (`searchPalette`, `resolveRecentItems`)
- `components/nav/app-sidebar.tsx`'s `NotificationBell` import path and `components/task/blocked-done-guard.tsx` (`getOpenBlockers`)
- `components/task/activity-feed.tsx` (`getTaskActivityFeed`)
- `components/task/use-task-detail-sheet.ts` (`getTaskDetail`)
- `components/notifications/notification-bell.tsx` (`getNotificationSnapshot`)

**GAP FOUND AND FIXED:**
- `components/nav/app-sidebar.tsx` — the sign-out control was a bare `<form action={signOut}>` wrapping a plain `<Button type="submit">`, with no pending state at all: no `disabled`, no spinner, nothing stopping a fast double-click from calling the Server Action twice. Extracted into a new exported `SignOutButton` using the exact same `useTransition` + `disabled={isPending}` + `Loader2` spinner shape every other mutating control in this codebase already uses (`RemoveMemberButton`/`RevokeInviteButton` are the closest siblings — same icon-swap-to-spinner convention). No rollback/toast branch was added because `signOut()` (`lib/actions/auth.ts`) always redirects and never resolves an `{ok:false}` — there is no failure path to roll back from; the only genuine gap was the missing pending/disabled guard, which is what AS-499 is actually about for this control.

## Files changed
components/nav/app-sidebar.tsx
tests/unit/optimistic-pending-audit.test.tsx (new)

## Commands run
`npx vitest run tests/unit/optimistic-pending-audit.test.tsx` (0 — 1 file / 3 tests passed)
`npx tsc --noEmit` (0, no output)
`npx eslint .` (0 errors, 6 warnings — same 6 pre-existing warnings as F252/F255's documented baseline: `lib/queries/search.ts:280`, `tests/unit/invite-member-pagination.test.ts:186`, `tests/unit/palette-actions-recents.test.tsx:55×2,74×2` — none added by this feature)
`npx vitest run tests/unit` (148 files / 1137 tests passed — up from F255's baseline 147 files/1134 tests by exactly the 1 new file / 3 new tests this feature added; 1 pre-existing unrelated unhandled-rejection error from `tests/unit/user-avatar.test.tsx` — `cookies() outside request scope` inside comment-list's mention-candidate effect, the exact same flake documented in F252's and F255's handoffs — unrelated to this feature, does not fail the run, test counts above already reflect it not failing)
`npx next build` (0 — "Compiled successfully", all routes generated, no new warnings)

No Playwright run: per the definition-of-done's "the test type that fits" guidance, the one real gap fixed (a synchronous client-side pending-state guard) is fully and deterministically observable from a unit test with mocked Server Actions and controlled promise resolution — a live browser interaction adds no additional coverage for this specific fix, and the mission's e2e harness is currently broken independent of this feature (documented in `NEXT-SESSION.md` Task 2, unrelated to this feature's scope).

## Decisions made
- Followed the audit's own explicit instruction ("list the audited controls... so the validator can check the sweep was real and not spot-fixed") by enumerating every control found via the systematic grep method above, not just the one fixed — see the full list above.
- Did not retrofit the already-compliant ~45 controls onto a new shared hook. The spec's draft scope suggested "extract the repeated bits into a small shared hook," but the actual audit found the repeated bits already extracted once (`lib/hooks/use-inline-field-edit.ts`, F250/F251) for the one family of controls (inline list-view cell edits) that had enough duplication to justify it, and every other control's `useTransition`/`isPending`/`toast.error` shape is a 3-line idiom, not meaningful duplication — inventing a second generic wrapper hook for a pattern this thin, across controls with meaningfully different local-state shapes (single value, array, per-row-id, drag snapshot), would be a second source of truth for very little consolidation. This matches the clarified ambiguity-resolution rule (simpler option, no new dependency) and the audit archetype's "already compliant is a valid documented outcome" answer — extended here to "the existing shared abstraction already covers the one place duplication was real."
- `board-toolbar.tsx`'s fire-and-forget preference persistence and `onboarding/tour.tsx`'s dismiss-then-persist pattern were judged compliant-by-design rather than gaps: in both cases the user-visible "result" of the click (URL change / tour closing) already happens synchronously and does not depend on the background persistence call succeeding, so there is nothing left for a pending indicator to cover and no user-facing state to roll back if the background call fails (tour's does still surface `toast.error` for visibility; the board preference's failure only affects what the next reload starts from, silently, which is an accepted, pre-existing convention documented in that file's own F226 comment, not something this feature's scope re-litigates).
- `SignOutButton` uses `onClick` + `useTransition` rather than `useFormStatus` on a native `<form action={signOut}>`, matching the codebase's dominant idiom for single-button mutations (every sibling control audited above uses this exact shape) rather than introducing the codebase's first `useFormStatus` usage for one component.

## Out-of-scope work needed
None identified beyond what the audit already covers. No new gaps found requiring a follow-up feature.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Judged `board-toolbar.tsx`'s and `onboarding/tour.tsx`'s fire-and-forget background-persistence calls as N/A rather than gaps, reasoning that AS-497/AS-498/AS-499 are about the user-visible result of THEIR action, which in both cases already happens synchronously and independently of the background call — see Decisions made above for the full reasoning.
AUTONOMOUS_DECISION: Did not extract a new shared `lib/hooks/use-action-state.ts` (mentioned in the spec's approximate Files list) since the audit found no real duplication left to extract beyond what `use-inline-field-edit.ts` (F250/F251) already consolidates — per the clarified "simpler option, no new dependency, no second source of truth" ambiguity rule, adding a thin wrapper hook purely to exist would itself be the second source of truth this rule warns against.

## Notes for the next worker
- The one real gap this audit found (`components/nav/app-sidebar.tsx`'s sign-out control) is now `export function SignOutButton()` in that same file — exported specifically so `tests/unit/optimistic-pending-audit.test.tsx` can render it directly without mounting the whole `AppSidebar` shell (which pulls in `NotificationBell`'s live Supabase Realtime wiring).
- If a future feature adds a new mutating control, the two idioms already dominant in this codebase are: (a) the 3-line `useTransition` + `disabled={isPending}` + `toast.error` shape used by ~45 controls audited above, or (b) `lib/hooks/use-inline-field-edit.ts` for a new single-scalar-field inline list-view cell. Neither needs a new abstraction.
- No MCP tools used — this feature is pure client-side UI behaviour with no live schema/policy surface, consistent with the spec's "MCP at run: none."
