# F128 — Fix AS-178: SHA-256 byte-identity guard for resolveClientBucket

_Mission: 20260919-150607_ _Milestone: M9_ _Parent: F051_

## Problem

The current AS-178 test does `expect(content).toContain("resolveClientBucket")` — a spelling check. It passes if the entire function body is rewritten or the guard logic is deleted. The CLAUDE.md invariant says this function "must never be changed".

## Fix

In `tests/unit/m9-regression.test.ts`, replace the AS-178 test:

1. Parse `components/portal/status-label.ts` to extract the full `resolveClientBucket` function source — from `export function resolveClientBucket` through its closing `}`. Use a simple regex or string slicing between the function signature and its matching brace.

2. Normalize the extracted body: remove comments, collapse whitespace (replace `\s+` with single space), trim. This prevents false positives from formatting-only changes.

3. Compute SHA-256 of the normalized body using Node's built-in `crypto`:
   ```ts
   import { createHash } from "crypto"
   const hash = createHash("sha256").update(normalized).digest("hex")
   ```

4. Store the expected hash as a constant in the test with a comment:
   ```ts
   // Hash of the normalized resolveClientBucket body.
   // Changing this requires a CLAUDE.md amendment and a deliberate decision.
   // To update: run the test with REGEN_HASH=1 env var, copy the printed hash.
   const EXPECTED_HASH = "<computed hash>"
   ```

5. First run the test in a mode where it computes and prints the hash so you can capture it, then bake in the constant.

6. Verify by mutation: the test comment must note that flipping `category !== "done"` to `category === "done"` must turn the test red.

7. Run `npx vitest run tests/unit/m9-regression.test.ts --reporter=verbose` — pass.
8. Run `npx tsc --noEmit` — exit 0.
9. Commit and write handoff to `missions/20260919-150607/handoffs/F128-handoff.md`.
