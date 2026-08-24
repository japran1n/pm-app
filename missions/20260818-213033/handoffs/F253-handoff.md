# Handoff: F253 — first-run guided tour

## Status
COMPLETE

## Assertions covered
AS-491: PASS — `getTourStatus` reports `dismissed: false` for a NULL `tour_completed_at` (tests/unit/onboarding-tour.test.ts); component-level: the tour renders welcome -> sidebar -> board -> create-task steps in order, each anchored to a real `data-tour` target (tests/unit/onboarding-tour-component.test.tsx, `test_AS_491_offers_the_tour_...`); a step whose target is absent (e.g. a viewer with no "New task" trigger) is silently skipped (`test_AS_491_skips_a_step_whose_target_does_not_exist_for_this_viewer`).
AS-492: PASS — `dismissTour` persists a non-null timestamp and a subsequent independent read (simulating reload/new tab) still reports dismissed (tests/unit/onboarding-tour.test.ts); component-level: clicking Skip calls the persistence action and removes the tour from the DOM, a fresh mount with `initialDismissed: true` never shows it, and Escape dismisses via the shared escape-layer stack (tests/unit/onboarding-tour-component.test.tsx).
AS-493: PASS — `replayTour` resets `tour_completed_at` back to NULL (tests/unit/onboarding-tour.test.ts, `test AS-493`); the UI half (`ReplayTourButton` on the profile settings page) is verified by source inspection + `npx next build` succeeding with that route compiling — no live-DB Playwright run was performed for the reload-triggered UI redirect itself (see Notes).

## Files changed
supabase/migrations/20260830010000_add_profiles_tour_completed_at.sql
lib/actions/onboarding-tour.ts
components/onboarding/tour.tsx
components/onboarding/replay-tour-button.tsx
components/nav/app-sidebar.tsx
components/board/board.tsx
app/(workspace)/w/[workspaceSlug]/layout.tsx
app/(workspace)/w/[workspaceSlug]/settings/profile/page.tsx
tests/unit/onboarding-tour.test.ts
tests/unit/onboarding-tour-component.test.tsx

## Commands run
`supabase db push --include-all` (0) — applied 20260830010000_add_profiles_tour_completed_at.sql to the linked project (qcipqonnqajmazdbysow)
`npx vitest run tests/unit/onboarding-tour.test.ts tests/unit/onboarding-tour-component.test.tsx` (0) — 2 files, 12 tests, all passed
`npx tsc --noEmit` (0) — no output, clean
`npx eslint .` (0) — 6 warnings (baseline), 0 errors — literal output: "✖ 6 problems (0 errors, 6 warnings)" (the 6 pre-existing `_var`-unused warnings in lib/queries/search.ts, tests/unit/invite-member-pagination.test.ts, tests/unit/palette-actions-recents.test.tsx — none introduced by this feature)
`npx next build` (0) — "✓ Compiled successfully in 1162ms", TypeScript finished in 2.2s, all 13 static + dynamic routes generated including `/w/[workspaceSlug]/settings/profile`
`npx vitest run tests/unit` (0, with 1 unrelated unhandled-rejection warning) — literal summary: "Test Files 146 passed (146)" / "Tests 1114 passed (1114)". The one logged "Unhandled Rejection: `cookies` was called outside a request scope" originates in `tests/unit/user-avatar.test.tsx` via `lib/actions/comments.ts`'s `getMentionCandidates` — pre-existing, unrelated to onboarding-tour.ts/tour.tsx (no `comments` or `user-avatar` files touched by this feature), and did not fail any test (all 1114 passed). Baseline was 144 files / 1102 tests; this feature adds 2 files / 12 tests, both incremental and green.

