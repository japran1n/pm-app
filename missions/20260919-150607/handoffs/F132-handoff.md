# Handoff: F132 — Fix AS-178 behaviour truth table

## Status
COMPLETE

## Assertions covered
AS-178: PASS — `npx vitest run tests/unit/m9-regression.test.ts --reporter=verbose` shows both `AS-178` (widened hash) and `AS-178b` (pinned behaviour truth table) passing; mutation test (see below) confirms the test suite fails when the locked implementation changes.

## Files changed
tests/unit/m9-regression.test.ts

## Commands run
`npx vitest run tests/unit/m9-regression.test.ts --reporter=verbose` (0) — before fix: hash mismatch (expected, old hash only covered `resolveClientBucket`'s own span); after updating `EXPECTED_HASH`: 4/4 passed
`npx tsc --noEmit` (0)
`npx vitest run tests/unit/m9-regression.test.ts --reporter=verbose` with mutated `CATEGORY_BUCKET_FALLBACK.not_started` (`"progress"` -> `"waiting"`) (1, expected failure) — both AS-178 (hash) and AS-178b (truth table) failed as intended
`npx vitest run tests/unit/m9-regression.test.ts --reporter=verbose` after reverting the mutation (0) — 4/4 passed again
`git commit` (0)

## Decisions made
- Widened the AS-178 hash extraction to concatenate normalized spans of `CLIENT_BUCKETS`, `isClientBucket`, `CATEGORY_BUCKET_FALLBACK`, and `resolveClientBucket` itself (in that source order) before hashing, joined with `" || "`. This closes the gap where a mutation to the fallback table or the bucket-membership guard — both of which `resolveClientBucket` depends on but which live outside its own function-body span — went undetected by the old hash.
- Recomputed `EXPECTED_HASH` by running the test once with a placeholder hash, reading the actual computed hash out of the failure diff, and pinning that as the new expected value (standard "extract actual output, pin it" pattern for these locked-hash tests).
- Built the AS-178b truth table by reading `resolveClientBucket`'s doc comments and body directly (not by reverse-engineering from expected outputs): pendingClientApproval wins over everything except when category is `"done"`; a valid stored `clientBucket` string wins over the category fallback; invalid/null/undefined stored buckets fall through to `CATEGORY_BUCKET_FALLBACK[category]`; `not_started` and `in_progress` both fall back to `"progress"`, `done` falls back to `"done"`. Table covers all 3 category values × {null, undefined, invalid string, each of the 4 valid bucket strings} × {pendingClientApproval true/false/omitted}, focusing on the cases that distinguish each branch (not a full cartesian product, which would be redundant).
- Did not touch `components/portal/status-label.ts` itself — CLAUDE.md and the mission's Behavioral integrity rule say `resolveClientBucket` must never be changed. Only the test file was modified, per the feature's own instructions.

## Out-of-scope work needed
None identified. The feature spec scope (widen hash + add truth table for AS-178 only) is fully satisfied within `tests/unit/m9-regression.test.ts`.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to join the four normalized spans with `" || "` as a separator before hashing (rather than plain concatenation) so that a mutation which shifts characters across a span boundary (e.g. moving a line from the fallback table into the function body during a future refactor) still changes the hash rather than being absorbed by whitespace normalization at the boundary. This is a implementation detail of the test only; it doesn't affect what's covered.

## Notes for the next worker
- The repo working tree has several unrelated pre-existing modified files (components/code-editor/editor-pane.tsx, missions/20260919-150607/plan.md, missions/CURRENT, scripts/check-cron-health.mjs, and a handful of th-*.test files) and many untracked handoff/milestone files from other in-flight features. None of these were touched by this feature; only `tests/unit/m9-regression.test.ts` was staged and committed to keep this commit scoped to AS-178.
- No MCP tools were needed for this feature — it's a pure test-file change with no external service interaction.
- Mutation testing procedure used: edited `CATEGORY_BUCKET_FALLBACK.not_started` from `"progress"` to `"waiting"` via `sed` (backed up to `.bak`), ran the test (both AS-178 and AS-178b failed as expected), then restored from the `.bak` file and re-ran (both passed). No git diff remained in `status-label.ts` after the revert, confirmed via `git diff --stat`.
