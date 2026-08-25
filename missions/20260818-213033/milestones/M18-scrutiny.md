# M18 — Final QA: scrutiny report (PASS 1)

Scope: F268 (a11y-keyboard-pass), F269 (contrast-and-nocolor-pass), F270 (typecheck-lint-clean),
F271 (readme-docs-v2), F272 (e2e-suite-v2, three rounds). Assertions AS-523–AS-530.
Migration `20260901010000_fix_profiles_tour_completed_at_column_grant.sql`.
Context: M17 scrutiny follow-ups F332–F336 landed immediately before this milestone; F268's
keyboard audit was scoped to close M17 scrutiny's own MAJ-8.

Per the user's standing cap (`NEXT-SESSION.md` § "Hard-won lessons": M15 six passes, M16 two,
M17 two, blockers-only past pass 1), this is **PASS 1**. Follow-ups below are blockers-first;
majors/minors are recorded but should not drive another round on their own.

Method: four parallel reviewers reading code/SQL/tests only (no handoffs passed in), plus this
validator's own re-verification of every load-bearing claim directly against current source,
the migration text, and two independent full Playwright runs. Every finding below was
re-checked by this validator against the file it cites; none is relayed on a reviewer's word
alone.

Toolchain (this validator, from the current tree):
- `npx tsc --noEmit` — **exit 0, no output.**
- `npx eslint .` — **exit 0, 0 errors**, 6 pre-existing unused-var warnings (unchanged set).
- `npx vitest run tests/unit` — **167 files / 1305 tests, all passed**, exit 0. One
  pre-existing unhandled-rejection artefact in `tests/unit/user-avatar.test.tsx`.
- `npx next build` — **exit 0**, full route manifest emitted.
- `npx playwright test --workers=2` — **14 failed / 17 passed.**
- `npx playwright test` (config default `workers: 1`, `retries: 0` locally) —
  **12 failed / 19 passed, exit 1.** Full output appended.

## Verdict: **NOT GREEN — 4 blockers.**

The parts of this milestone that were most carefully argued are genuinely sound: the
`tour_completed_at` column grant is exactly the additive, RLS-neutral widening it claims to be;
the dnd-kit id fix is correct and provably behaviour-neutral with no reachable id collision;
F270's refusal to drop the three deprecated `tasks` columns holds up; F269's contrast *maths*
is real WCAG arithmetic, not eyeballing; and F271's env-var table is complete against
`.env.example`.

The blockers are that three of the milestone's four audit-style features asserted completeness
they did not establish, and the one measurable claim — a green e2e suite — does not reproduce.
**AS-530's "31/31 passed twice" claim did not survive independent verification.**

---

## Assertion table

| ID | Verdict | Reason |
|---|---|---|
| AS-523 | **FAIL (blocker)** | Dropdown options in the very file F268 changed are Tab-reachable but keyboard-**inoperable**: `components/nav/header-search.tsx:380-395` renders `<button role="option">` whose only activation handler is `onMouseDown`, with no `onClick` and no `tabIndex={-1}`. Enter/Space on a focused option does nothing — BLOCKER-1. |
| AS-524 | PASS (minors) | Every icon-only control on the walked surfaces has an `aria-label` or is `aria-hidden` beside a labelled control; the bell's label is dynamic and count-bearing. Non-distinct repeated labels are MIN-3/MIN-4. |
| AS-525 | **FAIL (blocker)** | The "no other colour-only indicator exists" claim is false. Priority is conveyed by hue alone, with an `aria-hidden` dot and no priority text anywhere in the row, at `components/calendar/day-cell.tsx:155-159`, `components/calendar/agenda-list.tsx:122-126`, `components/calendar/day-overflow.tsx:69-73`; and by bar colour alone at `components/timeline/timeline-bar.tsx:28,45` and `components/timeline/timeline-bar-draggable.tsx:57` — BLOCKER-2. |
| AS-526 | **FAIL (major)** | Three real sub-4.5:1 text placements and one systematically wrong test baseline — MAJ-1, MAJ-2. The four contrast test files themselves are methodologically sound (see "What held up"). |
| AS-527 | PASS | `npx tsc --noEmit` exit 0. `git diff 98d26ac..HEAD` over `*.ts/*.tsx` adds **zero** `as any`, `: any`, `@ts-ignore` or `@ts-expect-error`. The single added suppression is one `react-hooks/exhaustive-deps` disable — MIN-1. The deprecated-column deferral is correct. |
| AS-528 | PASS | `npx eslint .` exit 0, 0 errors, same 6 pre-existing warnings in `lib/queries/search.ts`, `tests/unit/invite-member-pagination.test.ts`, `tests/unit/palette-actions-recents.test.tsx`. |
| AS-529 | PASS (minors) | All 10 vars in `.env.example` appear in README's table (`README.md:214-236`); the pg_cron table matches the two real `cron.schedule` migrations and correctly states there is no digest job. Two accuracy nits — MIN-5, MIN-6. |
| AS-530 | **FAIL (blocker)** | **Does not reproduce.** 12 failed / 19 passed at the config default; 14 failed / 17 passed at `--workers=2`. Failures span 7 spec files including specs F272 never touched — BLOCKER-3. Separately, the new mention spec asserts a notification the test itself wrote, standing in for a product path documented in-repo as 500-ing — BLOCKER-4. |

---

## BLOCKERS

### BLOCKER-1 — header-search options are reachable but not operable by keyboard (AS-523)

`components/nav/header-search.tsx:380-395`:

