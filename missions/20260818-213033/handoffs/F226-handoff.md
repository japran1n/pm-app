# Handoff: F226 — swimlane-collapse-persist

## Status
COMPLETE

## Assertions covered
AS-422: PASS — `test_AS_422_collapsing_a_lane_persists_across_a_real_reload_of_the_same_mode`, `test_AS_422_switching_grouping_mode_does_not_carry_a_stale_collapse_across_modes`, `test_AS_422_a_lane_key_that_no_longer_exists_is_silently_dropped_on_the_next_write_for_that_mode_not_corrupted`, `test_AS_422_AS_424_deleting_the_parent_project_cascades_the_preference_row_away` (all `tests/integration/f226-swimlane-collapse-persist.test.ts`, real Server Action round trip); plus DOM-level proof in `tests/unit/f226-swimlane-collapse-persist.test.ts`'s `test_AS_422_a_persisted_collapsed_lane_renders_collapsed_on_first_paint_hiding_its_columns` and `test_AS_422_a_lane_not_in_the_persisted_collapsed_set_renders_expanded`.
AS-424: PASS — `test_AS_424_chosen_grouping_persists_per_user_per_project_through_the_real_action`, `test_AS_422_AS_424_one_users_collapse_and_grouping_never_affects_another_users_prefs_for_the_same_project` (real Server Action round trip); plus `tests/unit/f226-swimlane-collapse-persist.test.ts`'s `test_AS_424_no_groupBy_in_the_URL_falls_back_to_the_viewer_s_persisted_grouping_preference` and `test_AS_424_an_explicit_groupBy_none_in_the_URL_still_wins_over_a_persisted_non_none_preference`.

## Files changed
supabase/migrations/20260825030000_create_board_swimlane_prefs.sql (new)
lib/actions/board-prefs.ts (new)
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/board/page.tsx
components/board/board.tsx
components/board/board-toolbar.tsx
components/board/swimlane.tsx
tests/integration/f226-swimlane-collapse-persist.test.ts (new)
tests/unit/f226-swimlane-collapse-persist.test.ts (new)

## Commands run
`npx supabase db push` (0) — applied `20260825030000_create_board_swimlane_prefs.sql` to the real linked project.
CORRECTION (post-commit fix, see below): the FIRST `npx tsc --noEmit` run reported as "(0)" in the original version of this handoff was WRONG — the orchestrator caught a real type error the same session:
```
tests/unit/f226-swimlane-collapse-persist.test.ts(29,34): error TS2556: A spread argument must either have a tuple type or be passed to a rest parameter.
```
Cause: `vi.fn(async () => ({ ok: true }))` infers a zero-parameter mock signature; spreading `(...args: unknown[])` into it doesn't type-check. Fixed by importing the real action's own `UpsertBoardSwimlanePrefsInput`/`UpsertBoardSwimlanePrefsResult` types from `@/lib/actions/board-prefs` and giving `vi.fn` an explicit `(input: UpsertBoardSwimlanePrefsInput) => Promise<UpsertBoardSwimlanePrefsResult>` type argument, then typing the mock wrapper's parameter to that same input type instead of `unknown[]` — no `@ts-expect-error`/`as any`, and the mock still asserts the real argument shape. Re-ran after the fix and confirmed clean:
`npx tsc --noEmit` (0) — verified output is empty (no errors), re-run after the fix above.
`npx eslint .` (0, 2 pre-existing unrelated warnings in lib/queries/search.ts and tests/unit/invite-member-pagination.test.ts — not touched by this feature), re-run after the fix, same 2 warnings, 0 errors.
`npx vitest run tests/unit/f226-swimlane-collapse-persist.test.ts tests/integration/f226-swimlane-collapse-persist.test.ts` (0) — 2 files, 10 tests, all passed, re-run after the fix.
`npx vitest run tests/integration/f221-board-custom-columns.test.ts tests/integration/f222-status-category-semantics.test.ts tests/integration/f223-status-integration-list-search-dashboard.test.ts tests/integration/f224-board-swimlane-grouping.test.ts tests/integration/f225-swimlane-drag-reassign.test.ts tests/unit/f224-board-swimlane-grouping.test.ts tests/unit/f225-swimlane-drag-reassign.test.ts` (0) — F221–F225 board regression slice, 7 files, 59 tests, all passed.
`npm test` (full suite, run twice) — both runs showed widespread unrelated failures (`AuthRetryableFetchError: Database error finding users`, `Request rate limit reached` on `signInWithPassword`) across ~20+ files completely unrelated to this feature (workspace-role-expansion, invite-member, recurrence-scheduled-generation, checklist-actions, f219-status-management, dependency-ui-actions, etc.) — matching this feature's "known infra conditions" note (Supabase Auth rate limiting) verbatim, not a code regression. The SAME f224/f225/f226 test files that failed inside the full run (with the log literally saying `Error: Failed to sign in ...: Request rate limit reached`) passed 100% (47/47) when re-run alone immediately after, confirming rate-limiting, not a real defect.

