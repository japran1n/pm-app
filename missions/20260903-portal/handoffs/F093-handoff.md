# Handoff: F093 — Stop jsdom unit tests from opening real Realtime WebSockets

## Status
COMPLETE

## Assertions covered
This is an infra/test-hygiene fix, not a product feature — no assertion IDs were assigned in `plan.md`/`validation-contract.md` for it. No AS-NNN lines apply.

## Files changed
tests/setup/testing-library.ts
tests/unit/board-taskid-deeplink.test.tsx
tests/unit/f246-task-detail-sheet-copy-link.test.tsx
tests/unit/f005-task-detail-sheet-title-optimistic.test.tsx
tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx
tests/unit/f005-task-detail-sheet-page-fields.test.tsx
tests/unit/f006c-task-detail-sheet-page-fields-system-key-gate.test.tsx
tests/unit/f250-list-inline-edit.test.tsx
tests/unit/f003-task-detail-sheet-status-optimistic.test.tsx
tests/unit/f002-task-detail-sheet-phase-optimistic.test.tsx
tests/unit/list-table-subtask-nesting.test.tsx
tests/unit/f265-mobile-task-detail.test.tsx
tests/unit/list-table-bulk-selection.test.tsx
tests/unit/f326-calendar-day-grid-rerender.test.tsx
tests/unit/f247-task-modal-routing.test.tsx
tests/unit/f249-quick-add-optimistic.test.tsx

## Commands run
`npx vitest run tests/unit/palette-search-results.test.tsx tests/unit/command-palette-shell.test.tsx` (0, 14 tests passed)
`npx vitest run $(grep -rl "@vitest-environment jsdom" tests/unit)` — full 81-file jsdom slice, run 3 times after the environment-level fix (0, 0, 0; 532 tests passed each time, zero Unhandled Rejection/Uncaught Exception, zero synchronous "WebSocket not available" failures)
`npm run test:realtime` (0, 4 files / 12 tests passed against the real linked Supabase project — confirms the jsdom-only stub does not touch `vitest.realtime.config.ts`'s node-environment live sockets)
`npx tsc --noEmit` (0)
`gh run view 33875346855 --log-failed` (read-only, to enumerate all 5 CI error origins before fixing)

## Decisions made
- **Moved the fix from a per-file allowlist to a property of the jsdom environment**, per the coordinator's explicit instruction. The original per-file sweep (13 files, `d0eff66`) fixed the two originally-reported files but missed two more (`palette-search-results.test.tsx`, `command-palette-shell.test.tsx`, rendering `CommandPalette`, which subscribes via `lib/palette/subscribe-palette-search-realtime.ts` — a component the sweep's `Board`/`CalendarDayGrid`/`TaskListTable` allowlist never considered) plus surfaced 2 more genuine leaks once the environment-level stub made them deterministic instead of timing-dependent (see below). A list of "known subscribing components" is wrong by construction; the fix now lives once, in `tests/setup/testing-library.ts` (already loaded via `setupFiles` for every test in the main config), and applies to any component, present or future, that tries to open a `WebSocket` while `document` exists (i.e. only in the jsdom environment).
- **Stub throws synchronously and by name, not silently.** `globalThis.WebSocket` is replaced with a class whose constructor throws a `JsdomWebSocketDisabledError` immediately, naming the URL and pointing at the fix (mock the subscription, or move the test to `vitest.realtime.config.ts`). Verified against `node_modules/@supabase/realtime-js`'s `RealtimeClient.connect()` (`RealtimeClient.ts:316`), which already wraps `this.socketAdapter.connect()` in try/catch and rethrows synchronously as `Error("WebSocket not available: ...")` — so the stub turns what used to be an async, unattributable process-level crash into an ordinary synchronous throw inside whichever component's effect actually tried to subscribe, attributed to the correct file by vitest's normal failure reporting.
- **Guarded on `typeof document !== "undefined"`**, which is true only in jsdom-environment files (the main config's per-file opt-in) and false in the main config's node-environment default AND in `vitest.realtime.config.ts` (also `environment: "node"`). Verified: `npm run test:realtime` still passes 4/4 with real sockets after this change — the guard does not touch it.
- **Did not remove the 13 per-file `@/lib/supabase/client` mocks from the previous commit.** They're redundant with the environment-level stub now (their fake client is chosen over the real `createClient`'s call path before a `WebSocket` would ever be constructed) but harmless, and removing them would be scope creep on a fix that's already correct without touching them.
- **The environment-level stub, once deterministic, surfaced two additional genuine leaks the previous file-blame-driven sweep couldn't have found:**
  - `tests/unit/f247-task-modal-routing.test.tsx`: dynamically imports the real `<Board>` (`await import("@/components/board/board")`, line 231, for an Escape-key/layer-stack test) but never mocked `@/lib/supabase/client`. Fixed with the same `makeFakeSupabaseRealtimeClient()` mock used across the earlier sweep.
  - `tests/unit/f249-quick-add-optimistic.test.tsx`: already mocked `useBoardRealtime` (the task-row subscription) directly, but `board.tsx` also mounts a SEPARATE hook, `useBoardColumnsRealtime` (a second Realtime subscription, on the `project_columns` table), which this file never mocked. That's exactly the "list is stale the moment a second subscription exists" failure mode the coordinator described, just one level down (file mocks one hook, misses a second hook on the same component). Fixed with a plain no-op mock of `useBoardColumnsRealtime`, matching the existing mock's style.
  - Both were previously "passing" only because the real WebSocket's async connection-established exception fired late enough to get blamed on whatever file vitest happened to be running next (`palette-actions-recents.test.tsx`, `f249-quick-add-optimistic.test.tsx`, `f247-task-modal-routing.test.tsx` were 3 of CI's 5 named origins) rather than reliably reproducing against the file that actually opened the socket — the environment-level stub's synchronous-and-named throw is what made these attributable and fixable at all.
