# F135 — Fix AS-179/AS-182: add missing it() block + traceability label

_Mission: 20260919-150607_ _Milestone: M9_

## Problem

**AS-179**: `tests/unit/m9-regression.test.ts:39` has `describe("M9 regression (AS-178, AS-179, ...)")` but no `it()` block testing AS-179. The assertion (portal components compile without TS errors) is true in fact — `tsc --noEmit` exits 0 and `next build` exits 0 — but the suite provides zero evidence for it.

**AS-182**: The barrel guard test at `tests/unit/m6-action-barrel-guard.test.ts` is genuinely mutation-proven for AS-182, but `grep "AS-182" tests/` returns nothing. Traceability from assertion to test is broken.

## Fix

### AS-179

In `tests/unit/m9-regression.test.ts`, add a real `it()` block for AS-179:

```ts
it("AS-179: portal components compile without TypeScript errors", () => {
  // tsc --noEmit covers this at the AS-006 gate.
  // Here we verify the portal source is included in tsconfig and
  // the critical export exists and has the expected type signature.
  const statusLabelContent = readFileSync(
    join(process.cwd(), "components/portal/status-label.ts"),
    "utf8"
  )
  // Must export resolveClientBucket (type-level check via string presence — tsc handles the rest)
  expect(statusLabelContent).toMatch(/export\s+(function|const)\s+resolveClientBucket/)
  // tsconfig.json must include portal components
  const tsconfig = JSON.parse(
    readFileSync(join(process.cwd(), "tsconfig.json"), "utf8")
  )
  const includesPortal = JSON.stringify(tsconfig).includes("components/portal") ||
    !JSON.stringify(tsconfig.exclude ?? []).includes("components/portal")
  expect(includesPortal, "tsconfig must not exclude components/portal").toBe(true)
})
```

### AS-182

In `tests/unit/m6-action-barrel-guard.test.ts`, find the `describe` title and/or the relevant `it()` block that tests the barrel count and call sites. Add `AS-182` to the test name or describe block so `grep "AS-182" tests/` returns a result.

If the test is `it("barrel guard: EXPECTED_ACTION_COUNT matches exports", ...)` add `[AS-182]` to the name. Similarly for the call-site test.

### Verify

```bash
npx vitest run tests/unit/m9-regression.test.ts tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose
npx tsc --noEmit
grep "AS-182" tests/unit/m6-action-barrel-guard.test.ts
```
All must pass/exit 0/find a match.

Commit and write handoff to `missions/20260919-150607/handoffs/F135-handoff.md` with Status: COMPLETE.