```tsx
<button
  id={id}
  type="button"
  role="option"
  aria-selected={isActive}
  onMouseDown={(event) => {
    event.preventDefault();
    onSelect();
  }}
```

There is no `onClick` and no `onKeyDown`. Two consequences, both live:

1. Because these are real `<button>`s with no `tabIndex={-1}`, Tab from the input walks focus
   into every option. The `aria-activedescendant` combobox pattern F268 implemented requires
   the opposite — the input keeps DOM focus and options are removed from the tab sequence.
2. Enter and Space on a focused option synthesise a `click`, never a `mousedown`. So a keyboard
   user who reaches an option by Tab is standing on a **dead control**.

AS-523 says "reachable **and** operable". These are reachable and inoperable — the worse of the
two failure modes, and it sits inside the one file F268 modified. The arrow-key +
`aria-activedescendant` path the orchestrator live-verified is real and works; it is simply not
the only way a keyboard user reaches these controls, and the other way is broken.

The test suite cannot catch this: both AS-521 tests (`tests/unit/header-search.test.tsx:114,141`)
drive `fireEvent.mouseDown` — precisely the one handler that exists. No test Tabs to an option;
no test presses Enter or Space on a *focused* option. The suite is green with the bug fully
present.

Fix is two attributes: add `onClick` and `tabIndex={-1}`.

### BLOCKER-2 — priority is conveyed by colour alone on the calendar and timeline (AS-525)

F269's handoff claims no colour-only indicator remains. Five call sites falsify it. Verified
directly:

`components/calendar/day-cell.tsx:155-159` (and the byte-identical shapes at
`components/calendar/agenda-list.tsx:122-126` and `components/calendar/day-overflow.tsx:69-73`):

```tsx
<span
  className="h-1.5 w-1.5 shrink-0 rounded-full"
  style={{ backgroundColor: PRIORITY_COLORS[priority] }}
  aria-hidden
/>
```

The row renders the task key and title; priority appears **nowhere** as text, `title`, or
accessible name. Sighted users get priority by hue only; screen-reader users get nothing at all,
because the dot is `aria-hidden`.

`components/timeline/timeline-bar.tsx:28,45` is worse in degree: the bar's entire
`backgroundColor` is the priority colour while `aria-label`/`title` is `${taskKey} ${title}` with
no priority component. In the `layout.kind !== "range"` branch the element is a bare 16px
coloured circle with **no visible text whatsoever** — the marker is 100% colour-encoded.
`components/timeline/timeline-bar-draggable.tsx:57` repeats it.

The correct pattern already exists two files away: `components/task/task-card.tsx:268-279` and
`components/task/list-priority-select.tsx:96,125,141` both pair the same `aria-hidden` dot with
`PRIORITY_LABELS[...]` text. The calendar and timeline simply were not walked.

### BLOCKER-3 — the e2e suite does not pass; the "31/31 twice" claim does not reproduce (AS-530)

This is the claim the scrutiny process exists to check, so it was checked twice, independently.

Run A, `npx playwright test --workers=2`: **14 failed, 17 passed** (6.3m).
Run B, `npx playwright test` at the config's own `workers: 1` / `fullyParallel: false` /
`retries: 0`: **12 failed, 19 passed** (11.9m), process exit 1.

Run B's failures, spanning **7 spec files**:

- `blocked-done-guard.spec.ts:308` — `getByRole('alertdialog')` never appears.
- `checklist-ui.spec.ts:390, 476, 601` — all three.
- `dependency-ui.spec.ts:281, 333` — both.
- `f272-column-and-lifecycle.spec.ts:395` — delete → Undo restores.
- `f272-two-context-notifications.spec.ts:329` — the assign-notification test.
- `notifications.spec.ts:293` — **AS-388, the live bell badge**: `Notifications, 1 unread`
  never appears within 15s. This is the exact behaviour F272 part 2's Realtime-auth-race fix
  claimed to repair.
- `subtask-ui.spec.ts:278, 308` — both.
- `templates-ui.spec.ts:273` — success toast never appears.

Note the shape: four of these files (`dependency-ui`, `subtask-ui`, `blocked-done-guard`
partially, `notifications`) exercise assertions from earlier milestones that F272 did not set out
to change, so this is not confined to the new work.

**Confound, recorded honestly:** run A executed 12 minutes before run B against the same live
Supabase project at a non-default worker count, and failing specs may not have completed their
`afterAll` cleanup. Run B's failures could therefore be partly contaminated by run A's residue.
That confound does not rescue the assertion, for two reasons: run A itself was uncontaminated by
me and still failed 14, and if a prior aborted run can leave state that fails the next one, then
"passes on a clean checkout" is exactly the property not yet demonstrated. What is established is
that **AS-530 is not currently reproducible**; what is not established is a single root cause.
The follow-up below asks for a purged-state, `retries: 0`, default-worker re-run before any
further diagnosis.

Two structural weaknesses make the original green claim weaker evidence than it appears even
setting the above aside:
- `playwright.config.ts:21` — `retries: process.env.CI ? 1 : 0`. A green CI run tolerates one
  retry per test. The AS-530 verification run must pin `retries: 0`.
- Every spec carries `test.skip(!haveAdminCreds, ...)` (14 occurrences). On a genuinely clean
  checkout with no `.env`, all 31 tests skip and the run exits 0 — AS-530 would be **vacuously**
  satisfied. Only `process.env.CI` triggers a hard failure. The evidence for AS-530 must state
  which mode produced the result.

