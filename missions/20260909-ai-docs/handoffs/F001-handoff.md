# Handoff: F001 — SDK install + client + Zod-compat spike

## Status
COMPLETE

## R-1 VERDICT

**R-1 RESOLVED: `betaZodTool` works with zod 4.4.3.**

Evidence gathered without a live network call (`ANTHROPIC_API_KEY` is absent
from `.env`, as expected):

1. **Package compatibility declared explicitly.** `@anthropic-ai/sdk@0.124.0`'s
   `helpers/beta/zod.d.ts` imports `zod/v4` directly (`import * as z from
   'zod/v4'`), and the SDK's `package.json` peerDependency for `zod` is
   `"^3.25.0 || ^4.0.0"`. This project has `zod@4.4.3` installed, and
   `node_modules/zod/v4` exists as a valid subpath export. This is a
   currently-supported combination, not an undocumented one.
2. **Construction does not throw.** Ran a throwaway script
   (`scripts/_spike-toolrunner.mjs`, deleted before commit) that called
   `betaZodTool({ name, description, inputSchema: z.object({ q: z.string() }),
   run })` with a Zod 4 schema. It constructed successfully and returned an
   object with keys `type, name, input_schema, description, run, parse`.
3. **Generated JSON Schema is well-formed.** `tool.input_schema` serialized to:
   ```json
   {
     "$schema": "https://json-schema.org/draft/2020-12/schema",
     "type": "object",
     "properties": { "q": { "type": "string" } },
     "required": ["q"],
     "additionalProperties": false
   }
   ```
   Valid draft 2020-12 JSON Schema, `additionalProperties: false` set
   automatically (matches the fallback pattern's `strict` intent even in the
   non-fallback path).
4. **`client.beta.messages.toolRunner({ tools: [tool], ... })` constructs
   without throwing** when given the `betaZodTool` output directly (no cast
   needed).
5. **Type-checks clean, including the SDK issue #1010 scenario.** Wrote a
   temporary strict-mode TS file (outside `scripts/`, deleted after check)
   that did:
   ```ts
   import type { BetaToolUnion } from "@anthropic-ai/sdk/resources/beta";
   const tool = betaZodTool({ ... }); // Zod 4 schema
   const asToolUnion: BetaToolUnion = tool; // direct assignment, no cast
   ```
   Ran `npx tsc --noEmit --strict --skipLibCheck false` against it: **zero
   errors**. `BetaRunnableTool<T>` is structurally assignable to
   `BetaToolUnion` in this SDK version — the #1010-style incompatibility was
   not reproduced. This appears to have been fixed upstream between the
   version that filed #1010 and 0.124.0.
6. Full project `npx tsc --noEmit` shows only pre-existing, unrelated errors
   (`components/ui/status-badge.tsx`, `tests/unit/docs-markdown-editor-export-import.test.tsx`)
   present identically on `main` before this change (verified via `git stash`).

**Conclusion for F006/F007:** no fallback needed. F006 may declare tools via
`betaZodTool` with ordinary Zod 4 object schemas and pass them straight into
`client.beta.messages.toolRunner(...)` per tech-decisions.md's documented API
surface. No raw JSON Schema / manual `while (stop_reason === "tool_use")`
loop is required. (tech-decisions.md's fallback note can be treated as
not-triggered; F006/F007 do not need to change from what's described there.)

## Assertions covered
AS-045: PARTIAL — this feature does not build the route handler (that's
F007), so the actual `no_api_key` NDJSON event/HTTP-200 behaviour cannot be
tested here. What F001 does provide and verify: `hasApiKey()` returns
`false` when `ANTHROPIC_API_KEY` is unset (confirmed — the key is absent from
`.env` in this environment and `hasApiKey()` correctly returns `false`), and
`getAnthropicClient()` throws a typed `AnthropicClientError` with code
`no_api_key` and a message that contains no secret value, giving F007 the
primitive it needs to emit the `no_api_key` error event per spec.
R-1 resolved: PASS — see `## R-1 VERDICT` above.

## Files changed
lib/ai/client.ts
package.json
package-lock.json

## Commands run
`npm install @anthropic-ai/sdk@^0.124.0` (0)
`node --env-file=.env scripts/_spike-toolrunner.mjs` (0) — spike script, deleted before exit
`npx tsc --noEmit --strict --skipLibCheck false <temp file>` (0) — R-1 type-check scenario, temp file deleted after check
`npx tsc --noEmit` (0 errors attributable to this change; 3 pre-existing unrelated errors confirmed present on main via `git stash`)
`npm run lint` (0 errors, 26 pre-existing warnings in unrelated test files, none new)
`rm scripts/_spike-toolrunner.mjs` (0) — confirmed deleted, not present in `git status`

## Decisions made
- Did not add `server-only` as a new dependency since it isn't already
  present in package.json and the spec explicitly says not to add it if
  absent — used a top-of-file comment instead, per the spec's own
  instruction.
- `getAnthropicClient()` memoizes into a module-level `let cachedClient`
  variable rather than a class singleton, matching the "lazily constructed
  and memoized" instruction with the simplest possible shape.
- `AnthropicClientError` is a plain `Error` subclass with a `code` field
  (currently the sole variant `"no_api_key"`) rather than a union of error
  classes, since F001 only needs to represent the one failure mode (missing
  key) — matches AS-045's `no_api_key` code naming from tech-decisions so F007
  can reuse it directly.
- Did not create `lib/ai/tools/*`, any route handler, or any UI — out of
  scope per the spec's hard constraints (that's F002+).

## Out-of-scope work needed
- F002 (`lib/ai/tools/types.ts` envelope shapes) and F006/F007 (tool
  registry, system prompt, route handler) are unaffected by any fallback —
  they can proceed with `betaZodTool` + `toolRunner` directly as originally
  planned in tech-decisions.md, per the R-1 verdict above.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No feature-spec file existed at
`missions/20260909-ai-docs/features/F001-*.md` (the `features/` directory
contains F002–F013 but not F001) and no
`missions/20260909-ai-docs/clarifications/F001-clarification.md` exists
either. Treated the worker prompt itself (which fully restates the F001
scope, matching plan.md's F001 entry) plus `plan.md` and `tech-decisions.md`
as the authoritative clarified spec for this feature, since they were fully
concordant and left no ambiguity about scope, files, or acceptance criteria.

## Notes for the next worker
- `betaZodTool` + zod 4.4.3 + `toolRunner` is a green light — build F006/F007
  exactly as tech-decisions.md describes, no fallback JSON-Schema loop
  needed.
- `client.beta.messages.toolRunner(...)` is a beta API — confirm at F007 time
  whether it needs an explicit beta header/opt-in flag in this SDK version;
  F001's spike only constructed the runner object and did not attempt to
  iterate/await it (no API key available), so streaming/iteration behaviour
  is unverified — that's F007's job to exercise for real once a key exists in
  `.env`.
- `lib/ai/client.ts` exports `hasApiKey()`, `getAnthropicClient()`,
  `DOCS_MODEL`, and `AnthropicClientError` — import from there rather than
  constructing a second `Anthropic` instance elsewhere (keeps the single
  memoized client invariant intact for AS-105 auditability).
