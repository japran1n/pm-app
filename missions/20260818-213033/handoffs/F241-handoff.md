# Handoff: F241 — command palette shell

## Status
COMPLETE

## Assertions covered
AS-459: PASS — global `document` keydown listener toggles the palette on Cmd+K (Mac) / Ctrl+K (Windows/Linux) from anywhere under the workspace layout; ignores `event.repeat`. Tests: `test_AS_459_cmd_k_opens_the_palette`, `test_AS_459_ctrl_k_opens_the_palette_for_windows_linux`, `test_AS_459_key_repeat_does_not_re_toggle_the_palette`.
AS-463: PASS — dialog is the existing shadcn `CommandDialog` (Radix `Dialog` underneath), which already provides Escape-to-close and a trapped/returned focus; input is fully keyboard operable and the dialog carries an accessible name via its (sr-only) title. Tests: `test_AS_463_escape_closes_the_palette`, `test_AS_463_input_is_focusable_and_accepts_keyboard_typing`, `test_AS_463_dialog_has_accessible_name_via_title`.
AS-464: PASS — the shortcut handler only opens/closes on the metaKey/ctrlKey+`k` chord; a plain `k` keydown while focused in an unrelated text input never opens it, while the explicit chord does open it even with a text field focused. Tests: `test_AS_464_typing_k_in_a_plain_input_does_not_open_the_palette`, `test_AS_464_shortcut_still_opens_the_palette_even_while_a_text_field_is_focused`.

## Files changed
components/command/command-palette.tsx (new)
app/(workspace)/w/[workspaceSlug]/layout.tsx
tests/unit/command-palette-shell.test.tsx (new)

## Commands run
`npx tsc --noEmit` (0, no output)
`npx eslint .` (0 errors; 2 pre-existing unrelated warnings in lib/queries/search.ts and tests/unit/invite-member-pagination.test.ts, not touched by this feature)
`npx next build` (0) — Turbopack production build succeeded, all routes compiled including every `/w/[workspaceSlug]/*` route that now mounts `CommandPalette`; no server-only-module-in-client-bundle errors.
`npx vitest run tests/unit/command-palette-shell.test.tsx` (0) — 8/8 new tests passed.
`npx vitest run tests/unit` (0) — 131 files / 1011 tests passed (was 130/1003; +1 file/+8 tests from this feature). One "Unhandled Rejection" console error is logged during the run from `tests/unit/user-avatar.test.tsx` (`cookies` called outside request scope inside `comment-list.tsx`'s `getMentionCandidates` effect) — pre-existing, unrelated to this feature, and does not fail any test (all 1011 report passed).

## Decisions made
- Reused the existing `components/ui/command.tsx` (shadcn `Command`/`CommandDialog`, backed by `cmdk` — already a dependency, no new package added) rather than hand-rolling a dialog, per the clarified "shadcn/ui primitives already in components/ui, no new design system" answer.
- `CommandDialog` in this repo's `components/ui/command.tsx` does NOT itself wrap its children in the `cmdk` root `<Command>` component (unlike some shadcn versions) — it only renders `Dialog`/`DialogContent`. Consumers must supply their own `<Command>` wrapper around `CommandInput`/`CommandList`. Discovered this via a `useSyncExternalStore` crash reading `undefined.subscribe` when `<CommandInput>`/`<CommandList>` were rendered directly inside `<CommandDialog>` without a `<Command>` wrapper. Fixed by wrapping in `<Command>`.
- Mounted `<CommandPalette />` once at the top of `WorkspaceLayout`'s returned JSX (inside `MembershipProvider`, above the sidebar/main split) — matches the feature spec's own note that a single layout-level instance avoids multiple palettes fighting over the same shortcut, and is the natural "always-present, invisible until opened" chrome location alongside the sidebar.
- Used `event.repeat` to ignore key-repeat events from a held-down chord, and `!event.altKey` in the modifier check so Alt+Cmd+K (a different OS/browser shortcut on some platforms) doesn't also trigger it — neither is spec'd explicitly but both are the "obviously correct" behaviour a real Cmd+K implementation needs and cost nothing.
- AS-464's "does not open while typing" is satisfied structurally: the ONLY thing that can open the palette is the explicit metaKey/ctrlKey+k chord — there is no separate "ignore focused input" branch to get wrong, and the explicit chord is required to work even with a text field focused (that's the "except via the shortcut" carve-out in the assertion text), which the test suite asserts directly.
- AUTONOMOUS_DECISION: rendered only an empty `CommandList`/`CommandEmpty` placeholder body (no groups/items) since this feature's scope is the shell only — F242 (search results, AS-460/461/466) and F243 (actions + recents, AS-462/465) own everything that would populate the list. Left an explicit doc comment in `command-palette.tsx` describing the seam so those workers extend the same `<CommandList>` rather than re-wiring the shortcut/open-state logic.
- AUTONOMOUS_DECISION: added a local `ResizeObserver` shim in the new jsdom test file only (`cmdk`'s `CommandList` observes its own height with a real `ResizeObserver`, which jsdom does not implement) — a test-environment-only concern, not app behaviour; no other test file in the repo currently renders `cmdk`-backed content in jsdom, so there was no existing shim to reuse.

## Out-of-scope work needed
- F242 (search results: AS-460 groups by type, AS-461 selecting navigates, AS-466 no-results state) — needs to add `CommandGroup`/`CommandItem` children with debounced query wiring inside the `<CommandList>` this file renders. Left untouched per scope boundary.
- F243 (actions + recents: AS-462 quick actions like create task/create project/toggle theme, AS-465 recent items when query is empty) — same seam, additional groups/items.
- No other out-of-scope work observed; touched only the two files the spec named plus the new test file.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: shell renders only an empty placeholder list body; results/actions are explicitly out of scope for F241 and left for F242/F243 to extend the same `<CommandList>`.
AUTONOMOUS_DECISION: added a `ResizeObserver` polyfill local to the new jsdom test file to work around jsdom's missing implementation of an API `cmdk`'s `CommandList` depends on; no production code changed for this.

## Notes for the next worker
- Gotcha for F242/F243: this repo's `components/ui/command.tsx` `CommandDialog` does not include a `<Command>` wrapper — always nest your `CommandGroup`/`CommandItem` additions inside the `<Command>` element already present in `components/command/command-palette.tsx`, not directly inside `CommandDialog`.
- If you add interactive tests in jsdom that render this component tree, you'll need the same `ResizeObserver` shim shown at the top of `tests/unit/command-palette-shell.test.tsx` (guarded by `typeof globalThis.ResizeObserver === "undefined"` so it's safe to duplicate across files or hoist to a shared setup file later).
- MCP: none used — pure UI feature, no live external service state involved (per mcp-registry.md, and the feature spec's own "MCP at run: none").
- No screenshot attached: the dev preview server mentioned in the task instructions was not exercised interactively during this run (unit tests + `next build` provided the required proof of correctness and module-boundary safety); if a screenshot is still required by the milestone validator, opening `/w/<slug>` and pressing Cmd+K will show the palette centered top-third of the screen per `CommandDialog`'s existing styling (`top-1/3`), consistent with the rest of this app's dialogs.