### BLOCKER-4 — the mention e2e test asserts a notification it wrote itself, standing in for a 500-ing product path (AS-530)

`tests/e2e/f272-two-context-notifications.spec.ts:473-497` documents, in the repo, an unfixed
product defect:

> submitting via the real "Post" button reproducibly 500s on the server — `addComment`
> (lib/actions/comments.ts:119, `extractPlainText`) throws "Cannot access id on the server. You
> cannot dot into a temporary client reference from a server component" whenever the submitted
> body actually contains a real `mention` node produced by this composer, independent of typing
> speed/timing (reproduced 3/3 runs).

So **posting a comment containing an @-mention is broken in production code.** The test drives
the composer and the mention picker for real, then submits via `adminClient.from("comments")
.insert(...)` plus a direct `create_notification` RPC (`:525-574`). The assertion at `:600` that
the recipient sees "mentioned you" is therefore satisfied by the test's own hand-written RPC
call, not by product fan-out.

Two separate problems, and the second is the one that makes this a blocker:

1. A spec titled "@-mentioning the OTHER user in a comment ... delivers a live notification to
   their bell" reports an e2e-covered journey whose delivery half is test-authored. The
   substitution is honestly documented in a comment, but the milestone-level AS-530 evidence does
   not carry that caveat forward.
2. F272's scope decision (product code outside `tests/e2e/*`) was defensible for the worker. But
   the defect was recorded only in a spec comment and a handoff's "Out-of-scope work needed"
   section — **no follow-up feature was ever filed**, and the milestone closed COMPLETE with a
   core collaboration feature broken. That is the escalation failure this report exists to catch.

---

## MAJORS

### MAJ-1 — a live regression in the notification panel introduced by F272 part 2

`components/notifications/notification-panel.tsx:153-164` changed `appliedSnapshotVersion`'s seed
from the `liveSnapshotVersion` prop to a sentinel `-1`, so that **any** defined snapshot present
at mount is treated as unapplied and merged in. That fixes the "snapshot silently never applied"
bug it targeted, and correctly cannot fire on first mount (the `liveSnapshot &&` guard at `:156`).

But `components/notifications/notification-bell.tsx:112` renders a Radix `Popover`, whose content
unmounts on close, and the bell holds `liveSnapshot` / `liveSnapshotVersion` in its own state
which `handleMarkRead` / `handleMarkAll` never invalidate (`notification-panel.tsx:166-225` only
call `onUnreadCountChange`). Reconciliation is triggered only by a Realtime insert or
`visibilitychange`/`focus` (`notification-bell.tsx:81, 100-104`) — **not** by opening the popover.

Live repro: open bell → "Mark all as read" (badge → 0) → close popover → re-open. The panel
remounts with `appliedSnapshotVersion = -1`, re-applies the pre-mark-read snapshot, every row
shows unread again, and `onUnreadCountChange(liveSnapshot.unreadCount)` pushes the stale count
back into the badge. Nothing clears it until the next tab blur/focus. Server state is correct, so
this is display-only and self-healing — hence major, not blocker — but it is a regression in
shipped M15 behaviour (AS-386/AS-388) introduced by an M18 feature. Correct shape: have the bell
clear or refresh `liveSnapshot` when the panel mutates read state, or reconcile on popover open.

### MAJ-2 — the tour-suppression localStorage flag is browser-global and never cleared on sign-out

`components/onboarding/tour.tsx:91` defines `TOUR_DISMISSED_STORAGE_KEY = "pm-app-tour-dismissed"`
and `:205` writes `"1"` on dismissal. The key carries **no user id**. `signOut`
(`lib/actions/auth.ts:73`) is a Server Action and cannot clear `localStorage`; `grep` confirms the
only two references in the entire repo are the write in `tour.tsx` and the removal in
`replay-tour-button.tsx:31`.

So on any shared browser: user A dismisses the tour, signs out, user B signs in with
`tour_completed_at` null — and `locallyDismissed` (`tour.tsx:150`) suppresses B's first-run tour
permanently. This directly contradicts AS-492's per-user persistence intent, which
`lib/actions/onboarding-tour.ts:59` restates. It also silently overrides a `replayTour()` performed
from any other device. Suggested fix: key it `pm-app-tour-dismissed:<userId>` (the layout already
has the user id).

### MAJ-3 — three real contrast failures and one systematically wrong test baseline (AS-526)

- `app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx:231` sets
  `color: PRIORITY_COLORS[priority]` on a `text-xs` Badge. Measured on the white card: urgent
  `#ef4444` **3.76:1**, high `#ea580c` **3.56:1**, low `#3b82f6` **3.68:1** — all below 4.5:1.
  This also contradicts the stated premise of `tests/unit/task-colors-contrast.test.ts:6-9`
  ("never as text color, so the applicable threshold is 3:1").
- `components/timeline/timeline-bar.tsx:37` and `timeline-bar-draggable.tsx:103` put `text-white`
  over `backgroundColor: priorityColor` — the same 3.56–3.76:1 values. Untested.
- The dot tests measure against `--card` `#ffffff`, but the dots live inside
  `<Badge variant="secondary">`, whose background is `--secondary` = `#f4f4f5`. Re-measured on
  the real surface, `in_review` amber `#d97706` is **2.90:1 (fails 3:1)** and `done` green
  `#16a34a` is exactly **3.00:1**. Affects `task-card.tsx:276`, `subtask-list.tsx:248`,
  `dependencies.tsx:394`, `bulk-status-action.tsx:123`, `search/page.tsx:207`. The same class of
  error applies to `project-nav-dot-contrast.test.ts:52-53`, which tests `--sidebar` but not the
  row's `bg-sidebar-accent` hover/active state (`bg-amber-600` = 2.97:1 there).

