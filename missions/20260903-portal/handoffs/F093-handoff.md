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
tests/unit/palette-search-results.test.tsx
tests/unit/palette-actions-recents.test.tsx
tests/unit/command-palette-shell.test.tsx
tests/unit/user-avatar.test.tsx

## Commands run
(all commands below run with `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` loaded into the process env from `.env`, via `set -a; source .env; set +a` — matching CI's condition; see "Decisions made" for why this matters)
`npx vitest run tests/unit/palette-search-results.test.tsx tests/unit/palette-actions-recents.test.tsx tests/unit/command-palette-shell.test.tsx tests/unit/user-avatar.test.tsx` — run explicitly by path both BEFORE the fix (1, reproduced CI's 4-file failure locally) and AFTER (0, 35 tests passed)
`npx vitest run $(grep -rl "@vitest-environment jsdom" tests/unit)` — full 81-file jsdom slice, run 3 times after the fix (0, 0, 0; 532 tests passed each time)
`npm run test:realtime` (0, 4 files / 12 tests passed against the real linked Supabase project — confirms the stub still does not touch `vitest.realtime.config.ts`'s node-environment live sockets)
`npx tsc --noEmit` (0)

## Decisions made
- **Root-caused the local-pass/CI-fail discrepancy before fixing anything, per the coordinator's explicit ask.** The coordinator's own theory (hosted vs. local Docker URL) was correctly identified as incomplete, and the actual cause is upstream of any URL value:
  - `lib/supabase/client.ts`'s `createClient()` calls `createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!)`. When those env vars are `undefined`, `createBrowserClient` throws synchronously ("Your project's URL and API key are required...") — confirmed directly: `node -e "require('@supabase/ssr').createBrowserClient(undefined, undefined)"` throws that exact message.
  - `lib/hooks/use-palette-search-realtime.ts` (and `lib/tasks/subscribe-comments-realtime.ts`'s reactions path) wrap that call in `try { supabase = createClient(); } catch { return; }` — a deliberate, pre-existing design decision (see that hook's own comment: "Guard against environments where a Supabase browser client cannot be constructed... degrades to 'no live updates' instead of crashing") so a misconfigured environment doesn't crash the component tree.
  - My prior verification ran `npx vitest run <files>` directly from a bare shell, which does **not** load `.env` into `process.env` (nothing in `vitest.config.ts`, `package.json`, or the test files themselves calls `dotenv.config()` — confirmed with `node -e "console.log(process.env.NEXT_PUBLIC_SUPABASE_URL)"` printing `undefined` in that same shell). So for these 4 specific files — which, unlike the 13+2 files fixed in the previous two rounds, never set their own dummy `NEXT_PUBLIC_SUPABASE_URL`/`KEY` fallback (`??=`) at the top of the file — `createClient()` threw immediately and was silently swallowed by the hook's own try/catch. No client was ever constructed, so no `WebSocket` was ever attempted, so my stub never fired, and the tests "passed" for the wrong reason: the leak was masked by a missing env var, not absent.
  - CI, by contrast, runs against a real local Supabase instance and exports its connection details into the job's env via `supabase status -o env` (see `65dab91 fix(ci): strip quotes from GITHUB_ENV lines exported by supabase status -o env`, already in this repo's history) — so `NEXT_PUBLIC_SUPABASE_URL`/`KEY` ARE set in CI's process env, `createClient()` succeeds there, the hook proceeds to actually subscribe, and the stub correctly fires and fails the file.
  - Reproduced this exactly: ran the same 4 files with `.env` loaded into the process (`set -a; source .env; set +a`) and got the identical failure CI reported, byte-for-byte matching error shape (only the URL differed — my `.env` points at the hosted project, CI's local stack — which is cosmetic, not causal). Confirms this is a real, correctly-surfaced leak in these 4 files, not a stub bug, and confirms the discrepancy was a gap in MY verification method (not sourcing `.env`), not a difference in the stub's behavior across environments.
  - **The 13+2 files fixed in the previous two commits are unaffected by this gap** — they all set dummy `NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co"` (etc.) inline, so `createClient()` succeeded regardless of the ambient shell env, which is why those verifications were trustworthy without sourcing `.env` and why CI has been green on that portion since.
- **Fixed all 4 files with the established mock pattern**, no new pattern needed:
  - `tests/unit/palette-search-results.test.tsx`, `tests/unit/palette-actions-recents.test.tsx`, `tests/unit/command-palette-shell.test.tsx`: all render the real `<CommandPalette>`, which mounts `usePaletteSearchRealtime` (`lib/hooks/use-palette-search-realtime.ts`) → `createClient()` for real. Added the same `vi.mock("@/lib/supabase/client", ...)` fake-client mock used in the 13-file sweep.
  - `tests/unit/user-avatar.test.tsx`: already mocked `useCommentsRealtime` (comment-list.tsx's first Realtime hook) but not `useReactionsRealtime` (comment-list.tsx's SEPARATE second hook, on the `reactions` table) — the same "mocked one hook, missed a second hook on the same component" shape as `f249-quick-add-optimistic.test.tsx`'s `useBoardRealtime`/`useBoardColumnsRealtime` gap from the previous round. Added a matching no-op mock for `useReactionsRealtime`.
- **Did not touch the stub itself.** No per-file escape hatch, no weakening, no suppression — per the coordinator's explicit constraint. The stub did exactly what it was designed to do: convert 4 previously-silent leaks (silent for a different reason than the first 2 rounds — env-dependent short-circuiting, not async timing) into named, attributable failures the moment the right environment actually exercised them.
- **Going forward, verification for this class of fix must source `.env` (or otherwise ensure `NEXT_PUBLIC_SUPABASE_URL`/`KEY` are set) before running vitest**, to match CI's condition and avoid this exact blind spot recurring. Noted below for the next worker.

## Out-of-scope work needed
- (carried over) A flaky, unrelated `EnvironmentTeardownError` around `@tiptap/extension-mention` dynamic import racing pool teardown was seen once early in this task's history and has not recurred across 6+ subsequent full-slice runs; still worth a follow-up if it resurfaces.
- Consider a shared test helper (e.g. `tests/helpers/fake-supabase-realtime-client.ts`) exporting `makeFakeSupabaseRealtimeClient()` so the ~19 near-identical inline copies across `tests/unit/*.test.tsx` don't drift.
- Worth considering, separately: should `tests/setup/testing-library.ts` (or a new setup file) also fail loudly if `NEXT_PUBLIC_SUPABASE_URL`/`KEY` are unset in a way that silently degrades a component's behavior (per each hook's own try/catch), so a future local run without `.env` sourced can't again produce a false-negative for THIS class of leak? Not implemented here — it would change behavior for every hook using that try/catch pattern, which is broader than this task's scope and worth its own decision, not a drive-by addition.
- `tests/integration/overdue-notification-sweep.test.ts`'s `F321/AS-383` failure (also present in CI run 33877551433) is explicitly out of scope per the coordinator's message — left untouched.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Verified going forward by sourcing `.env` into the shell before every vitest invocation in this round, to match CI's env-var presence rather than relying on the previous (incomplete) bare-shell verification method. This is a verification-methodology decision, not a code change, but recording it here since the coordinator specifically asked for it to be explained and addressed.

## Notes for the next worker
- **When verifying any fix touching Realtime subscriptions in this repo, always source `.env` into the shell first** (`set -a; source .env; set +a` or equivalent) before running `vitest run` directly. A bare shell has `NEXT_PUBLIC_SUPABASE_URL`/`KEY` unset, which several hooks (`use-palette-search-realtime.ts`, `subscribe-comments-realtime.ts`'s reactions path, and likely others sharing the same `try { createClient() } catch { return; }` guard) treat as "gracefully skip the subscription" — silently hiding exactly the class of bug this file's stub exists to catch. `npm test`/CI presumably source env differently (CI via `supabase status -o env`); a bare `npx vitest run <path>` does not.
- The invariant enforced by `tests/setup/testing-library.ts` stands: **a jsdom-environment unit test must never open a real WebSocket.** If you see a `JsdomWebSocketDisabledError` in a file NOT in the list above, it's very likely another instance of this exact pattern — a component mounting a Realtime hook this file's mocks don't cover. Check for a SECOND hook on the same rendered component before assuming a single mock is missing (this was true twice now: `board.tsx`'s columns hook, and `comment-list.tsx`'s reactions hook).
- No MCP tools were used for this file — pure test-infrastructure work. `npm run test:realtime` exercised the real linked Supabase project (`qcipqonnqajmazdbysow`, from `.env`) for the confirmation the coordinator asked for; no credentials were logged.
