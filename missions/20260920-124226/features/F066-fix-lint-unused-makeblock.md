# F066: Fix lint — delete unused `makeBlock` helper in f023-readonly-popover.test.tsx

**Milestone:** M5 follow-up 3 (scrutiny pass 3 blocker)
**Estimated worker time:** 5 minutes

## Problem

`tests/unit/f023-readonly-popover.test.tsx` declares a `makeBlock` helper at line 29 that
is never called. The helper was left over when F065 rewrote the file to use `makeGridBlock`.
`npx eslint . --max-warnings=0` exits non-zero with:

```
tests/unit/f023-readonly-popover.test.tsx
  29:10  warning  'makeBlock' is defined but never used
```

This is the only thing blocking M5 scrutiny pass 3.

## Fix

Delete the `makeBlock` function definition from `tests/unit/f023-readonly-popover.test.tsx`.
Do not rename it with a `_` prefix — it should be fully removed.

## Files
- `tests/unit/f023-readonly-popover.test.tsx`

## Gate

```bash
npx eslint tests/unit/f023-readonly-popover.test.tsx --max-warnings=0   # must exit 0
npx vitest run tests/unit/f023-readonly-popover.test.tsx                 # all pass
```

## Definition of done
- `makeBlock` has zero occurrences in `tests/unit/f023-readonly-popover.test.tsx`
- ESLint clean on that file
- All tests in that file pass
- Committed
