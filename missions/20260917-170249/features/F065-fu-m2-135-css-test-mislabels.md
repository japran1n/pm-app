# F065: fix css.test.ts mislabels (AS-135)

**Milestone:** M2 follow-ups
**Estimated worker time:** 15 minutes
**Depends on:** F062

## Assertion IDs covered
- AS-135

## Fix needed in lib/webflow-converter/css.test.ts

Read the file. Find the following mislabeled tests (exact line numbers may differ):

1. Five tests named `test_AS_057_*` that test nested rules and unknown at-rules but don't test border-radius corner order (AS-057 is the border-radius assertion).
   → Rename to the correct assertion ID: AS-057 is border-radius, so these nested-rule tests should be labeled something like AS-049 or AS-050 (nested CSS / at-rule handling).
   Actually check what assertion covers nested @media and unknown at-rules — from the validation contract it's likely a different AS- number. Use AS-049 (inline styles warning) or look at what assertion best matches. If no existing assertion fits, use a descriptive label like `nested_atrule_warning` with no AS- prefix.

2. Two tests labeled AS-039 that actually test combo-to-base linkage (AS-040's subject).
   → Fix: AS-039 is "standalone class definition", AS-040 is "combo class with comboOf". Change these to AS-040.

After fixing, run:
- grep -n "AS_057\|AS-057" lib/webflow-converter/css.test.ts
  → Should only show tests that actually test border-radius corner order
- grep -n "AS-039" lib/webflow-converter/css.test.ts
  → Should only show tests that test standalone (non-combo) class definition

Run: npx vitest run lib/webflow-converter/css.test.ts
Run: npx tsc --noEmit
Run: npm run lint

Write handoff to: missions/20260917-170249/handoffs/F065-handoff.md
Commit: "fix(AS-135): correct mislabeled AS_057 and AS-039 tests in css.test.ts"
