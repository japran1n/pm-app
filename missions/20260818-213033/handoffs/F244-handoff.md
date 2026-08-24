# Handoff: F244 — shortcut-provider

## Status
COMPLETE

## Assertions covered
AS-467: PASS — `n` (bare key, no modifiers, not while typing, not a repeat) dispatches a `window` CustomEvent carrying the current project's id, parsed from the pathname (`/projects/[projectId]/...`); outside a project route it is a deliberate no-op. `NewTaskDialog` listens for this event and opens itself only when the event's `projectId` matches its own. Tests: `test_AS_467_n_dispatches_new_task_with_current_project_context`, `test_AS_467_n_is_a_no_op_outside_a_project_context`, `test_AS_467_key_repeat_does_not_re_fire_the_shortcut`, `test_AS_467_modified_n_does_not_fire_the_bare_shortcut`, `test_AS_467_strictmode_double_mount_leaves_exactly_one_listener_active`.
AS-468: PASS — `/` dispatches an "open search" event; `CommandPalette` (the app's search surface, F241/F242) listens and opens itself, and its existing `CommandInput` already autofocuses on open. Test: `test_AS_468_slash_dispatches_open_search`.
AS-470: PASS — a shared `isEditableTarget()` guard (native input/textarea/select, `contentEditable`, and Tiptap's `.ProseMirror` root via `closest()`) blocks `n`/`/` from firing while typing. Tests: `test_AS_470_input_and_textarea_are_editable`, `test_AS_470_contenteditable_is_editable`, `test_AS_470_tiptap_prosemirror_root_is_editable`, `test_AS_470_plain_div_is_not_editable`, `test_AS_470_n_does_not_fire_while_typing_in_an_input`, `test_AS_470_slash_does_not_fire_while_typing_in_a_contenteditable_editor`.
AS-471: PASS — a module-level Escape-layer stack (`pushEscapeLayer`/`popTopEscapeLayer`) closes only the current topmost registered layer per Escape keystroke, never all of them at once; `ShortcutProvider`'s Escape handler calls `popTopEscapeLayer()`, and `NewTaskDialog` registers itself via the `useEscapeLayer` hook while open. Tests: `test_AS_471_escape_closes_only_the_topmost_layer`, `test_AS_471_escape_closes_layers_one_at_a_time_not_all_at_once`, `test_AS_471_escape_with_no_open_layers_is_a_reported_no_op`, `test_AS_471_provider_pops_topmost_layer_on_escape_keydown`, `test_AS_471_a_popped_layer_removes_itself_via_its_own_unregister_function`.

## Files changed
lib/hooks/use-shortcut.ts (new)
components/command/shortcut-provider.tsx (new)
components/command/command-palette.tsx (added a 5-line listener for the "open search" event; no change to its existing Cmd+K logic)
components/task/new-task-dialog.tsx (added the "open on shortcut" listener + Escape-layer registration)
app/(workspace)/w/[workspaceSlug]/layout.tsx (mount `<ShortcutProvider />` alongside `<CommandPalette />`)
tests/unit/shortcut-provider.test.tsx (new)

## Commands run
`npx tsc --noEmit` (0, no output)
`npx eslint .` (0 errors, 6 warnings — all 6 pre-existing/unrelated: `lib/queries/search.ts:280`, `tests/unit/invite-member-pagination.test.ts:186`, `tests/unit/palette-actions-recents.test.tsx:55,74` (x2 each) — matches the stated baseline of "0 errors, 6 warnings" exactly; this feature added none. Note: an earlier draft (ref mutated directly during render in both `use-shortcut.ts` and `shortcut-provider.tsx`) produced 2 `react-hooks/refs` errors from `eslint`'s `react-hooks` plugin; fixed by moving the ref writes into their own `useEffect` before commit.)
`npx next build` (0) — Turbopack production build succeeded; every `/w/[workspaceSlug]/*` route compiled, including the ones that now mount `ShortcutProvider`; no server-only-module-in-client-bundle errors.
`npx vitest run tests/unit/shortcut-provider.test.tsx` (0) — 18/18 new tests passed.
`npx vitest run tests/unit` (0) — 134 files / 1046 tests passed (was 133/1028; +1 file/+18 tests from this feature). Same pre-existing "Unhandled Rejection" from `tests/unit/user-avatar.test.tsx` (`cookies` called outside request scope inside `comment-list.tsx`'s `getMentionCandidates` effect) noted in F241's handoff — unrelated to this feature, does not fail any test.

## Decisions made
- Reused the command palette (F241/F242) as the "search" surface for AS-468 rather than building a second search UI — the simpler option per the clarification's default, no new dependency, no second source of truth.
- `NewTaskDialog` matches the shortcut event by `projectId` rather than by "is this dialog currently mounted on screen" — correct even if more than one `NewTaskDialog` instance is mounted for the same project (board toolbar + board-empty-state both render one when the board has zero tasks); both would open together in that edge case, which is harmless (same project, same form) and avoids a brittle "only one may listen" coordination mechanism.
- AS-471's Escape-layer stack is currently wired into `NewTaskDialog` only (the dialog this feature already touches for AS-467). `CommandPalette`'s own Escape-to-close (AS-463, F241) is left untouched — it is base-ui's `Dialog` primitive's own built-in Escape handling, already correct and already tested, and does not need this feature's stack to behave properly. The stack is exported as a general-purpose primitive (`useEscapeLayer`, `pushEscapeLayer`, `popTopEscapeLayer`) for any future overlay (F245's help dialog, sheets, popovers) to opt into for correct "topmost only" stacking against dialogs that don't already provide it themselves.
- `isEditableTarget()` checks `.closest('.ProseMirror')` rather than only `event.target.isContentEditable`, because Tiptap's contentEditable root is a wrapper div and nested marks/nodes inside it are the actual keydown target — `closest()` correctly recognizes the whole editor surface as editable.

## Out-of-scope work needed
- F245 (help dialog, AS-469/472): needs a way to render the full shortcut list (key + description) for a "?" help overlay. This feature does not yet expose a declarative registry object (e.g. `{ key: "n", description: "New task" }[]`) — `ShortcutProvider`'s handler is a single `switch`-shaped `if` chain, not a data-driven list. F245's worker should either (a) add a small `SHORTCUT_REGISTRY` array in `lib/hooks/use-shortcut.ts` that both the help dialog renders from AND `ShortcutProvider` dispatches from, or (b) hardcode the same three rows (n, /, Esc) directly in the help dialog's copy since there are only three. Left as a clean seam per the mission instructions rather than guessing F245's exact data shape.
- Board pages that render two `NewTaskDialog` instances simultaneously (toolbar + empty-state) both react to `n` and both open — noted above as harmless but technically two dialogs stacking on top of each other with base-ui's Dialog primitive already handling that gracefully (only the outermost is interactive/focused); not something this feature's Files scope covers fixing (`board.tsx`/`board-empty-state.tsx` are outside `lib/hooks/`, `components/command/`, and the layout file this spec names).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: kept `ShortcutProvider`'s document keydown listener SEPARATE from `CommandPalette`'s existing Cmd+K listener rather than merging them into one. Justification: the two listeners' trigger conditions are provably disjoint (`ShortcutProvider` explicitly bails on any `metaKey`/`ctrlKey`/`altKey` before checking `n`/`/`/`Escape`; `CommandPalette` only ever acts on `metaKey||ctrlKey` + `k`), so there is no possibility of "two listeners fighting over the same key" despite both living on `document`. Merging would have meant re-deriving and re-testing F241's already-shipped, already-tested Cmd+K logic (AS-459/463/464) purely for the sake of a single listener object, at real regression risk for zero behavioural gain. Cross-communication where needed (AS-467 -> NewTaskDialog, AS-468 -> CommandPalette) uses narrow `window` CustomEvents instead of either listener reaching into the other's state.
AUTONOMOUS_DECISION: "current context" for AS-467 is derived from the URL pathname (`/projects/[projectId]/`) rather than from a client-side "currently viewed project" store — there is no such store in the codebase, and the pathname is already the source of truth every page under `/w/[workspaceSlug]/projects/[projectId]/*` uses for its own project id.

## Notes for the next worker
- MCP: none used — pure client-side UI feature, no live external service state involved (mcp-registry.md and the feature spec both say "MCP at run: none" for this class of work).
- Two `document`-level `keydown` listeners now exist under the workspace layout (`CommandPalette`'s and `ShortcutProvider`'s). Both are safe to coexist per the AUTONOMOUS_DECISION above; if a THIRD global listener is ever added, re-verify the same disjointness property (modifier-only vs bare-key) before assuming it's automatically safe.
- No screenshot attached — this is a keyboard-interaction-only feature (no new visible UI surface of its own; it only opens existing dialogs), and the automated tests plus `next build` already prove the module boundary and behaviour directly. `NewTaskDialog` and `CommandPalette` already have their own screenshots from F241/earlier task-dialog work if visual proof is still needed.
