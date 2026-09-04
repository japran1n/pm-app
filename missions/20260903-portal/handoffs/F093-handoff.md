# Handoff: F093 — Stop jsdom unit tests from opening real Realtime WebSockets

## Status
COMPLETE

## Assertions covered
This is an infra/test-hygiene fix, not a product feature — no assertion IDs were assigned in `plan.md`/`validation-contract.md` for it. No AS-NNN lines apply.

## Files changed
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

## Commands run
`npx vitest run tests/unit/board-taskid-deeplink.test.tsx tests/unit/f246-task-detail-sheet-copy-link.test.tsx` (0, no unhandled exception)
`npx vitest run <all 13 patched files>` (0, 64 tests passed)
`npx vitest run $(grep -rl "@vitest-environment jsdom" tests/unit)` — full 81-file jsdom slice, run twice (0, 0; 532 tests passed both times, zero Unhandled Rejection/Uncaught Exception lines in either run)
`npx tsc --noEmit` (0)

## Decisions made
- **Root cause confirmed before fixing.** `tests/unit/board-taskid-deeplink.test.tsx` and `tests/unit/f246-task-detail-sheet-copy-link.test.tsx` both render the real `<Board>` (via `components/board/board.tsx`), which mounts `useBoardRealtime` (`components/board/use-board-realtime.ts`). That hook calls `createClient()` from `@/lib/supabase/client` for real (only dummy env vars were set — no mock of the client itself), so mounting `<Board>` in jsdom opened a genuine Supabase Realtime WebSocket. jsdom's undici-based `WebSocket` polyfill then throws `TypeError: The "event" argument must be an instance of Event` when that socket's connection event fires — exactly the mechanism `vitest.config.ts`'s own comment documents, and exactly why it escaped as an unhandled exception outside any test (the socket connects asynchronously, after the test itself has already passed and cleaned up).
- **Fix pattern — matched an existing precedent, not invented.** `tests/unit/f022-board-realtime-guard-call-site.test.tsx:98` already mocks `@/lib/supabase/client`'s `createClient` to return a fake object with `channel().on().subscribe()` (a no-op chain that captures callbacks instead of opening a socket) specifically to avoid this. I copied that shape verbatim (`makeFakeSupabaseRealtimeClient()`) into every other jsdom file below that renders a component which subscribes to Realtime but didn't yet mock the client.
- **Added `auth.getSession()` to the fake client.** `components/notifications/use-notifications-realtime.ts` (mounted by `AppSidebar`, which `tests/unit/f265-mobile-task-detail.test.tsx` renders) awaits `supabase.auth.getSession()` before subscribing (F272 fix, see that hook's own comment). Without it the fake client threw `Cannot read properties of undefined (reading 'getSession')`. Added a minimal `auth: { getSession: vi.fn(async () => ({ data: { session: null } })) }` to the shared fake-client factory across all 13 files for consistency, even where not strictly needed yet, so future components that gate on session the same way don't reintroduce this failure mode file-by-file.
- **Sweep methodology:** grepped every `@vitest-environment jsdom` test file (81 total) for renders of `Board`, `CalendarDayGrid`, or `TaskListTable` (the three components that transitively call `createClient` via `useBoardRealtime`/`useCalendarRealtime`/`useListRealtime`), then filtered to files that did NOT already mock `@/lib/supabase/client` (3 files already did: `f027-calendar-realtime-wiring.test.tsx`, `f022-board-realtime-guard-call-site.test.tsx`, `f251-list-table-realtime.test.tsx` — left untouched) or the hook directly (`f249-quick-add-optimistic.test.tsx` mocks `useBoardRealtime` itself — left untouched). 13 files needed the fix; all patched.
- **`f325-board-toolbar-groupby-none.test.tsx`** was in the candidate list from the broader grep but only renders `BoardToolbar` (not `Board`), which does not subscribe — confirmed no fix needed.
- **`f251-inline-edit-permissions-realtime.test.tsx`** renders individual list cell components (`ListPrioritySelect` etc.), not `TaskListTable` itself — confirmed no fix needed.
- Left the pre-existing "dummy env vars" comment/lines in the two originally-reported files in place (harmless, and other code paths may still read them) rather than removing — out of scope to prune.

## Out-of-scope work needed
- A flaky, unrelated `EnvironmentTeardownError` around `@tiptap/extension-mention` dynamic import racing pool teardown surfaced in ONE of several full-jsdom-slice runs (in `tests/unit/f006c-task-detail-sheet-page-fields-system-key-gate.test.tsx`'s environment) but did NOT flip the process exit code to 1, and did not reproduce on a repeat run. This looks like a separate, lower-severity flake in Vitest's own pool teardown timing for dynamic tiptap imports, not the WebSocket mechanism this task targets. Worth a follow-up investigation if it recurs, but it is not currently blocking a green exit code.
- Consider a repo-wide test helper (e.g. `tests/helpers/fake-supabase-realtime-client.ts`) exporting `makeFakeSupabaseRealtimeClient()` so the now-14 near-identical copies (13 patched here + the original in `f022-board-realtime-guard-call-site.test.tsx`) don't drift. Not done here to keep this fix minimal and match the existing per-file convention exactly rather than introduce a new shared module unasked.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Added `auth.getSession()` to the shared fake-client shape (beyond the strict minimum needed to fix the two originally-reported files) so the same mechanical fix applies uniformly across all 13 swept files without per-file variation, since `f265-mobile-task-detail.test.tsx` needed it and the alternative (a slightly different fake shape per file) would make the sweep harder to audit.

## Notes for the next worker
- The mechanism, in one sentence: any jsdom-environment test that renders `Board`, `CalendarDayGrid`, or `TaskListTable` without mocking `@/lib/supabase/client` opens a real WebSocket on mount, and jsdom's WebSocket polyfill throws asynchronously after the test has already finished — which fails the whole vitest process (unhandled exception) while every individual test still shows green. This is a **process-exit-code bug**, not a test-content bug: `Test Files N passed` in the summary is not sufficient evidence of a clean run; always check `echo $?` after `vitest run`, exactly as this task's title says.
- If a new component starts subscribing to Supabase Realtime and a jsdom test renders it, watch for this same failure shape and apply the same `vi.mock("@/lib/supabase/client", () => ({ createClient: () => makeFakeSupabaseRealtimeClient() }))` pattern (copy from any of the 13 files touched here, or from `tests/unit/f022-board-realtime-guard-call-site.test.tsx:98`).
- No MCP tools were used — this is pure test-infrastructure work with no live external service state to introspect.
- Did not run the full suite against the shared remote Supabase project per the task's explicit instruction (it manufactures ~130 auth rate-limit failures unrelated to this fix). Ran the full jsdom slice (81 files, 532 tests) twice locally instead, plus `tsc --noEmit`, both clean.
