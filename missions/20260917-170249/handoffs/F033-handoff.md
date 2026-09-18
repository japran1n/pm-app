# Handoff: F033 — clipboard write module using synchronous copy-event trick

## Status
COMPLETE

## Assertions covered
AS-031: PASS — writeToClipboard writes application/json data via the copy-event handler (test: "AS-031: writes application/json to clipboard")
AS-032: PASS — writeToClipboard writes text/plain data via the copy-event handler (test: "AS-032: writes text/plain to clipboard")

## Files changed
lib/webflow-converter-client/clipboard.ts
lib/webflow-converter-client/index.ts
lib/webflow-converter-client/clipboard.test.ts

## Commands run
`npx vitest run lib/webflow-converter-client/` (0) — 4/4 tests passed
`npx tsc --noEmit` (0)
`npm run lint -- lib/webflow-converter-client/` (0)

## Decisions made
- Used the exact synchronous copy-event technique specified in the feature spec: `document.addEventListener("copy", handler, { once: true })` + `document.execCommand("copy")`, intercepting the event to call `e.clipboardData.setData(mimeType, data)` for each item, since the async Clipboard API rejects `application/json`.
- `"use client"` directive added at the top of `clipboard.ts` per spec, since the module references `document` and must never be imported into server-rendered code.
- `index.ts` re-exports `writeToClipboard` from `clipboard.ts` as the module's public entry point for consumers (F034/F035).
- Test file needed `// @vitest-environment jsdom` pragma (repo's vitest.config.ts defaults to `environment: "node"` globally, per F277's documented convention of per-file jsdom opt-in) and a small polyfill stub for `document.execCommand` before `vi.spyOn`, since jsdom does not implement `execCommand` and `vi.spyOn` requires the property to already exist on the object.
- Explicitly imported `describe/it/expect/vi/beforeEach/afterEach` from `"vitest"` since this repo's vitest config does not enable global test APIs.

## Out-of-scope work needed
- F034 (writing the XscpData JSON payload to clipboard on copy) and F035 (writing custom code as text/plain) are downstream consumers of this module and are not implemented here, per the feature spec's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Added a jsdom `execCommand` polyfill stub in the test file's `beforeEach` (only if not already present) before spying on it with `vi.spyOn`, since jsdom does not implement `document.execCommand` and `vi.spyOn` throws if the property is undefined. This is test-only scaffolding and does not affect `clipboard.ts` itself, which was written exactly as specified.

## Notes for the next worker
- No MCP tools used — this is a pure client-side browser API module with no external service dependency.
- Repo's vitest default environment is `node`; any new test file that touches `document`/`window` needs the `// @vitest-environment jsdom` pragma at the very top of the file (see `tests/unit/user-avatar.test.tsx` for a prior example, referenced in vitest.config.ts's F277 comment).