### MAJ-4 — e2e realtime assertions degrade silently to "renders after a reload"

`f272-two-context-notifications.spec.ts:411-417, 594-596` and
`f272-column-and-lifecycle.spec.ts:464-466` use
`if (!(await x.isVisible().catch(() => false))) await page.reload()`. The headline property of the
two-context file — *live, no-reload delivery to a second browser* — therefore cannot fail on a
dead Realtime wire; it degrades to "the row exists in the DB and renders after a refresh" with no
signal distinguishing the two. Given that `notifications.spec.ts:293` (AS-388, which has no such
fallback) *did* fail in this validator's run, this fallback is actively hiding signal right now.

### MAJ-5 — the command-palette test asserts the negation of its stated goal

`f272-column-and-lifecycle.spec.ts:29-33` promises navigation "with the task pre-selected
(AS-461)". The test at `:540-544` waits for the glob
`**/w/{slug}/projects/{id}/board` with **no** `?taskId=`. Playwright globs match the full URL
including query string — the sibling deep-link test at `:506` uses `board?taskId=*` for exactly
that reason. AS-461's stated outcome is unverified.

### MAJ-6 — a test rewritten to tolerate a reproducible product defect

`checklist-ui.spec.ts:660-691` documents that a single ArrowDown "reproducibly (not flakily —
every run) moves Alpha TWO slots", then runs a correction loop until `alphaIndex === 1`. The final
order assertions at `:693` and `:703` consequently can no longer detect any keyboard-reorder
off-by-one regression. Real bug, deferred, test adjusted around it.

### MAJ-7 — the onboarding tour dialog has no focus management

`components/onboarding/tour.tsx:284-311` renders `role="dialog"` with no `aria-modal`, no
`tabIndex={-1}` on the card, no effect moving focus in on open, and no focus restoration on
`finish()`. Escape works via `useEscapeLayer` (`:222`) so it is not a trap, but a keyboard user
must Tab through the entire page to reach Skip/Back/Next. `components/task/image-lightbox.tsx:132-148`
does all three correctly and is the pattern to copy. F268's "no additional gaps" claim does not
survive this file.

### MAJ-8 — nested focusable controls on the board card

`components/board/sortable-task-card.tsx:120` spreads dnd-kit `attributes` onto a wrapper `<div>`.
dnd-kit always emits `role="button"` + `tabIndex=0` there, **including when `disabled: true`** —
so the wrapper is a focusable button whose accessible name is the card's entire text content,
wrapping `TaskCard`, which is itself `role="button" tabIndex={0}`
(`components/task/task-card.tsx:239-248`). Two nested buttons and two tab stops per card; with
`canDrag={false}` (viewer/guest) the wrapper remains a focusable no-op carrying only
`aria-disabled`. `components/task/checklist.tsx:226-235` shows the correct pattern
(`setActivatorNodeRef` on a small labelled grip).

---

## MINORS

- **MIN-1** — `components/nav/header-search.tsx:105`: the `exhaustive-deps` suppression's
  justification, "navigate is a stable local function", is factually wrong — `navigate` is a plain
  function declaration (`:213`) recreated every render. No live bug results, because it closes only
  over refs, setters and the stable `router`, but the comment misleads the next reader.
- **MIN-2** — `components/nav/project-nav-list.tsx:147-197` nests a `<button>` inside a `<Link>`.
  Operable today only because `ProjectFavoriteButton.handleToggle` calls
  `preventDefault()`/`stopPropagation()` (`components/project-favorite-button.tsx:53-57`).
- **MIN-3** — `components/task/attachment-list.tsx:530`: every row's delete button is
  `aria-label="Delete attachment"`. Has a name (AS-524 literally passes) but is non-distinct across
  rows; `checklist.tsx:272` interpolates the item content and is the better pattern.
- **MIN-4** — `components/task/checklist.tsx:255`: every row's input is
  `aria-label="Checklist item text"`. Same non-distinct-name issue.
- **MIN-5** — `README.md:80-85`: the "Final QA polish (M18)" section describes empty states,
  onboarding, skeletons and error boundaries — not M18's actual content (keyboard/contrast audits,
  typecheck/lint, docs, e2e). Real features, wrong heading.
- **MIN-6** — `README.md:225-226` documents `SENTRY_DSN`/`SENTRY_AUTH_TOKEN` as "required before a
  Vercel deploy", but `grep -rn sentry app lib components next.config.*` returns **nothing** — no
  code path consumes them. `RESEND_*` correctly carries a "**Not currently used by any code path**"
  caveat; Sentry does not.
- **MIN-7** — `components/onboarding/tour.tsx:91` declares `TOUR_DISMISSED_STORAGE_KEY` but does not
  export it; `replay-tour-button.tsx:31` hardcodes the literal. A rename silently breaks replay with
  no type error.
- **MIN-8** — `components/notifications/use-notifications-realtime.ts:60-67`: `void
  supabase.auth.getSession().then(...)` has no `.catch`. A rejection is an unhandled promise
  rejection and the channel is never created — realtime silently dies with no signal. (The
  unmount-during-await path *is* correctly handled by the `cancelled` flag + `unsubscribe?.()`.)
