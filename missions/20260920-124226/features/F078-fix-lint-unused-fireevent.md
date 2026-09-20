# F078: Fix lint — remove unused `fireEvent` import in people-switcher-placement-a11y.test.tsx

**Milestone:** M6 follow-up 4
**Estimated worker time:** 5 minutes

## Problem

`tests/unit/people-switcher-placement-a11y.test.tsx:15` imports `fireEvent` from `@testing-library/react` but it's unused after F076 deleted the AS-061 jsdom cases.

`npx eslint . --max-warnings=0` exits 1 with:
```
tests/unit/people-switcher-placement-a11y.test.tsx
  15:xx  warning  'fireEvent' is defined but never used
```

## Fix

Remove the `fireEvent` import from line 15 (or wherever it is in the import statement).

## Gate
```bash
npx eslint tests/unit/people-switcher-placement-a11y.test.tsx --max-warnings=0
npx vitest run tests/unit/people-switcher-placement-a11y.test.tsx
```

## Definition of done
- No unused import warning
- All tests pass
- Committed
