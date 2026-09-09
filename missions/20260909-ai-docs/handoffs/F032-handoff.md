# Handoff: F032 — Stop interpolating document context into the system prompt (AS-006 blocker)

## Status
COMPLETE

## Assertions covered
AS-006: PASS — new tests prove neither the doc title nor the raw `currentDocId` appear in any `system` block, and a malformed `currentDocId` is rejected with 400 before the model client is even constructed.
AS-041: PASS — existing `test_AS_041_every_line_is_exactly_one_valid_json_object` unaffected and still green; no NDJSON envelope shape changed.
AS-047: PASS — cache breakpoint placement (last stable block, index 3) is unchanged and covered by `test_AS_047_cache_control_is_on_the_last_stable_block_only`; measurement-correctness secondary fix (`firstIterationCached` tracked separately from `totalCached`) verified by manual trace through `route.ts`, no wire contract change (contract text in tech-decisions.md is fixed/verbatim, so `usage.cached` stays whole-turn total; the new `firstIterationCached` var is logged for observability only).
AS-105: PASS — existing `test_AS_105_*` tests still green; secondary fix bounds/sanitizes the one model-controlled string (`toolUse.name`) that reaches `detail` on the tool-not-found path (length-capped, charset-restricted via `sanitizeToolNameForDisplay`).

## Files changed
lib/ai/docs-agent.ts
lib/ai/__tests__/docs-agent.test.ts
app/api/ai/docs/route.ts
tests/integration/f007-docs-agent-route.test.ts
missions/20260909-ai-docs/handoffs/F032-handoff.md

## Commands run
`npx vitest run lib/ai tests/integration/f007-docs-agent-route.test.ts` (0) — 63 passed (up from 59; +4 new unit tests in docs-agent.test.ts, +2 new integration tests, and 1 pre-existing test in each file rewritten in place rather than added)
`npx vitest run lib/ai/__tests__/docs-agent.test.ts tests/integration/f007-docs-agent-route.test.ts` against pre-fix code via `git stash` (5 failed as expected, confirming the new tests actually catch the vulnerability) then `git stash pop` to restore the fix (0)
`npx tsc --noEmit` (1, but 4 pre-existing errors only: app/layout.tsx LayoutProps, components/ui/status-badge.tsx overload, 2x tests/unit/docs-markdown-editor-export-import.test.tsx — none in files this feature touched)
`npx eslint lib/ai/docs-agent.ts lib/ai/__tests__/docs-agent.test.ts app/api/ai/docs/route.ts tests/integration/f007-docs-agent-route.test.ts` (0, no output)

Per the standing rule in `missions/20260909-ai-docs/state.md`, `npm test` (the full live-Supabase suite) was NOT run.

## Decisions made
- Dropped the "Current document: ..." line from the volatile system tail entirely, per the spec's stated preference ("prefer dropping it if the prompt still reads well"). `resolveCurrentDocTitle` (the proactive `get_current_doc` call `buildDocsAgentRequest` used to make) is removed outright — the model now resolves the open document itself via the `get_current_doc` tool when it needs to, and that result reaches it as a `tool_result`, squarely inside `INJECTION_DEFENSE`'s stated scope.
- `currentDocId` stays in `BuildDocsAgentRequestInput`'s signature (unused, `void`-marked, matching the existing pattern for `userId`) rather than removing the parameter — route callers still pass it, and a future feature may want it for tool-scoping; removing it would be a bigger, out-of-scope signature change for a fix that only needs to stop it reaching the prompt.
- `route.ts`'s `currentDocId` schema changed `z.string().optional()` → `z.string().uuid().optional()`. This is the only route-side gate; a malformed id now fails Zod parsing and returns the existing generic 400 before `buildDocsAgentRequest` (and therefore before `getAnthropicClient()`) is ever reached — verified with a new test that asserts `getAnthropicClientMock` was never called, not just that the response was 400.
- Secondary fix (`totalCached`/AS-047 measurement correctness): rather than changing the NDJSON wire contract (fixed verbatim in `tech-decisions.md` as `{"t":"usage","in":123,"out":456,"cached":789}` — no new field), added an internal-only `firstIterationCached` counter that isolates a turn's very first model-call iteration's cache hit from later within-turn iterations, and logs it via `logger.info` alongside the totals. This keeps the wire contract untouched while giving observability/a future test something to assert on if AS-047 gets a stricter cross-request test later. Did not add a dedicated unit test for this internal-only logging value since it isn't part of this feature's assigned assertion set beyond "measurement correctness" and the spec's remediation explicitly offers "separate the counters" OR "a turn-1 cached==0 control" as either being sufficient — chose the former since it's less likely to introduce a flaky/timing-sensitive test.
- Secondary fix (`detail` sanitization): added `sanitizeToolNameForDisplay()` that strips to `[a-zA-Z0-9_-]` and caps at 64 chars before the tool-not-found `detail` string is built. Did not add a dedicated new test for this either — it is pre-M2 hardening the spec asked for "before M2 renders detail in a tool card," not something with an assigned assertion ID or an attacker-reachable path today (real tool names never fail this path in current code).

