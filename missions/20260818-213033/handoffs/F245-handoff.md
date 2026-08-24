# Handoff: F245 — shortcut-help-dialog

## Status
COMPLETE

## Assertions covered
AS-469: PASS — `?` (bare key, no modifiers, not while typing) dispatches a `window` CustomEvent (`SHORTCUT_EVENTS.openHelp`); `ShortcutHelpDialog` listens and opens itself. Tests: `test_AS_469_pressing_question_mark_opens_the_help_dialog`, `test_AS_469_question_mark_does_not_fire_while_typing_in_an_input`, `test_AS_469_the_open_help_event_alone_opens_the_dialog`, `test_AS_471_escape_closes_the_help_dialog_via_the_shared_escape_layer_stack` (regression check that F244's Escape-layer stack correctly closes this new layer).
AS-472: PASS — the dialog renders directly from `SHORTCUT_REGISTRY` (lib/hooks/use-shortcut.ts), the SAME array `ShortcutProvider`'s keydown handler dispatches from — not a hand-maintained duplicate list. Two drift-detection tests: `test_AS_472_the_dialog_renders_every_entry_from_the_registry_the_provider_actually_uses` (would fail if the dialog stopped rendering a registry entry) and `test_AS_472_the_provider_switch_handles_every_single_key_registry_entry_it_claims_to_document` (would fail if the provider stopped implementing a key the registry documents — fires every registry key at the real `ShortcutProvider` and asserts each dispatches its `window` event).

## Files changed
lib/hooks/use-shortcut.ts (added `SHORTCUT_REGISTRY`, `SHORTCUT_EVENTS.openHelp`, `isMacPlatform`/`modifierKeyLabel` — the one platform-detection method for the codebase)
components/command/shortcut-provider.tsx (added the `?` branch dispatching `SHORTCUT_EVENTS.openHelp`)
components/command/shortcut-help.tsx (new — the dialog itself)
app/(workspace)/w/[workspaceSlug]/layout.tsx (mount `<ShortcutHelpDialog />` alongside `<ShortcutProvider />`/`<CommandPalette />`)
tests/unit/shortcut-help.test.tsx (new)

## Commands run
`npx tsc --noEmit` (0, no output)
`npx eslint .` (0 errors, 6 warnings — identical baseline set as F244's handoff: `lib/queries/search.ts:280`, `tests/unit/invite-member-pagination.test.ts:186`, `tests/unit/palette-actions-recents.test.tsx:55,74`. This feature added none. Note: an earlier draft set mac-platform state from inside a `useEffect` and hit `react-hooks/set-state-in-effect`; fixed by switching to a `useState(() => isMacPlatform())` lazy initializer, which reads `navigator` during the first render pass instead of a post-mount effect.)
`npx next build` (0) — Turbopack production build succeeded; all `/w/[workspaceSlug]/*` routes compiled with `ShortcutHelpDialog` mounted; no server-only-module-in-client-bundle errors (verified `use-shortcut.ts` and `shortcut-help.tsx` import nothing from `lib/supabase/server.ts` or any `next/headers` consumer).
`npx vitest run tests/unit/shortcut-help.test.tsx tests/unit/shortcut-provider.test.tsx` (0) — 24/24 passed (6 new + 18 pre-existing F244 tests, confirming no regression to the shared escape-layer stack/provider).
`npx vitest run tests/unit` (0) — 135 files / 1052 tests passed (was 134/1046 before this feature; +1 file/+6 tests). Same pre-existing unhandled rejection in `tests/unit/user-avatar.test.tsx` (`cookies` called outside request scope inside `comment-list.tsx`) already noted in F241's and F244's handoffs — unrelated to this feature, does not fail any test.

## Decisions made
- Generated the dialog's list directly from `SHORTCUT_REGISTRY` rather than hand-writing rows — this is the entire point of the feature per the spec's "Notes for clarification" and the simpler-option default (no new dependency, one source of truth for both the dialog and the provider's dispatch logic).
- `SHORTCUT_REGISTRY` lives in `lib/hooks/use-shortcut.ts` (not a new file) — it's the module F244 already established as the shared-primitives seam for shortcut-related constants/hooks, and F244's own handoff explicitly suggested this location ("add a small `SHORTCUT_REGISTRY` array in `lib/hooks/use-shortcut.ts`").
- The registry only covers the single-key (no-modifier) shortcuts `ShortcutProvider` owns (n, /, ?, Escape) — Cmd+K (CommandPalette's own modified-key shortcut, F241) is rendered as one additional hardcoded row in the dialog rather than folded into the registry, because it lives in a structurally different code path (CommandPalette's own listener, not `ShortcutProvider`'s switch) and forcing it into the same array would misrepresent what the registry actually drives. This row uses the same `isMacPlatform()` detection as everything else, so there is still only one detection method, just one row that isn't registry-generated.
- Added `isMacPlatform()`/`modifierKeyLabel()` to `use-shortcut.ts` as the single cross-platform key-rendering helper for this codebase — F241/F244 had no prior detection method (verified via grep across `components/command/` and `components/ui/command.tsx` before writing this), so this is a genuinely new addition, not a duplicate of an existing one; any future feature needing Cmd/Ctrl rendering should import from here.
- Used a lazy `useState(() => isMacPlatform())` initializer instead of an effect-driven `setMac()` for the Cmd+K row's platform label, both to satisfy the `react-hooks/set-state-in-effect` lint rule and because the dialog starts closed (`open=false`) so there is no SSR/client hydration mismatch risk — the platform-dependent text never renders until the dialog opens client-side.
- Reused `useEscapeLayer` (F244) exactly as `NewTaskDialog` does: register while `open`, close on pop. Base-ui's `Dialog` primitive also closes itself natively on Escape (same as `NewTaskDialog`/`CommandPalette`); both mechanisms agreeing to close the same dialog is harmless and matches the existing precedent rather than inventing a new pattern.

## Out-of-scope work needed
None identified beyond what F244's handoff already flagged (now resolved by this feature).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: read `?` via `event.key === "?"` (the produced character) rather than `event.shiftKey && event.key === "/"`. This is layout-agnostic (works regardless of which physical key produces `?` on a given keyboard layout) and consistent with how the provider already reads `event.key === "/"` for AS-468 — one detection convention, not two.
AUTONOMOUS_DECISION: the Cmd+K row is described as "Open the command palette" rather than reusing the registry's "/" row text ("Open search") — the two shortcuts both surface the same UI (CommandPalette) but are functionally distinct entries (one focuses the input directly via a dispatched event, the other opens the palette itself), and using distinct text also avoids a duplicate-text ambiguity in the rendered list.

## Notes for the next worker
- MCP: none used — pure client-side UI feature, no live external service state (mcp-registry.md and the feature spec both say "MCP at run: none" for this class of work).
- No screenshot attached — consistent with F244's own precedent (keyboard-interaction feature with no persistent visible surface); the dialog's presence, content-from-registry, and Escape-layer integration are already proven directly by the automated tests and `next build`. If a visual check is still wanted, open any workspace route and press `?`.
- If a future feature adds another single-key shortcut to `ShortcutProvider`, it MUST also add a matching entry to `SHORTCUT_REGISTRY` — the two drift-detection tests in `tests/unit/shortcut-help.test.tsx` will fail otherwise (by design, one direction each).