## Decisions made
- Persistence: reused the existing `profiles` table (one nullable `tour_completed_at timestamptz` column, additive migration) rather than a new table, matching notification_preferences/board_swimlane_prefs' self-scoped-RLS convention exactly (`profiles_update_self` policy already covers it — no new RLS policy needed). NULL = never dismissed/offer the tour; non-null timestamp = dismissed; reset to NULL = replay. Rejected a new `onboarding_tour_state` table (unnecessary second per-user-prefs table) and localStorage (per-browser, not per-user, contradicts the spec's explicit "on the profile" requirement and F243's own localStorage precedent is for ephemeral UI recents, not durable identity state).
- Anchoring: 4 popover steps (welcome/unanchored + sidebar/board/create-task, each anchored via a `data-tour="..."` attribute already added to the real elements — sidebar `<nav>`, board's outer container, and a thin `<span>` wrapper around `<NewTaskDialog>`) computed from `getBoundingClientRect()` at render time, not stored via `setState` inside an effect (kept off the repo's `react-hooks/set-state-in-effect` lint rule the same way `components/theme-toggle.tsx` documents doing).
- Skip rule: a step is dropped from the sequence at the moment the tour opens if `document.querySelector(step.targetSelector)` finds nothing — this is how a viewer (no visible "New task" trigger, since `NewTaskDialog` already gates that control by `canWrite`) naturally never sees a step pointing at a control they don't have, with zero extra role-checking logic inside the tour itself.
- Escape: cooperates with F244's shared escape-layer stack (`useEscapeLayer`/`pushEscapeLayer` from `lib/hooks/use-shortcut.ts`) instead of a second document keydown listener, closing only when the tour is the topmost registered layer.
- Replay entry point: added to the profile settings page (`/w/[workspaceSlug]/settings/profile`) rather than inventing a new dropdown "profile menu" — this app has no such menu yet (only a sidebar link straight to that page, per F273's own comment in app-sidebar.tsx), and the clarified spec's "simpler option, no new dependency" instruction rules out building one just for this replay button.

## Out-of-scope work needed
- This app has no dropdown "profile menu" or "help menu" component yet (F253's spec assumed one exists — "Replay entry point in the profile menu"). The replay button lives on the profile settings page instead, which is reachable from the sidebar. If a future feature adds a real profile/help dropdown, the replay button should move there.
- No Playwright e2e spec was added for the full click-through-tour-in-a-real-browser path or the replay-button's reload-and-reopen flow; per the mission's known infra note, every authenticated Playwright spec fails in the shared login helper today, so a new e2e spec here would not have produced trustworthy signal. Unit + jsdom component tests cover the DOM-level behaviour (render order, skip rule, dismiss-removes-from-DOM, Escape cooperation) and Server Action tests cover the actual persisted-read-after-write path.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `profiles.tour_completed_at` over a new table (see Decisions made above) — the clarified spec's "simpler option, no new dependency, no second source of truth" instruction applied to the open "where does per-user tour dismissal live" question in the spec's own Notes.
AUTONOMOUS_DECISION: Chose the profile settings page as the replay entry point since no dropdown "profile menu" exists in this codebase yet — see Out-of-scope work needed.
AUTONOMOUS_DECISION: Tour steps are 4 (welcome + sidebar + board + create-task), inside the spec's "4-5 steps" range.

## Notes for the next worker
- `TOUR_STEPS` is exported from `components/onboarding/tour.tsx` as the one source of truth for the step sequence — do not hand-copy it elsewhere (mirrors this codebase's `SHORTCUT_REGISTRY` convention in `lib/hooks/use-shortcut.ts`).
- The board's "create a task" anchor is a `<span data-tour="new-task-trigger">` wrapper around `<NewTaskDialog>` in `components/board/board.tsx` rather than a change to `new-task-dialog.tsx` itself — kept the data attribute out of that shared dialog component since it's mounted from multiple call sites (board toolbar, board empty state, list toolbar) and only the board toolbar instance needed the tour anchor.
- MCP usage: none required at run time (Supabase MCP listed as `Optional` in the registry and reported "Pending approval"; the standing rule "never block a feature on MCP approval" applied) — schema change was applied and verified via `supabase db push` (CLI), the primary path per `connections/mcp-registry.md`.