- **MIN-9** — `components/onboarding/tour.tsx:136-140`: the inline `subscribe` is a new function
  every render, so React re-subscribes the no-op store after every commit. Harmless; hoist it.
- **MIN-10** — `notification-panel.tsx:163` calls `onUnreadCountChange?.()` during the render-phase
  adjustment, setting parent state while the child renders. Pre-existing shape, but the `-1` seed
  makes it fire on every panel open.
- **MIN-11** — Six near-identical copies of the tour-dismissal helper across the e2e suite under two
  names (`dismissTourIfPresent`, `dismissOnboardingTour`), with three deadlines (4s/4s/5s) and two
  exit styles, plus one inlined verbatim at `f335-mobile-no-horizontal-scroll.spec.ts:276-290`.
  `loadDotEnv`, `projectRefFromUrl` and the ~50-line magic-link `login` are duplicated across all 13
  files. There is no `fixtures.ts`, global setup, or `storageState` anywhere.
- **MIN-12** — The helper never fails loudly: `isVisible(...).catch(() => false)` +
  `click().catch(() => {})` + falling off the `while` at the deadline. If the tour never leaves,
  the failure surfaces later as an unrelated 30s click timeout. It should throw when still visible
  at the deadline.
- **MIN-13** — Comments at `checklist-ui.spec.ts:303` and `templates-ui.spec.ts:235` say the loop
  runs "for up to ~10s"; the actual deadline is `4_000` ms (`:318`, `:242`).
- **MIN-14** — `f335-mobile-no-horizontal-scroll.spec.ts:318-334` never dismisses the tour, unlike
  test 1 in the same file — latent flake on the `Open navigation` click.
- **MIN-15** — Bell-badge assertions using `/Notifications, \d+ unread/`
  (`f272-two-context-notifications.spec.ts:408, 591`) match any count; the assign test does not clear
  unread first the way the mention test does at `:441-445`. Prefer `Notifications, 1 unread`.

---

## What held up

Stated explicitly, because several of these were the assignment's designated worry areas and they
are genuinely sound:

- **The `tour_completed_at` column grant is safe.**
  `supabase/migrations/20260901010000_...sql` is a single
  `grant update (tour_completed_at) on public.profiles to authenticated;`. No RLS policy is touched,
  nothing is dropped, and the scope is exactly one column. Cross-checked against
  `20260819065751_close_profiles_rls_gaps.sql:264-265`, which deliberately narrowed the grant to
  `timezone` to stop direct PostgREST PATCHes of `display_name`/`avatar_url`/`id`: adding
  `tour_completed_at` reopens none of those, `profiles_update_self`'s `with check (id = auth.uid())`
  still gates rows, and the worst available abuse is a user setting their own tour timestamp. The
  diagnosis in the migration's own comment (RLS and column grants enforced independently) is correct.
  It also correctly covers `replayTour()`'s null-write on the same column.
- **The dnd-kit id fix is correct and behaviour-neutral, with no reachable collision.** All four ids
  are distinct (`board-dnd-context`, `checklist-dnd-context`, `timeline-dnd-context`,
  `calendar-dnd-context`), and `grep -rn "<DndContext"` finds exactly those four instances. The id
  feeds only `useUniqueId("DndDescribedBy", id)`, i.e. the `aria-describedby` value; the live-region
  id is separate and its `Accessibility` component returns `null` until mounted, so it never SSRs.
  No drag behaviour changes. Collision is unreachable: `Board` renders once per board page and hosts
  the single `TaskDetailSheet` (`board.tsx:1109`), `Checklist` renders only inside that one sheet
  (`task-detail-sheet.tsx:1525`), and timeline/calendar are separate routes.
- **The `useSyncExternalStore` hydration fix is correct.** `getSnapshot` returns the primitive
  `true` and a real `getServerSnapshot` returns `false`, so there is no referential-instability
  render loop and the SSR/CSR contract is right. (The flag it guards is MAJ-2's problem, not this
  hook's.)
- **The replay path is sound.** `replay-tour-button.tsx` clears the local flag *and* forces a full
  reload so the layout re-reads the server-side `initialDismissed` — the AS-493 path is not
  self-suppressed.
- **The contrast test machinery is real WCAG maths, not mirroring.** All four files do proper sRGB
  linearization (`v <= 0.03928 ? v/12.92 : ((v+0.055)/1.055)^2.4`), correct luminance weights, and
  correct `(L1+0.05)/(L2+0.05)`. No hardcoded expected strings. Thresholds are correctly
  categorised (3.0 for dots/borders, 4.5 for the `text-xs` label). Regression guards asserting the
  *old* values now fail are a genuinely good touch. Dark-theme variants are covered for both colour
  files. MAJ-3's complaint is about which background is measured, not about the arithmetic.
- **The three F269 colour fixes are real.** `lib/task-colors.ts:81`'s slate-600 → zinc-500 swap
  moves the dark card from 2.18:1 to 3.41:1; `lib/board/column-colors.ts:37` matches.
- **The enumerated-compliant indicators genuinely pair colour with text or icon** — each checked
  individually rather than taken on the handoff's word: blocked badge (`Ban` + literal "Blocked",
  `task-card.tsx:357-362`), recurring (`Repeat` + summary text, `:333-341`), priority badge
  (`PRIORITY_LABELS` inside the badge, `:268-279`), overdue (`TriangleAlert` + `sr-only`
  "Overdue:", `:281-297`), over-estimate, completion bar (percent as text + `aria-label`), and the
  status dots in `subtask-list.tsx`, `dependencies.tsx`, `bulk-status-action.tsx`,
  `list-status-select.tsx`, `search/page.tsx`. BLOCKER-2 is a gap in *coverage*, not a wrong claim
  about these.