## Decisions made
- Persistence: chose server-side (Supabase table `board_swimlane_prefs`) over localStorage — per this feature's Notes for clarification and the clarified "ambiguity resolution" answer (simpler option that reuses an existing convention). Reused `notification_preferences`'s own-row RLS pattern exactly (own session client, no admin client, no SECURITY DEFINER RPC needed since a user only ever writes their own row) — see the migration's own header comment for the point-by-point comparison.
- Table shape: one row per (user_id, project_id), NOT auto-created on sign-up (unlike notification_preferences, which is one row per user auto-created via an `auth.users` insert trigger) — a user may never open a given project's board, so there's no sensible "every project" backfill target. Absence of a row is treated as the exact pre-F226 default (`groupBy: "none", collapsedLanes: {}`) by `getBoardSwimlanePrefs`.
- `collapsed_lanes` stored as a JSON OBJECT keyed by grouping mode (`{"assignee": [...], "priority": [...], "tag": [...]}`), not a flat array — this is the mechanism that satisfies "switching grouping mode does not carry a stale collapse across" (Definition of done test list item 3): a toggle under one mode can only ever read/write that mode's own array.
- Stale lane keys (renamed tag / removed assignee) are handled by REPLACEMENT, not merging: `upsertBoardSwimlanePrefs`'s `collapsedLanesForMode` always receives the FULL current set of collapsed keys for one mode from the caller (board.tsx derives it from live `swimlaneGroups`), so a key for a lane that no longer renders is simply absent from the next write and silently drops out of storage — no cleanup migration or special-case lookup needed, and no crash on a stale key that's still present until the next write (a `Set.has()` lookup against a name that no longer exists just returns `false`).
- Grouping-mode persistence (AS-424) lives in `BoardToolbar`'s `handleChange` (fire-and-forget `upsertBoardSwimlanePrefs({ projectId, groupBy })` alongside the existing URL push) rather than a `useEffect` in `board.tsx`, so it only fires on an actual user action, never on every render/prop change.
- URL vs persisted-preference precedence for `groupBy`: an explicit `?groupBy=` value (including `none`) in the URL always wins over the persisted preference (preserves "URL search params for anything shareable" — a bookmarked/shared board URL must render identically for every viewer regardless of their own preference); ONLY when the param is entirely absent does the persisted preference apply. This keeps AS-419 (`no groupBy param -> pre-F224 layout`) true for a genuinely first-time viewer with no persisted row (falls through to `"none"`), while making a returning viewer's own choice sticky.
- Collapse toggle button uses `disabled={!onToggleCollapsed}` rather than omitting the button, so a caller that doesn't wire persistence (e.g. an older test rendering `<Swimlane>` directly) still gets an accessible, visibly-present-but-inert control instead of a silently-missing one.

## Out-of-scope work needed
- None identified specific to this feature. `BoardColumn`, `groupTasksIntoSwimlanes`, and the drag/drop wiring from F224/F225 were reused entirely unchanged.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose server-side persistence over localStorage for the reasons above (cross-device consistency, reuse of an existing self-scoped-RLS convention, no new dependency).
AUTONOMOUS_DECISION: `board_swimlane_prefs` is per (user, project), not auto-created, since (unlike per-user notification preferences) there is no fixed universe of projects to backfill for a given user at sign-up time; "no row" is defined as identical to today's pre-F226 defaults so this is invisible to every existing viewer until they interact with grouping/collapse.
AUTONOMOUS_DECISION: An explicit `?groupBy=` URL param (including `none`) always overrides the persisted preference, matching the "URL search params for anything shareable" state-location rule from this feature's own Clarified implementation section; only an absent param falls back to the persisted value.

## Notes for the next worker
- MCP usage: Supabase MCP was not invoked directly (registered as "Optional"/"Pending approval" per `mcp-registry.md`); schema application and verification went through the Supabase CLI (`npx supabase db push`), the registry's documented primary path — the migration applied cleanly against the real linked project (`qcipqonnqajmazdbysow`).
- The full-suite `npm test` run is currently noisy with Supabase Auth rate-limiting (`Request rate limit reached` on `signInWithPassword`) and an intermittent `AuthRetryableFetchError: Database error finding users` from `auth.admin.listUsers`, affecting ~20+ unrelated integration test files across two consecutive full runs (different files each time) — this is the documented "known infra condition," not something introduced by this feature. Anyone re-verifying this feature should run the six files listed under "Commands run" standalone rather than trusting a single full-suite pass/fail.
- `Swimlane`'s collapse toggle button is a plain icon `Button` (`components/ui/button.tsx`, existing primitive) with `aria-expanded`/`aria-label` — no new UI primitive was added, per the clarified "existing primitives... rather than new parallel implementations" answer.
