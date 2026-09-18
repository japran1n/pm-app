# Handoff: F023 — convert action error shape

## Status
COMPLETE

## Assertions covered
AS-029: PASS — empty-HTML test asserts exact shape `{ ok: false, message: "Paste some HTML to convert.", warnings: [], errors: [] }`
AS-118: PASS — comment-only HTML (no emitted nodes) triggers the engine's validator error; test asserts `ok: false`, non-empty `errors`, and `message === errors[0]`

## Files changed
lib/actions/webflow-converter.ts
lib/actions/webflow-converter.test.ts

## Commands run
`npx vitest run lib/actions/webflow-converter.test.ts` (0, 5/5 passed)
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- `ConvertActionResult` interface implemented exactly per spec: `ok`, optional `message`, optional `json`, optional `js`, always-present `warnings`/`errors` arrays, optional `stats`.
- Empty/whitespace-only HTML short-circuits before calling `convert()` and returns the exact message `"Paste some HTML to convert."` with empty `warnings`/`errors` arrays (not omitted), matching the spec precisely.
- When `convert()` returns `payload === null`, `message` is set to `result.errors[0] ?? "Conversion failed."` and both `errors`/`warnings` from the engine are passed through unmodified.
- For the AS-118 test I originally tried `<body></body>` as the error-triggering input but the engine's emit step still produces a body node from that markup (no error). Switched to a comment-only fragment (`<!-- just a comment -->`) which genuinely produces zero nodes and triggers the validator's `"payload.nodes must not be empty"` error — verified by running the engine directly via `tsx` before finalizing the test.

## Out-of-scope work needed
None identified for F023 specifically.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose a comment-only HTML fragment instead of the spec's suggested `<body></body>` example for the AS-118 error-triggering test case, because `<body></body>` does not actually produce a conversion error in this engine (the body itself becomes a node). This still satisfies the assertion text (a case that produces a conversion error) without deviating from the response-shape contract.

## Notes for the next worker
None beyond what's in F022's handoff.