## Out-of-scope work needed
- M2 (per the spec) is expected to start sending `currentDocId` from the client UI and to render `detail` in a tool card — both of those UI features should re-verify this fix's assumptions are still upheld once built (i.e. that no new code path re-introduces document text into `system`).
- No dedicated test exists yet for the `firstIterationCached`/measurement-correctness secondary fix beyond code-review-level verification described above. If a future AS-047 feature adds a "second turn reports cached > 0, first turn does not" test, it should assert against the logged `firstIterationCached` value (or route.ts should be revisited to decide whether that value should ever reach the wire).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to drop the current-document line from the system prompt entirely (rather than moving it into a leading `role: "user"` block) because the spec explicitly said "Prefer dropping it if the prompt still reads well" and the model already has `get_current_doc` available as a tool — no loss of capability, and it is the option with literally zero attacker-controlled text at any authority level, which is what the spec asked me to optimize for ("the least attacker-controlled text at system authority is none").
AUTONOMOUS_DECISION: For the `totalCached` secondary fix, chose "separate the counters" (add `firstIterationCached`, logged only) over "add a turn-1 cached==0 control" test, since the wire contract itself doesn't expose a way to add a testable assertion without touching the fixed NDJSON shape, and a log-only signal is the safer of the two remediation paths the spec itself offered as acceptable alternatives.

## Notes for the next worker
- The five-artifact evidence for this feature: (1) the vulnerable pre-fix test run (`git stash` + vitest run, captured in this session's output — 5 failures against pre-fix code across both test files), (2) the post-fix green run (63/63), (3) `tsc --noEmit` with only the 4 pre-existing baseline errors, (4) clean `eslint` on all four touched files, (5) this handoff.
- `lib/ai/__tests__/docs-agent.test.ts`'s old `test_AS_047_volatile_tail_carries_current_doc_and_date_uncached` (asserted the title/id WERE present) was renamed to `test_AS_047_volatile_tail_carries_only_the_date_uncached` and now asserts the opposite; two new tests (`test_AS_006_current_doc_title_never_appears_in_any_system_block`, `test_AS_006_raw_currentDocId_never_appears_in_any_system_block`) cover the injection vectors directly. `"handles no currently-open document without calling get_current_doc"` was replaced with a broader test covering both the with-doc and without-doc cases since `get_current_doc` is now never called proactively either way.
- `tests/integration/f007-docs-agent-route.test.ts`'s `getAnthropicClient` mock was lifted out of the inline `vi.mock` factory into a named `getAnthropicClientMock` var so tests can assert the client was never constructed — this was necessary to satisfy the spec's "assert the client was never constructed, not just that the response was 400" requirement.
- No MCP tools were used — this feature touches only in-repo prompt-assembly and route logic, no live external service state.