- **Several F268-claimed surfaces do hold up under independent audit**: `checklist.tsx`
  (`KeyboardSensor` + `sortableKeyboardCoordinates`, `setActivatorNodeRef` on a labelled grip,
  per-item aria-labels — the best example in the codebase), `image-lightbox.tsx` (labels, focus in
  on open, focus restored on close, Escape via the shared layer), the attachment dropzone (real
  `<input type="file">` with an `sr-only` label as the keyboard alternative, thumbnails as
  `<button aria-label={"Open " + fileName}>`), `notification-bell.tsx` (dynamic count-bearing
  label), and `notification-panel.tsx`. **All five `DndContext` instances register a
  `KeyboardSensor`**; there is no positive `tabIndex` anywhere in `components/`.
- **F268's arrow-key tests are genuinely behavioural.** `tests/unit/header-search.test.tsx:167`
  asserts ArrowDown×2 + Enter pushes the *task's* project id (`proj-9`), so an off-by-one in the
  flattened index fails it; `:199` asserts ArrowUp wraps to last and that `aria-activedescendant` is
  *absent* before any arrow key; `:224` asserts `aria-selected` flips both ways on Home/End. These
  would fail if the behaviour broke. (The Escape test at `:280` is weaker — it calls
  `popTopEscapeLayer()` directly rather than pressing Escape, so key wiring is untested; and `:277`
  hardcodes `"Marketing SiteMKT"`, mirroring the layout.)
- **F270's deferral is right.** No new `any`, `@ts-ignore` or `@ts-expect-error` anywhere in the
  milestone diff; `tsc` and `eslint` both exit 0; the three deprecated `tasks` columns have live
  readers/triggers and dropping them would have been the wrong call.
- **F271's env table is complete.** All 10 `.env.example` keys are documented with a source; the
  pg_cron table matches the two real `cron.schedule` migrations and correctly records the absent
  digest job.
- **The strongest new e2e work is genuinely end-to-end.** The four `expect(async () => {...})
  .toPass()` DB-polling blocks in `f272-column-and-lifecycle.spec.ts` (`:313, 376, 428, 452`) verify
  server-side persistence rather than optimistic UI, and test 1 (create column → drag → assert DB
  `status` → reload → assert presence in the new column *and* `toHaveCount(0)` in the old) is real.
  The `/t/[taskKey]` deep-link test uses a fresh context, a real redirect, and asserts the title by
  value. Across the suite there is no `expect(true).toBe(true)`, no `expect.soft`, no `.only`, no
  `test.fixme`, and no assertion buried in a swallowing `try/catch`.
- **Cross-file e2e state isolation is sound.** Each file creates a uniquely-suffixed
  workspace/users/project in `beforeAll` and deletes them in `afterAll`; with `workers: 1` and
  `fullyParallel: false`, cross-file interference is structurally impossible by design (which is
  itself why the `--workers=2` run is not a fair configuration and run B was performed).

---

## Recommended follow-up features

Blockers first. Each paragraph is a spec for the orchestrator to formalise.

**FU-A (blocker, AS-530) — reproduce or refute the e2e suite's green status from purged state.**
Before any further diagnosis, establish ground truth. Purge all residual e2e-created workspaces,
users, projects and notifications from the linked Supabase project (every spec's `afterAll`
deletes by unique suffix, so orphans from aborted runs are identifiable), then run
`npx playwright test` at the config default with `retries: 0` explicitly pinned and
`haveAdminCreds` true, capturing the full list reporter output. Report the pass/fail split and,
for every failure, the spec, the assertion, and whether it reproduces on a second consecutive run.
Do **not** modify any spec or product file in this feature — it is a measurement task whose only
deliverable is a report. This validator observed 12/31 failing at the default config and 14/31 at
`--workers=2`, spanning `blocked-done-guard`, `checklist-ui`, `dependency-ui`,
`f272-column-and-lifecycle`, `f272-two-context-notifications`, `notifications`, `subtask-ui` and
`templates-ui`; AS-530 cannot be marked PASS until that is either reproduced-and-fixed or shown to
be an artefact of contaminated state.

**FU-B (blocker) — fix `addComment` 500-ing on any comment containing a mention node.**
`tests/e2e/f272-two-context-notifications.spec.ts:473-497` documents that `addComment`
(`lib/actions/comments.ts:119`) throws "Cannot access id on the server. You cannot dot into a
temporary client reference from a server component" whenever the submitted body contains a real
`mention` node from the composer, reproduced 3/3. The likely cause is a client-side function
reference (the `resolveLabel` parameter of `extractPlainText`, `lib/comments/rich-text.ts:104-106`)
crossing the Server Action boundary inside the serialised payload, or a mention node attribute
holding a client reference. Fix the serialisation boundary so the server recomputes the plain-text
projection from the validated JSON alone. Then rewrite the mention half of the e2e test to submit
via the real "Post" button rather than the admin-client `insert` + `create_notification` RPC
stand-in at `:525-574`, so the test actually exercises product fan-out. Add a unit test that calls
`addComment` with a mention-bearing body and asserts both the persisted `text` projection and the
created `mention` notification.