- **`tests/unit/palette-actions-recents.test.tsx`** (the 5th CI-named origin) needed no code change — once the two real leaks above were closed, three stability runs of the full 81-file jsdom slice showed no failures in this file; its earlier appearance in CI's list was collateral blame from the same async-timing effect, not a leak of its own.

## Out-of-scope work needed
- (carried over from the previous handoff) A flaky, unrelated `EnvironmentTeardownError` around `@tiptap/extension-mention` dynamic import racing pool teardown was seen once in an earlier run of this task and has not recurred across 5 subsequent full-slice runs; still worth a follow-up if it resurfaces, but out of scope here.
- Consider a shared test helper (e.g. `tests/helpers/fake-supabase-realtime-client.ts`) exporting `makeFakeSupabaseRealtimeClient()` so the ~15 near-identical inline copies across `tests/unit/*.test.tsx` don't drift. Not done here, to keep this fix minimal and match the existing per-file convention.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to guard the stub on `typeof document !== "undefined"` (jsdom-only) rather than an explicit allowlist of environments, since it's the simplest expression of "only where jsdom's real WebSocket polyfill exists" and requires no config wiring — `vitest.config.ts`'s node-environment default and `vitest.realtime.config.ts` both have no `document` global, so both are correctly untouched without needing to name either config file inside the setup file.

AUTONOMOUS_DECISION: Left the class name/error message verbose (naming the URL, the mechanism, and the fix) rather than a terse message, per the coordinator's explicit ask for a stub that "makes an attempted connection fail loudly and identifiably... by name rather than by hanging."

## Notes for the next worker
- The invariant this enforces: **a jsdom-environment unit test must never open a real WebSocket.** It's now a property of `tests/setup/testing-library.ts`, not a list anyone has to remember to extend. If a new component starts subscribing to Realtime and a jsdom test renders it without mocking the subscription, that test will now fail LOUDLY and SYNCHRONOUSLY with a `JsdomWebSocketDisabledError` naming the offending file — this is the intended failure mode, not a bug to work around by widening the stub.
- If you ever see a `JsdomWebSocketDisabledError`, the fix is the same each time: mock `@/lib/supabase/client`'s `createClient` (copy from any of the ~15 files that already do — `tests/unit/f022-board-realtime-guard-call-site.test.tsx:98` is the original precedent) or, for a component-level hook like `useBoardRealtime`/`useBoardColumnsRealtime`, mock that hook directly (see `tests/unit/f249-quick-add-optimistic.test.tsx`). Never suppress the error itself.
- No MCP tools were used for this file — pure test-infrastructure work. `npm run test:realtime` did exercise the real linked Supabase project (`qcipqonnqajmazdbysow`, from `.env`) for the 4-file confirmation the coordinator asked for; no credentials were logged.
