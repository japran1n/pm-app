# M7 — Scrutiny pass 10 (final)

**Verdict: GREEN**

## Assertion table

| ID | Status | Reason |
|----|--------|--------|
| AS-069 | PASS | `test_AS_069_no_bare_hour_figure_rendered_in_stacked_row` (tests/unit/f036-stacked-scroll-colour.test.tsx:236) renders the real `StackedPersonRow` and asserts `container.textContent` never matches `/\b\d+\s*h/i`. Mutation-verified: adding `<span>{8}h</span>` to `components/calendar/stacked-person-row.tsx` fails exactly this test; revert restores green (`git diff --quiet` clean). |
| AS-014 | PASS | No regression; f102 suite green, layout derivation driven by real selection count. |
| AS-063 | PASS | No regression; f102 order-preservation test green. |
| AS-064 | PASS | No regression; f035 DOM-order + handle + SortableContext tests green. |
| AS-065 | PASS | No regression; f035 no-op-drag test green. |
| AS-001 | DEFERRED | Not retried per mission instruction. |
| AS-023 | DEFERRED | Not retried per mission instruction. |
| AS-066 | DEFERRED | Not retried per mission instruction. |

## Mutation evidence for AS-069

Under the mutation, the three pre-existing AS-069 render tests (`..._in_planner_header`,
`..._in_stacked_row`, `..._in_stacked_planner`) all still PASSED — they require a context
word (`total`/`booked`/`·`) next to the digits. Only the F116 test caught it. That
confirms the F116 test is the load-bearing one and that pass 9's diagnosis was correct.

## Residual observations (minor, non-blocking)

- `/\b\d+\s*h/i` is broad: a legitimate future block title such as "2 hour standup"
  would trip it. Acceptable trade-off today (titles in the fixture are digit-free), but
  it is a latent false-positive if block titles become user-freeform in the assertion's
  fixture. Severity: **minor**. No follow-up feature required.
- The three older AS-069 regex tests are now redundant/vacuous relative to F116. Harmless.

## Recommended follow-ups

None blocking. Optional cleanup: fold the three context-word-dependent AS-069 assertions
into the F116 bare-token check so the suite has one non-vacuous guard rather than one
guard plus three that no realistic mutation can trip.

## Tooling output

```
$ npx vitest run tests/unit/f031-page-layout-derivation.test.tsx tests/unit/f032-stacked-shell.test.tsx \
  tests/unit/f033-stacked-row-grid.test.tsx tests/unit/f035-stacked-reorder.test.tsx \
  tests/unit/f036-stacked-scroll-colour.test.tsx tests/unit/f098-week-grid-24h.test.tsx \
  tests/unit/f102-calendar-page-composition.test.tsx

 Test Files  7 passed (7)
      Tests  58 passed (58)
   Duration  1.78s
[exit 0]

$ npx tsc --noEmit
[exit 0, no output]

$ npx eslint . --max-warnings=0
[exit 0, no output]
```

Mutation run (stacked-person-row.tsx + `<span>{8}h</span>`):
```
 × test_AS_069_no_bare_hour_figure_rendered_in_stacked_row 8ms
 Test Files  1 failed (1)
      Tests  1 failed | 10 passed (11)
```
Post-revert: `git diff --quiet components/calendar/stacked-person-row.tsx` → REVERTED_CLEAN.
