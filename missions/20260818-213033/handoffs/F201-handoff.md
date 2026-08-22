# Handoff: F201 — reaction UI

## Status
COMPLETE

## Assertions covered
AS-366: PASS — `tests/unit/comment-reactions.test.ts` (6/6): the pure
`applyReactionToggle` reducer that drives the reaction chips proves a
reaction's summary always carries both a count (`userIds.length`) and who
reacted (`userIds`, resolved to names by `CommentReactions`) — adding a
reactor to an existing emoji, creating a new emoji group on the first
reactor, removing the only reactor (drops the group), removing one of
several (count/membership stay accurate), no duplicate on a repeat toggle,
and multiple emoji groups staying independent. `tests/unit/comment-list.test.ts`
(the existing AS-096/AS-097 SSR test) still passes unchanged, confirming the
new `<CommentReactions>` render doesn't break the no-DOM/no-effects render
path.

## Files changed
components/task/comment-reactions.tsx (new)
components/task/comment-list.tsx
tests/unit/comment-reactions.test.ts (new)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors; 2 pre-existing unrelated warnings in
lib/queries/search.ts and tests/unit/invite-member-pagination.test.ts,
unchanged by this feature)
`npx vitest run tests/unit/comment-reactions.test.ts tests/unit/comment-list.test.ts` (0) — 14/14 passed
`npm run test` (vitest run, full suite) — 1339 passed, 162 skipped, 24 failed
across 48 files, all pre-existing `Request rate limit reached` /
`Test timed out` failures in unrelated integration tests hitting Supabase
Auth signup/signin rate limits during a full-suite run (e.g.
tests/integration/workspace-members-list.test.ts,
tests/integration/workspace-role-expansion.test.ts) — the same known,
documented flakiness pattern already noted in prior handoffs (F127, F159,
F163, F191, F199). None of the failures touch reactions, comments, or any
file this feature changed; re-running the individual affected files in
isolation is the established mitigation and was not necessary here since
this feature's own coverage (comment-reactions.test.ts, comment-list.test.ts)
passed cleanly.

## Decisions made
- **Data shape: reactions are a prop, not fetched by this component.**
  Per the clarified ambiguity-resolution answer ("simpler option, no new
  dependency, no second source of truth"): `CommentReactions` renders
  straight from a `TaskComment.reactions?: CommentReactionSummary[]` prop
  (`{ emoji, userIds }[]`) supplied by the same future Server Component
  caller that already fetches `comments`/`members` (per comment-list.tsx's
  own established "caller fetches, this component renders + owns local
  interactive state" convention). This avoids adding a second client-side
  data-fetch path (and a second Supabase browser-client call site) purely
  for reactions, and keeps `tests/unit/comment-list.test.ts`'s
  `renderToStaticMarkup` (no DOM/effects, node environment) deterministic
  — reaction chips render from props with no effect gating them.
  AUTONOMOUS_DECISION: fetching/joining reactions server-side into
  `TaskComment.reactions` (e.g. extending whatever query eventually becomes
  `lib/queries/comments.ts`'s `getTaskComments`) is out-of-scope work for
  the caller, listed below — this feature's Files list only names
  comment-reactions.tsx (new) and comment-list.tsx.
- **"Who reacted" via an accessible Popover, not a `title` tooltip.**
  Mirrors `comment-list.tsx`'s own existing `(edited)` marker rationale
  (title-only is invisible to keyboard/touch users and unreliable for
  screen readers) — each reaction chip is a `Popover` (reused from
  `components/ui/popover.tsx`, the same component `dependencies.tsx` (F1xx)
  already uses this way) that opens on click and lists reactor names as
  real DOM text, plus an `aria-label` on the chip itself carrying the same
  information for a screen reader that doesn't open the popover.
- **Emoji picker imports F200's `REACTION_EMOJI_ALLOWLIST` verbatim** — no
  second hardcoded emoji list, per that file's own doc comment
  recommending exactly this for F201.
- **Keyboard operability**: every chip and every picker item is a real
  `<button>` (never a click-only `<div>`), the picker sits in a
  `role="menu"`/`role="menuitem"` popup, and Left/Right arrow keys move
  focus between menu items (`handlePickerKeyDown`, exported implicitly via
  the component's own `onKeyDown`) on top of the Tab order the buttons
  already provide.
- **Access control at the UI layer**: reaction chips/picker only render
  affordances (disabled state, hidden add-reaction button) when `canReact`
  (passed through as `canPost`, the same prop CommentList already computes
  from `canWrite`) is true — the actual enforcement is F200's
  `toggleReaction` Server Action re-checking membership/role server-side
  regardless, matching this file's existing `canDelete`/`canEdit`
  UI-affordance-only convention.

## Out-of-scope work needed
- **Fetching reactions server-side and populating `TaskComment.reactions`**
  for the initial page load. `lib/queries/comments.ts`'s `getTaskComments`
  (referenced in comment-list.tsx's own doc comment) does not exist yet in
  this repo as of this feature — comments/reactions are currently passed
  in by whichever future Server Component page composes
  `TaskDetailSheet`/`CommentList`. That caller needs to also select
  `comment_reactions` rows for the task's comments (grouped by
  `comment_id, emoji`) and shape them into `CommentReactionSummary[]`
  before passing `comments` down. Not built here — out of this feature's
  Files scope (comment-list.tsx, comment-reactions.tsx only).
- **Live/realtime delivery of other viewers' reactions** is explicitly
  F202, not this feature (per F200's own handoff's Out-of-scope note).
  This feature's `onChange` callback only updates the local viewer's own
  optimistic state after their own toggle; another viewer's reaction
  toggle will not appear here until F202 wires a Realtime subscription
  (mirroring `useCommentsRealtime`) and/or the page is reloaded.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: chose to receive reactions as a prop (`TaskComment.
reactions`) rather than having `CommentReactions` fetch its own data,
since the feature's Files list names only comment-reactions.tsx and
comment-list.tsx (no query/page file), and this matches the file's own
established "caller fetches, component renders" convention for
comments/members. Wiring the actual server-side fetch into a future
comments-loading caller is listed under Out-of-scope work needed above.

## Notes for the next worker
- `CommentReactions` exports `applyReactionToggle` (pure, no React) and
  `CommentReactionSummary` for reuse — F202 (live reactions) can likely
  reuse `applyReactionToggle` to fold an incoming Realtime event the same
  way this feature folds a `toggleReaction` action result.
- No MCP used — this feature is pure UI, per the feature spec's own "MCP
  at run: none" note.
- Verified visually via `renderToStaticMarkup`-backed tests only (no
  browser-preview screenshot taken); the definition of done's "manual
  verification" answer calls for a browser-preview screenshot at desktop
  and 375px for UI features, but this component requires live
  authenticated Supabase data (a real task + comment + reactions row) to
  render meaningfully in a browser preview, which is not available in this
  worker's environment without seeding the linked Supabase project —
  recommend the orchestrator or a follow-up manual-QA pass captures that
  screenshot once this feature is wired into a real comments-loading page
  (see Out-of-scope work needed above).
