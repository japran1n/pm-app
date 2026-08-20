# Handoff: F296 — extension defaults and success state

## Status
COMPLETE

## Assertions covered
AS-563: PASS — Playwright: after a real submit, the success view shows the real task's real formatted key (matches `${projectKey}-${taskNumber}` computed server-side via `lib/tasks/task-key.ts`'s `formatTaskKey`), and clicking "Open board" makes a real `chrome.tabs.create` call (a real new browser tab opens, verified via `context.waitForEvent("page")`) with the exact real board URL as its argument.
AS-564: PASS — Playwright (3 scenarios): (1) after a successful submit, `chrome.storage.local`'s `pmapp-last-report-context` key genuinely holds the workspace/project id used; (2) same-session "Report another" clears title/description but leaves workspace/project selected; (3) a FRESH popup mount, seeded directly via `chrome.storage.local` (not through the same-session "report another" path), also preselects the remembered workspace/project; (4) a remembered workspace/project no longer in the real, server-scoped options list is silently not force-selected (falls back to no preselection).

## Files changed
extension/src/popup/success.tsx (new)
extension/src/state/preferences.ts (new)
extension/src/popup/report-form.tsx
extension/tests/success-and-preferences.spec.ts (new)
app/api/extension/tasks/route.ts
lib/actions/tasks.ts

## Commands run
`npx tsc --noEmit` (root) (0)
`npx eslint app/api/extension/tasks/route.ts lib/actions/tasks.ts` (root) (0)
`cd extension && npx tsc --noEmit` (0)
`cd extension && npx eslint .` (0, 1 pre-existing unrelated warning in console-capture.spec.ts)
`npx vitest run tests/integration/extension-create-task.test.ts tests/unit/task-key.test.ts` (0, 14 passed)
`npx vitest run tests/integration/create-task.test.ts tests/integration/subtask-actions.test.ts` (0, 16 passed — proves the additive `number` field on `createTaskForUser`'s return didn't break existing callers)
`cd extension && npm run build` (0)
`cd extension && npx playwright test tests/success-and-preferences.spec.ts` (0, 3 passed)
`cd extension && npx playwright test` (full suite, run 1) (0, 73 passed)
`cd extension && npx playwright test` (full suite, run 2, flakiness check) (0, 73 passed)

## Decisions made
- **Task key computed server-side, in the tasks route response.** `POST /api/extension/tasks` now selects `key` from the project row and adds `number` to `createTaskForUser`'s (`lib/actions/tasks.ts`) returned data (additive field — every existing caller already destructures specific fields, so this is backward compatible; verified with `create-task.test.ts` and `subtask-actions.test.ts`, both still green). The route computes `taskKey` via `lib/tasks/task-key.ts`'s `formatTaskKey()` — the one existing formatter — rather than duplicating the format client-side.
- **F246 (deep-linked task route) has not landed.** Grepped `app/` and found no `[taskKey]`/task-detail dynamic route beyond the extension's own API routes, confirming the spec's own stated situation. The success link falls back to the project's real board URL, `/w/<workspaceSlug>/projects/<projectId>/board` (verified as the real route by finding `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/board/page.tsx`). The route returns a relative `boardPath` (not an absolute URL) — the popup already knows its own `APP_URL` (`extension/src/lib/supabase.ts`) and prefixes it, avoiding a second "what's the app origin" contract server-side.
- **Link opened via `chrome.tabs.create`**, mirroring `Popup.tsx`'s existing `openConnectFlow` pattern exactly, not a plain `<a href>` (which behaves unreliably inside an MV3 popup document).
- **`extension/src/state/preferences.ts` follows F291's `privacy-toggles.ts` conventions exactly**: flat unprefixed key (`pmapp-last-report-context`), never throws (malformed/unset falls back to `null` = "no remembered context"), read-then-write shape.
- **Only workspaceId/projectId are persisted** (AS-564's literal wording) — not status/title/description/assignee/priority/due-date. Written only on a successful submit (fire-and-forget `setLastReportContext(...).catch(() => {})` right after a 201 response), never on every keystroke/selection change, so an abandoned form never pollutes the remembered context.
- **Preselection never widens what's offered (AS-557 still holds).** The remembered workspace/project id is matched against the real options the context endpoint returned; if it's not present (removed membership, deleted project), the picker silently stays unselected — never crashes, never force-selects an invalid `<option>`. Proved with a dedicated Playwright test seeding a nonexistent workspace/project id directly.
- **"Report another"** resets title/description/status/assignee/priority/due-date to their original defaults but deliberately leaves workspace/project selection untouched (already the just-used/just-remembered values) and does not re-fetch the context endpoint from scratch.
- **"Cleared on sign-out"**: read `Popup.tsx`'s current `disconnect()` — it still calls `chrome.storage.local.clear()` unconditionally after `supabase.auth.signOut()`, exactly as F282 documented. No new code needed; this already clears the new `pmapp-last-report-context` key along with everything else. Confirmed by reading the current source, not just assumed.
- **Test: real task key + real board URL, without relying on network-level route interception of a brand-new out-of-band tab's first navigation.** Playwright cannot reliably intercept the very first navigation request of a tab opened via `chrome.tabs.create` (verified empirically during test development — `context.route`/`page.route` registered up front never saw that first request, only a second, later one such as a redirect). The test instead wraps (not replaces) the real `chrome.tabs.create` to capture the exact URL argument the popup's real call is made with, while still letting the real call proceed and open a real new tab (asserted via `context.waitForEvent("page")`) — mirroring `session-handoff.spec.ts`'s established stubbing precedent for this exact API, extended to also prove the real tab genuinely opens.

## Out-of-scope work needed
- F246 (a deep-linked per-task route, e.g. `/w/<slug>/tasks/<taskKey>`) has not landed. Once it does, `app/api/extension/tasks/route.ts`'s response should switch from `boardPath` to a real task-detail deep link, and `success.tsx`'s "Open board" button/copy should be updated accordingly — a small, scoped follow-up, not blocking.
- The web app's `/w/[workspaceSlug]/.../board` route redirects an unauthenticated request straight to `/sign-in` with no `next`/redirect param preserved. Not this feature's scope, but worth noting: a reporter clicking "Open board" from the extension in a browser profile with no active pm-app web session lands on a bare sign-in page rather than being returned to the board after signing in. Out of scope for F296 (which only needs to prove the extension requests the right URL); a future feature could add `next` param support to the sign-in redirect if desired.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Added `number` to `CreateTaskResult`'s success shape in `lib/actions/tasks.ts` (shared by both the web app's `createTask` Server Action and the extension's `createTaskForUser` path) rather than doing a second DB round-trip in the extension route to fetch the task's `number` after insert. This is additive/backward-compatible (verified against `tests/integration/create-task.test.ts` and `tests/integration/subtask-actions.test.ts`, both still passing) and keeps `lib/tasks/task-key.ts`'s formatter as the single place that ever combines a project key + task number, per the spec's own stated preference.

## Notes for the next worker
- `extension/src/state/preferences.ts` exports `getLastReportContext`/`setLastReportContext` — reuse these rather than reading `chrome.storage.local` directly if a future feature needs the last-used workspace/project.
- `extension/src/popup/success.tsx`'s `ReportSuccess` component takes `taskKey`/`boardPath` as props (both nullable) plus `onReportAnother` — swap in a real task-detail path once F246 lands, no other call-site changes needed beyond `report-form.tsx`'s destructuring of the tasks route response.
- MCP usage: none (per this feature's spec, "MCP at run: none" — no live Supabase schema/policy changes were needed; the `number` and `key` columns already existed from F145/F146).
