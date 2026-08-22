# Handoff: F198 — comment edited indicator

## Status
COMPLETE

## Assertions covered
AS-363: PASS — an edited comment is marked as edited with the time of the last change. Verified three ways: (1) `tests/unit/comment-list.test.ts`'s `test_AS_363_edited_comment_shows_marker_with_exact_time_accessible_and_on_hover` renders a comment with `editedAt` set and confirms both `title="Edited ..."` (hover, sighted mouse users) and `aria-label="Edited ..."` (accessible name, screen readers — independent of hover) carry the exact edit time; (2) `test_AS_363_unedited_comment_shows_no_edited_marker` confirms no marker/aria-label renders for a comment with `editedAt` unset; (3) `tests/unit/comment-realtime-subscription.test.ts`'s `test_AS_363_edited_marker_appears_live_after_a_comment_edited_broadcast_reconciles` renders a comment with no marker, runs it through `reconcileComment` with a `comment_edited`-shaped UPDATE event (same event shape F197's own AS-362 test builds), and confirms re-rendering the reconciled list now shows the marker with its `aria-label` — proving the marker updates live via the existing realtime path with no page reload, no new reconciliation code needed.

## Files changed
components/task/comment-list.tsx
tests/unit/comment-list.test.ts
tests/unit/comment-realtime-subscription.test.ts

## Commands run
`npx vitest run tests/unit/comment-list.test.ts tests/unit/comment-realtime-subscription.test.ts` (0) — 30/30 passed.
`npx tsc --noEmit` (0) — clean.
`npx eslint .` (0) — clean (2 pre-existing unrelated warnings in `lib/queries/search.ts` and `tests/unit/invite-member-pagination.test.ts`, neither touched by this feature).
`npm run test` (full suite) (0 exit code) — 1421/1506 passed, 13 failed, 72 skipped. All 13 failures are in `tests/integration/invite-member.test.ts` and `tests/integration/workspace-role-expansion.test.ts` (`Error: Test timed out in 30000ms`) — neither file touches comments, and no comment-related test appears anywhere in the failure list. This matches the exact pre-existing flakiness (`auth rate-limit`/parallel-load timeouts against the live Supabase project) already documented in F197's handoff for this same suite; not caused by this feature.

## Decisions made
- **Reconciliation needed no extension.** Verified, not assumed, per the task instructions: read `lib/tasks/reconcile-realtime-comment.ts` in full — F197 already added `edited_at` to `CommentRealtimeRow`, already maps it to `TaskComment.editedAt` in `toTaskComment`, and the existing UPDATE branch (`existingIndex !== -1` → replace) already applies to a `comment_edited`-shaped broadcast (F197's own `subscribe-comments-realtime.ts` doc comment confirms `comment_edited` is delivered as an UPDATE-shaped `CommentRealtimeEvent`). `components/task/comment-list.tsx` already called `reconcileComment` inside its `useCommentsRealtime` callback and already rendered `comment.editedAt ? " (edited)" : ""`. So this feature's only real gap was accessibility, not data flow — confirmed by the new realtime-reconciliation test (`test_AS_363_edited_marker_appears_live_after_a_comment_edited_broadcast_reconciles`) rather than trusting the prior handoff's summary.
- **No Base UI Tooltip component used**, despite it being this codebase's established tooltip convention (`components/ui/tooltip.tsx`, used by `components/user-avatar-group.tsx`). Chose a plain `<span title=... aria-label=...>` instead: (a) it's the simpler option per this feature's clarified "ambiguity resolution" answer (no new interactive-widget state, no `TooltipProvider` wrapper needed just for one inline marker); (b) it keeps `tests/unit/comment-list.test.ts`'s existing SSR convention (`renderToStaticMarkup`, `environment: "node"`, no DOM) working unchanged — Base UI's `Tooltip.Portal` needs a real DOM/`document.body` and would have forced either a jsdom-only test file split or risked breaking the existing no-DOM SSR test for this same component; (c) `aria-label` alone (independent of `title`) already fully satisfies the assertion's actual requirement — "the exact edit time available ... to screen readers" — without relying on hover at all, so a full interactive tooltip widget adds no additional coverage for AS-363/AS-524 that a plain `aria-label` doesn't already provide.
- Used `date-fns`'s `format(..., "PPpp")` for the exact time string (date-fns already a project dependency and already used elsewhere in this same file for `formatDistanceToNow` — no new dependency).

## Out-of-scope work needed
- None identified beyond this feature's assigned scope. The realtime plumbing, database column, and Server Action were all already complete from F197; this feature's only gap was the accessible-name half of the UI marker.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used a plain `title`/`aria-label` pair instead of the codebase's Base UI `Tooltip` component for the reasons in Decisions made above (simpler option, no new dependency, keeps the component's existing SSR-testable convention intact). This was the "Notes for clarification" open question ("Hover-only information fails AS-524 — the accessible name must carry the time") resolved per the clarified answer's own instruction: take the simpler option that adds no new dependency and no second source of truth.

## Notes for the next worker
- `comment-list.tsx`'s "(edited)" marker is now: `<span title="Edited <exact>" aria-label="Edited <exact>">(edited)</span>` — visible text is generic, exact time lives only in `title`/`aria-label`, matching the pattern of putting the precise value in the accessible name rather than duplicating it in visible text.
- If a future feature needs a richer on-hover tooltip UI (not just a plain browser title), `components/ui/tooltip.tsx` + `components/user-avatar-group.tsx`'s `TooltipTrigger`-as-real-`<button>` pattern is the template — but doing so for this marker would require either converting `tests/unit/comment-list.test.ts` to a `@vitest-environment jsdom` file (like `tests/unit/user-avatar-group.test.tsx`) or adding a parallel jsdom test file, since Base UI's `Tooltip.Portal` needs a DOM.
- No MCP usage this session (pure UI feature, no live-service interaction needed).
