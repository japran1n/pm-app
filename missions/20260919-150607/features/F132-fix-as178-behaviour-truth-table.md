# F132 — Fix AS-178: extend hash scope + behaviour truth table

_Mission: 20260919-150607_ _Milestone: M9_ _Parent: F128_

## Problem

The SHA-256 hash only covers the `resolveClientBucket` function body (4 lines). The function's semantics live in `CLIENT_BUCKETS`, `isClientBucket`, and `CATEGORY_BUCKET_FALLBACK` — all outside the hashed span. Mutating `CATEGORY_BUCKET_FALLBACK.not_started` from `"progress"` to `"waiting"` leaves the suite green.

## Fix

In `tests/unit/m9-regression.test.ts`:

### 1. Widen the hash

Extract not just `resolveClientBucket` but ALSO:
- `CLIENT_BUCKETS` constant (or whatever it's named)
- `isClientBucket` function
- `CATEGORY_BUCKET_FALLBACK` constant (or whatever it's named)

Concatenate all their normalized bodies before computing SHA-256. Update `EXPECTED_HASH` to the new value.

Read `components/portal/status-label.ts` to find the exact names of these declarations.

### 2. Add a behaviour truth table test

Add a second `it` block for AS-178 that directly imports and calls `resolveClientBucket` with known inputs:

```ts
it("AS-178b: resolveClientBucket output matches pinned truth table", async () => {
  const mod = await import("@/components/portal/status-label")
  const fn = mod.resolveClientBucket
  
  // Pin the behaviour table — changing any entry requires CLAUDE.md amendment
  const TRUTH_TABLE = [
    // [category, storedBucket, pendingClientApproval] → expected result
    ["approved_by_client", null, false, "..."],
    // ... enumerate all combinations
  ]
  
  for (const [cat, bucket, pending, expected] of TRUTH_TABLE) {
    expect(fn(cat, bucket, pending)).toBe(expected)
  }
})
```

Read the actual function signature from `components/portal/status-label.ts` to understand what parameters it takes. Read the implementation to build a complete truth table covering all categories and bucket values.

### 3. Verify

Run `npx vitest run tests/unit/m9-regression.test.ts --reporter=verbose` — pass.
Run `npx tsc --noEmit` — exit 0.

**Mutation verification**: mutate `CATEGORY_BUCKET_FALLBACK.not_started` (or equivalent) from its current value to something different. The truth table test must turn red.

Commit and write handoff to `missions/20260919-150607/handoffs/F132-handoff.md`.