**FU-C (blocker, AS-523) — make header-search options keyboard-operable.**
In `components/nav/header-search.tsx:380-395`, add an `onClick` handler alongside the existing
`onMouseDown` (keeping the mousedown path, which exists deliberately to beat the input's blur) and
add `tabIndex={-1}` so options leave the tab sequence, as the `aria-activedescendant` combobox
pattern this component implements requires. Add two tests to
`tests/unit/header-search.test.tsx`: one asserting that an option is not a tab stop, and one
asserting that a `click` (not `mousedown`) on an option navigates — the current AS-521 tests use
`fireEvent.mouseDown` exclusively and pass with the bug present. While in the file, consider
converting the group-wrapping `<div>`s at `:313, 339` to `role="presentation"` so options are
proper `listbox` children (MIN, optional).

**FU-D (blocker, AS-525) — pair priority with text on the calendar and timeline.**
Five call sites convey priority by colour alone. In `components/calendar/day-cell.tsx:155-159`,
`components/calendar/agenda-list.tsx:122-126` and `components/calendar/day-overflow.tsx:69-73`,
either add an `sr-only` `PRIORITY_LABELS[priority]` span beside the `aria-hidden` dot or fold
priority into the row's `title`/accessible name — matching the pattern already used at
`components/task/task-card.tsx:268-279`. In `components/timeline/timeline-bar.tsx:28,45` and
`components/timeline/timeline-bar-draggable.tsx:57`, include the priority label in the existing
`aria-label`/`title` (currently `${taskKey} ${title}`), which also covers the `layout.kind !==
"range"` marker branch that renders no visible text at all. Add unit tests asserting each surface's
accessible name contains the priority label.

**FU-E (major) — stop the notification panel resurrecting read notifications on re-open.**
`components/notifications/notification-panel.tsx:153-164`'s `-1` sentinel re-applies the bell's
last `liveSnapshot` on every popover re-open, because Radix unmounts the content on close and the
bell never invalidates `liveSnapshot` when the panel marks items read
(`notification-bell.tsx:40-44, 165-171`; reconcile fires only on Realtime insert or tab focus, not
on popover open). Repro: open bell → Mark all as read → close → re-open → rows show unread again
and the stale count is pushed back into the badge. Fix by having the bell clear or refresh
`liveSnapshot` when the panel reports a read-state mutation, or by reconciling on
`onOpenChange(true)`. Add a test covering mark-all-read → unmount → remount-with-stale-snapshot.
Also move the `onUnreadCountChange?.()` call at `:163` out of the render phase (MIN-10).

**FU-F (major) — scope the tour-dismissal localStorage flag to the user and clear it on sign-out.**
`components/onboarding/tour.tsx:91` uses a browser-global `pm-app-tour-dismissed` key, so on a
shared browser one user's dismissal permanently suppresses the next user's first-run tour,
contradicting AS-492. Key it as `pm-app-tour-dismissed:<userId>` (the workspace layout already has
the user id and passes `initialDismissed`), export the key constant from `tour.tsx` so
`replay-tour-button.tsx:31` stops hardcoding the literal (MIN-7), and clear it client-side on
sign-out. Add a test asserting that a flag written under user A's id does not suppress the tour for
user B.

**FU-G (major, AS-526) — fix the three sub-4.5:1 text placements and re-point the dot tests.**
Stop using `PRIORITY_COLORS` as a text colour at
`app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx:231` (urgent 3.76:1, high 3.56:1, low 3.68:1
on the white card) — keep the border tint and use `text-foreground`. Same for the `text-white` over
priority backgrounds at `components/timeline/timeline-bar.tsx:37` and
`timeline-bar-draggable.tsx:103`. Then re-point the dot contrast tests from `--card` to the
`--secondary` surface the dots actually render on and from `--sidebar` to `--sidebar-accent` for
the hover/active nav row, and fix the entries that then fail (`in_review` amber `#d97706` at
2.90:1, `bg-amber-600` at 2.97:1 on the accent row). Pin the dark-theme constants to the real
values (`#171717` for `--card`, `#262626` for `--secondary`/`--muted`) rather than the current
conservative approximations.

**FU-H (major/minor, test hygiene) — consolidate and harden the e2e helpers.**
Extract `dismissTourIfPresent`/`dismissOnboardingTour`, `loadDotEnv`, `projectRefFromUrl` and the
magic-link `login` into a single `tests/e2e/fixtures.ts` (there is currently no fixture file,
global setup or `storageState` anywhere), with one deadline and one name. Make the dismissal helper
**throw** when the tour is still visible at the deadline instead of returning silently (MIN-12), so
the failure surfaces where it happens rather than as an unrelated click timeout. Fix the
"~10s"/4s comment drift (MIN-13), add the missing dismissal to
`f335-mobile-no-horizontal-scroll.spec.ts:318-334` (MIN-14), tighten the `\d+ unread` regexes to
exact counts (MIN-15), fix the palette test's glob to require `?taskId=` (MAJ-5), and replace the
silent `page.reload()` realtime fallbacks (MAJ-4) with a hard assertion plus a
`test.info().annotations` note — those fallbacks are hiding signal right now, given that the
comparable no-fallback assertion in `notifications.spec.ts:293` failed in this validator's run.
Separately, file the checklist keyboard-reorder off-by-one that `checklist-ui.spec.ts:660-691`
currently corrects around (MAJ-6) as its own product bug.

**FU-I (minor, AS-529 + AS-523 polish) — README accuracy and residual a11y nits.**
Rewrite `README.md:80-85` so the "Final QA polish (M18)" section describes M18's actual content;
add a "not currently used by any code path" caveat to the `SENTRY_DSN`/`SENTRY_AUTH_TOKEN` rows at
`:225-226` matching the one `RESEND_*` already carries, since no code references Sentry. Then:
add focus management to the tour dialog (`components/onboarding/tour.tsx:284-311`, copying
`image-lightbox.tsx:132-148`) per MAJ-7; give the board card a dedicated drag handle via
`setActivatorNodeRef` instead of spreading dnd-kit `attributes` onto the card wrapper
(`components/board/sortable-task-card.tsx:120`) per MAJ-8; un-nest the favourite `<button>` from
the project `<Link>` (`components/nav/project-nav-list.tsx:147-197`); interpolate row content into
the repeated `aria-label`s at `attachment-list.tsx:530` and `checklist.tsx:255`; add the missing
`.catch` to `use-notifications-realtime.ts:60-67`; and correct the inaccurate `exhaustive-deps`
justification comment at `header-search.tsx:105`.

---

## Full toolchain output

### `npx tsc --noEmit`

```
(no output — exit 0)
```

### `npx eslint .`

```
/Users/sasajapranin/Desktop/pm-app/lib/queries/search.ts
  280:27  warning  '_titleMatches' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/invite-member-pagination.test.ts
  186:22  warning  '_columns' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/palette-actions-recents.test.tsx
  55:36  warning  '_workspaceId' is defined but never used  @typescript-eslint/no-unused-vars
  55:58  warning  '_query' is defined but never used        @typescript-eslint/no-unused-vars
  74:41  warning  '_workspaceId' is defined but never used  @typescript-eslint/no-unused-vars
  74:63  warning  '_pointers' is defined but never used     @typescript-eslint/no-unused-vars

✖ 6 problems (0 errors, 6 warnings)

exit 0
```

### `npx vitest run tests/unit`

```
 Test Files  167 passed (167)
      Tests  1305 passed (1305)
     Errors  1 error
   Duration  31.09s

(the one error is the pre-existing unhandled rejection originating in
tests/unit/user-avatar.test.tsx — cookies() outside request scope via
getMentionCandidates. It fails no test. exit 0)
```

### `npx next build`

```
exit 0 — full route manifest emitted, all workspace routes present
(ƒ dynamic / ○ static as expected). No build errors or warnings.
```

### `npx playwright test --workers=2` (run A — NON-DEFAULT worker count, recorded for completeness)

```
  14 failed
    checklist-ui.spec.ts:390, :476, :601
    dependency-ui.spec.ts:281, :333
    f272-column-and-lifecycle.spec.ts:395, :470, :518
    f272-two-context-notifications.spec.ts:329, :429
    notifications.spec.ts:293
    subtask-ui.spec.ts:278, :308
    templates-ui.spec.ts:273
  17 passed (6.3m)
```

Note: `playwright.config.ts:19-22` sets `fullyParallel: false` and `workers: 1`, so
`--workers=2` is an unsupported configuration and this run is NOT evidence against AS-530
on its own. It is recorded only because run B was executed against the state it left behind.

### `npx playwright test` (run B — CONFIG DEFAULT: workers 1, fullyParallel false, retries 0)

```
  1) blocked-done-guard.spec.ts:308 › AS-280: moving a blocked task to Done warns...
     Error: expect(locator).toBeVisible() failed
     Locator: getByRole('alertdialog')
     Expected: visible   Timeout: 5000ms   Error: element(s) not found
       > 325 |     await expect(dialog).toBeVisible();

  9) notifications.spec.ts:293 › AS-388: a new notification ... increments the bell's
     badge live, with no reload
     Error: expect(locator).toBeVisible() failed
     Locator: getByRole('button', { name: 'Notifications, 1 unread' })
     Expected: visible   Timeout: 15000ms   Error: element(s) not found
       > 338 |     ).toBeVisible({ timeout: 15_000 });

  14) templates-ui.spec.ts:273 › AS-328 (UI half): saving a task as a template ...
     Error: expect(locator).toBeVisible() failed
     Locator: getByText('Saved "F183 Saved Template ..." as a template.')
     Expected: visible   Timeout: 5000ms   Error: element(s) not found
       > 316 |     await expect(page.getByText(`Saved "${templateName}" as a template.`))...

  12 failed
    [chromium] › blocked-done-guard.spec.ts:308:7
    [chromium] › checklist-ui.spec.ts:390:7
    [chromium] › checklist-ui.spec.ts:476:7
    [chromium] › checklist-ui.spec.ts:601:7
    [chromium] › dependency-ui.spec.ts:281:7
    [chromium] › dependency-ui.spec.ts:333:7
    [chromium] › f272-column-and-lifecycle.spec.ts:395:7
    [chromium] › f272-two-context-notifications.spec.ts:329:7
    [chromium] › notifications.spec.ts:293:7
    [chromium] › subtask-ui.spec.ts:278:7
    [chromium] › subtask-ui.spec.ts:308:7
    [chromium] › templates-ui.spec.ts:273:7
  19 passed (11.9m)

EXIT=1
```

Distinct failure signatures observed across the 12: `toBeVisible` element-not-found (7),
`toHaveValue` element-not-found (2), `toHaveCount` mismatch (2), `toBe` equality (1),
`not.toBeNull` (1), and one `page.waitForTimeout` 30s test timeout. Full untruncated log
retained at the run's `test-results/` directory (traces and screenshots per failure).
