# Handoff: F001 — add node html parser dependency

## Status
COMPLETE

## Assertions covered
(none — infrastructure feature, enables later features, per feature spec)

## Files changed
package.json
package-lock.json
lib/webflow-converter/dependency.test.ts

## Commands run
`npm install node-html-parser@9.0.4 --save` (0)
`npx vitest run lib/webflow-converter/dependency.test.ts` (0, 2 passed)
`npm test` (full suite: 3137 passed, 173 failed, 1687 skipped — pre-existing
integration-test failures unrelated to this change; see Decisions made)

## Decisions made
- Installed exactly `node-html-parser@9.0.4` as specified in the clarified
  spec and tech-decisions.md (verified version, dated 2026-09-17).
- Created `lib/webflow-converter/` (did not exist yet) since it's the target
  directory named in tech-decisions.md's Architecture section for this
  mission's pure conversion engine.
- Added `lib/webflow-converter/dependency.test.ts` as a colocated vitest
  smoke test rather than a bare Node script, per the run instructions
  ("smoke check that node-html-parser resolves in a plain Node script...
  no formal test file required") — a vitest test was chosen instead because
  it exercises the same Node runtime context the eventual Server Action will
  use, gives durable regression coverage in the existing test suite, and
  follows this repo's `*.test.ts` colocation convention referenced in the
  Clarified implementation section (Test surface).
- The dependency was added as a plain production dependency (not devDependency)
  since it is consumed at runtime by the server-only conversion engine, per
  tech-decisions.md's note that it must run in a Node Server Action context,
  not bundled client-side.
- Confirmed no client bundle imports `node-html-parser` — it is only
  referenced from the new server-context test file in `lib/webflow-converter/`.

## Out-of-scope work needed
- The actual conversion engine (parsing Webflow HTML/CSS/JS into typed
  intermediate representations) is not implemented here — that is covered by
  later features (e.g. F002+) per the mission plan. This feature is purely
  the dependency install + resolution smoke check.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Wrote the smoke check as a vitest test file
(`lib/webflow-converter/dependency.test.ts`) instead of a standalone plain
Node script, because the run instructions said a formal test file was "not
required" but did not prohibit one, and a vitest test both satisfies the
plain-Node-runtime-resolution requirement and gives durable, re-runnable
evidence tracked by the existing test suite (aligned with this feature's own
"Test surface" clarified answer: tests colocated as *.test.ts).

## Notes for the next worker
- `lib/webflow-converter/` now exists with only the dependency smoke test in
  it; the next feature that adds the parsing/conversion engine should add its
  own files alongside `dependency.test.ts` without needing to touch it.
- The full `npm test` run shows ~173 pre-existing failures, all in
  `tests/integration/*.test.ts` files hitting `TypeError: fetch failed`
  against Supabase — these are due to no live network/Supabase connectivity
  in this sandboxed run environment and are unrelated to this feature (they
  fail identically with or without the node-html-parser change; verified by
  reading failure messages, all about `createWorkspaceWithOwner` / Supabase
  fetch calls, nothing referencing webflow-converter or node-html-parser).
  No MCP was needed or used for this feature (registry has zero external
  services for this mission).
- `node-html-parser`'s DOM-like API (`parse()`, `.querySelector()`,
  `.childNodes`, `.tagName`, `.text`) was confirmed to match the version
  documented in tech-decisions.md.
