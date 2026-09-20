# Handoff: F128 — Fix AS-178 SHA-256 resolveClientBucket guard

## Status
COMPLETE

## Assertions covered
AS-178: PASS — test extracts `resolveClientBucket` from `components/portal/status-label.ts`, normalizes (strips comments, collapses whitespace), computes SHA-256, and asserts it equals the hard-coded `EXPECTED_HASH`.

## Files changed
tests/unit/m9-regression.test.ts

## Commands run
`npx vitest run tests/unit/m9-regression.test.ts --reporter=verbose` (0)
`npx tsc --noEmit` (0)

## Decisions made
- Replaced the weak `toContain("resolveClientBucket")` check with a byte-identity SHA-256 guard per spec, matching CLAUDE.md's "must never be changed" rule for `resolveClientBucket`.
- Extraction logic: search for `export function resolveClientBucket` first, fall back to `export const resolveClientBucket` if not found (source uses `export function`, so the fallback path is unused but present for robustness).
- Normalization: strip `/* */` block comments, then `//` line comments, then collapse all whitespace runs to a single space and trim — this makes the hash resilient to reformatting/reindentation while still catching any actual logic change.
- Computed the hash once via a scratch Node script, then hard-coded it as `EXPECTED_HASH` in the test with the required comment block.
- Note: my edit to this shared test file raced with a concurrent worker (F129) also editing `tests/unit/m9-regression.test.ts` for AS-180/AS-181. The final committed file (commit `66849743`, "fix(F129): positive column assertions + tree-wide removed-action scan") contains both my AS-178 hash-guard change and F129's changes together — verified via `git show HEAD:tests/unit/m9-regression.test.ts` that the AS-178 block is intact and the full suite passes. No separate F128 commit was created because git merged the staged change into the commit that landed first; the diff is present in history regardless.

## Out-of-scope work needed
None.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Since two workers (F128 and F129) touched the same test file concurrently, and my `git add`/`git commit` reported "nothing to commit" after another worker's commit landed first, I verified (via `git show HEAD` and re-running tests/tsc) that my AS-178 hash-guard code is fully present and correct in the current HEAD rather than re-attempting a duplicate/conflicting commit.

## Notes for the next worker
- `EXPECTED_HASH = "54989a5a8988db59d27e52761eb7e2f913989e5e8ab452181c47192d2ec09167"` corresponds to the current normalized body of `resolveClientBucket`. If this function is ever intentionally changed, recompute via the same extract/normalize/hash steps and update `EXPECTED_HASH` in `tests/unit/m9-regression.test.ts`.
- `tests/unit/m9-regression.test.ts` is a shared regression file covering AS-178/179/180/181/182 — expect other workers to touch it concurrently; always re-read before editing.
