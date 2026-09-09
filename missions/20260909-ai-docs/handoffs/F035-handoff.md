# Handoff: F035 — Breadcrumb ownership

## Status
COMPLETE

## Assertions covered
AS-061: PASS — verified with `tests/unit/f035-breadcrumb-ownership.test.tsx` and the existing `tests/unit/f009-assistant-sidebar.test.tsx` (both green). This is a regression fix for B4 (M2 review), which was found while validating this exact assertion; no other assertion IDs are assigned to this remediation.

## Files changed
components/nav/breadcrumb-context.tsx
components/project/project-breadcrumb.tsx
components/docs/markdown-editor.tsx
tests/unit/f035-breadcrumb-ownership.test.tsx (new)

## Commands run
`npx vitest run tests/unit/f035-breadcrumb-ownership.test.tsx lib/ai tests/unit/f009-assistant-sidebar.test.tsx tests/unit/f010-assistant-thread.test.tsx tests/unit/f011-tool-call-card.test.tsx tests/unit/f012-assistant-composer.test.tsx tests/unit/f013-assistant-empty-state.test.tsx tests/unit/breadcrumb-context-no-loop.test.tsx tests/unit/docs-markdown-editor-export-import.test.tsx` (0) — 14 files, 117 tests passed
`npx tsc --noEmit` (1, but only the 4 pre-existing errors documented in the spec: app/layout.tsx LayoutProps, components/ui/status-badge.tsx overload, tests/unit/docs-markdown-editor-export-import.test.tsx x2 — none in files this feature touched)
`npx eslint components/nav/breadcrumb-context.tsx components/project/project-breadcrumb.tsx components/docs/markdown-editor.tsx tests/unit/f035-breadcrumb-ownership.test.tsx` (0, no warnings)

## Decisions made
- Read how many production callers `useSetBreadcrumb` has before choosing between the two options the spec offered: exactly two (`ProjectBreadcrumb` and `MarkdownEditor`), plus three test-only callers (`f009-assistant-sidebar.test.tsx`, `f013-assistant-empty-state.test.tsx`, `breadcrumb-context-no-loop.test.tsx`) that each mount a single writer and don't exercise composition. `portal-title-context.tsx`'s `useSetPortalTitle` is a sibling hook with the same shape but is entirely separate context/state — not a caller of this hook.
- **Chose option 1 (keyed multi-slot writers)**, not option 2 (revert F009's write + give the sidebar its own context). Reasoning: the collision isn't hypothetical — it happens on a route that exists today (`/w/<slug>/projects/<id>/docs/<docId>`) with the two callers that exist today, so "other writers are likely" is already true, not a future risk. Reverting F009's write (option 2) would need a brand-new context just to route a doc title from the editor to the sidebar, which is strictly more surface area than teaching the *existing* context about named slots — and it would leave `useSetBreadcrumb` looking single-writer-safe when it demonstrably isn't (the next feature that mounts a third writer on some other nested route hits the identical bug again). Multi-slot composition matches how `AppBreadcrumb`'s consumer code already treats `extra` (a flat, ordered array of trailing crumbs) — no consumer-side change was needed.
- `BreadcrumbSlotMap` is a `Map<string, BreadcrumbItem[]>` keyed by a caller-supplied `slot` string (`useSetBreadcrumb(items, slot = "default")`). Existing test-only callers that don't pass `slot` keep working unchanged (they're the sole writer in their harness, so `"default"` never collides).
- **Crumb order is resolved by a fixed `SLOT_ORDER` list (`["project", "task", "doc"]`), not by effect-firing order.** Considered relying on Map insertion order (first writer to register comes first) but rejected it: React fires effects bottom-up (child before parent) during commit, so which of `ProjectBreadcrumb` (mounted in the project layout) and `MarkdownEditor` (mounted deeper, inside the layout's `children`) registers first is a React implementation detail, not something this code should depend on for correctness. A named, explicit order is deterministic regardless of tree shape or effect timing. A slot not in `SLOT_ORDER` (a future writer nobody's updated the list for) is still included — appended after the known slots, in Map iteration order — so it degrades to "shows up, possibly out of place" rather than silently vanishing.
- Unmount cleanup now clears only the calling writer's own slot (`clearSlot(slot)`), not the whole breadcrumb — this is the actual B4 fix for the "navigating away wipes an unrelated crumb" half of the bug.
- **Debounce fix (M2 minor, same file):** added a second timer (`titleAnnounceTimerRef`), reusing the file's existing `AUTOSAVE_DEBOUNCE_MS` (800ms) rather than inventing a new constant — the breadcrumb/context-bar title only needs to settle a beat after typing stops, and reusing the autosave interval means both "things that react to the committed-ish title" settle together. `useSetBreadcrumb` is now called with `debouncedTitle`, not the live `title` state, so `BreadcrumbProvider` (and everything under it) no longer re-renders once per keystroke in the doc title field.
- Verified the fix by mutation, not just by writing tests that mirror the new code: temporarily forced `setSlot`/`clearSlot` back to a single shared key (`"SHARED"`) reproducing the pre-fix clobber-on-write and clobber-on-unmount behaviour, reran `tests/unit/f035-breadcrumb-ownership.test.tsx`, confirmed 2 of 4 tests went red with the expected failure (project crumb missing / wiped), then restored the real fix and reran to confirm all 4 pass again.

## Out-of-scope work needed
- B5 (assistant-sidebar.tsx:331 — missing `overflow` class, tool cards overflow the aside) and B6 (overlay-mode sidebar has no way to close below 1180px) from the same M2 review are NOT touched by this feature — they're unrelated files/concerns from F009's own scope, not the breadcrumb ownership bug. Left for their own remediation features.
- The M2 review's "majors" list (stop()/reset() not stopping event application, no unmount cleanup on the assistant hook, dead conversation history, prose-invert missing, no IME composition guard, tool_start-after-tool_end regression, non-2xx handling) are all in `lib/ai/use-doc-assistant.ts` / `components/ai/assistant-*` and out of scope for this file-scoped fix.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose option 1 (multi-slot `useSetBreadcrumb`) over option 2 (revert + separate context) per the reasoning above — the spec explicitly left this decision to the worker, contingent on how many callers exist. Two real production callers on a route that exists today made "other writers are likely" a fact, not a guess.

## Notes for the next worker
- `SLOT_ORDER` in `components/nav/breadcrumb-context.tsx` is a plain array a future feature needs to remember to extend if it adds a third route-nesting-level writer (e.g. a task-detail breadcrumb). It's commented at the definition site; there's no runtime enforcement that a new caller's slot name is in the list — an omitted slot still renders, just appended after the known ones rather than in its "correct" position.
- No MCP tools used — this feature is pure client-side React state/composition, no external service involved (confirmed against `missions/20260909-ai-docs/connections/mcp-registry.md`; nothing in that registry applies to breadcrumb state).
- Did not run the full `npm test` suite per the standing rule in `missions/20260909-ai-docs/state.md` (and per this feature's own instructions) — only the gate-listed files plus the new F035 test file and the markdown-editor export/import test (to confirm the debounce change didn't break that file's existing coverage, which mounts the real `MarkdownEditor`).
