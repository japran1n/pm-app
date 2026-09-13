# Handoff: F000 — Declare the `server-only` dependency

## Status
COMPLETE

## Assertions covered
AS-023: PASS — `npm install server-only@0.0.1` (current published version) added it to `package.json`/`package-lock.json`; the gate (`missions/20260913-perf-latency/tools/test-gate.sh`) reports `GATE PASSED`.

## Files changed
package.json
package-lock.json

## Commands run
`npm view server-only version` (0) — confirmed current published version is 0.0.1
`npm install server-only@0.0.1 --save-exact` (0)
`missions/20260913-perf-latency/tools/test-gate.sh` (0) — "GATE PASSED — no new unit test failures. Known-failing baseline unchanged."
`npx vitest run tests/unit/sign-out-back-navigation.test.ts tests/unit/app-sidebar-project-nav-list.test.tsx tests/unit/f038-as024-coverage.test.ts tests/unit/xss-sanitization-audit.test.ts` (1) — all four still fail, none newly pass (see Notes)
`npm run lint` (0) — 0 errors, 37 warnings (matches accepted baseline)

## Decisions made
- Installed `server-only@0.0.1` (the current and only published version on npm) via `npm install`, letting npm update the lockfile rather than hand-editing it.
- Did not remove any line from `tools/known-failing.txt`: none of the four listed files newly pass after the dependency was added (see below). The list is left unchanged, which is itself the correct action per the spec ("Remove from known-failing.txt any file that now passes" — none do).

## Out-of-scope work needed
- **Real pre-existing layering violation surfaced by this fix, not caused by it.** `tests/unit/sign-out-back-navigation.test.ts` still fails, but the failure mode changed: before this feature it died at import time because Node couldn't resolve the bare specifier `server-only` at all; now that the package is installed and its browser/client guard runs for real, it fails with `Error: This module cannot be imported from a Client Component module. It should only be used from a Server Component.` (thrown by `node_modules/server-only/index.js:1:7`).
  - Root cause: `lib/queries/chat.ts` has `import "server-only"` at its top, but it is imported directly by several files marked `"use client"`:
    - `components/chat/channel-view.tsx`
    - `components/chat/chat-attachment.tsx`
    - `components/chat/chat-nav-list.tsx`
    - `components/chat/chat-message-search.tsx`
    - `components/chat/dm-starter-list.tsx`
    - `components/nav/app-sidebar.tsx`
  - These client components are reachable from the workspace layout's import graph (the layout renders `AppSidebar`), which is why loading the layout module in a test now throws.
  - This is a genuine layering bug (server-only query helpers imported from client components) that predates this mission and is out of scope for F000 per the spec's explicit instruction ("report it in the handoff, do not fix it"). A future feature should either (a) split `lib/queries/chat.ts` into a server-only module and a client-safe type/helper module, or (b) have the listed client components stop importing it directly and instead receive data via props/server actions.
  - `tests/unit/sign-out-back-navigation.test.ts` therefore remains correctly listed in `tools/known-failing.txt` (it was already there and still fails, just for a different, now-real reason).
- `tests/unit/app-sidebar-project-nav-list.test.tsx`, `tests/unit/f038-as024-coverage.test.ts`, and `tests/unit/xss-sanitization-audit.test.ts` continue to fail for reasons unrelated to `server-only` (documented in tech-decisions.md / their own assertions: AS-024-related test-output assertion mismatch, a `waitFor` timeout, and a real `dangerouslySetInnerHTML` sink in `app/layout.tsx` for AS-148). None of these are this feature's scope; left untouched and still correctly listed in `tools/known-failing.txt`.

## Blockers


## Autonomous decisions


## Notes for the next worker
- The gate output prints a "Note — these were failing at mission start and now pass" block when a known-failing file starts passing; it did not print that block on this run, confirming none of the four baseline failures were fixed by this change (expected, since the spec anticipated this fix would surface a real violation rather than silently fix the file).
- Any worker touching `lib/queries/chat.ts` or the chat client components listed above should be aware of the client/server layering violation described in "Out-of-scope work needed" — it will surface again the moment a test actually renders/imports the affected client components in the same process as the workspace layout.
