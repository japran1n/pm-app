# M2 — Scrutiny pass 8

Scope: single re-verification of AS-024 after the F044 fix. All other M2
assertions carry forward their scrutiny-7 dispositions unchanged.

## Assertion results

| ID | Verdict | Reason |
|----|---------|--------|
| AS-015 | INCONCLUSIVE | Carried from scrutiny-7 (accepted); requires live multi-client realtime, not reachable from unit scope. |
| AS-017 | INCONCLUSIVE | Carried from scrutiny-7 (accepted); same live-environment limitation. |
| AS-018 | PASS | Carried from scrutiny-7. |
| AS-022 | PASS | Carried from scrutiny-7. |
| AS-024 | PASS | MUT-R kills the suite. See below. |

Verdict: **GREEN** — every assertion is PASS or accepted-INCONCLUSIVE. No blockers.

## AS-024 verification (MUT-R)

Baseline `tests/unit/f038-as024-coverage.test.ts`: 4 passed.

Mutation applied: `components/command/command-palette.tsx:447` —
the `resetPaletteState();` call inside the quick-action `onSelect` branch
(the `navigateTo == null` path, reached only by "Toggle theme") replaced
with a comment.

Result: `Test Files 1 failed | Tests 1 failed | 3 passed`. The failure is
`test_AS_024_quick_action_close_without_navigate_clears_the_tombstone_map`
at line 362 — the re-opened session never re-surfaces "Old title", i.e. the
tombstone survived the close, which is exactly the behaviour AS-024
prohibits. File restored byte-identical (`git diff` empty) before the full
gate run.

This is genuine behavioural coverage, not implementation mirroring: the
assertion is checked through observable UI state across two palette
sessions (task reappears in a fresh search), not by spying on
`resetPaletteState` or asserting on internal map contents. Failure mode is
the user-visible one — a silently suppressed task.

The remaining three tests in the file are unaffected by MUT-R, confirming
each of the three close paths (`navigate`, `handleOpenChange`, quick-action
branch) is independently pinned rather than one test covering all three.

## Residual observation (major, non-blocking)

The quick-action test reaches its state by exploiting a real inconsistency
in the product code: `hasQuery` in `command-palette.tsx` is computed with
`query.trim().length > 0`, while the realtime teardown gate in
`lib/hooks/use-palette-search-realtime.ts` uses the untrimmed
`query.length === 0`. With a whitespace-only query the palette renders the
quick-actions view as if empty while the realtime channel stays subscribed
and can still write tombstones into `realtimePatches`. AS-024 is met today
only because the quick-action close path clears that map. This is a
correctness smell in its own right, and the test is coupled to it: if a
future change makes the two gates agree, this test would stop exercising
the branch it names (it would go green for the wrong reason rather than
red, so the coupling is silent). Severity: major — assertion met, coverage
fragile.

## Recommended follow-up features

1. **Unify the whitespace-query gate.** Make the realtime subscription
   teardown condition in `lib/hooks/use-palette-search-realtime.ts` use the
   same trimmed emptiness test as `hasQuery` in `command-palette.tsx`, so a
   whitespace-only query tears the channel down instead of leaving it live
   behind a quick-actions view. Add a test asserting that a DELETE event
   arriving while the query is `" "` produces no entry in the patch map at
   all. This removes the class of stray-tombstone bug rather than relying
   on every close path to clean up after it, and makes the AS-024 close-path
   tests independent of the discrepancy.

2. **Guard the three close paths structurally.** All three exits
   (`navigate`, `handleOpenChange`, the `navigateTo == null` quick-action
   branch) currently repeat `setOpen(false)` + `resetPaletteState()` by
   hand. Collapse them into a single `closePalette()` helper so a fourth
   exit added later cannot forget the reset, and keep the three existing
   behavioural tests pointed at the helper's call sites.

## Gate output

### tsc --noEmit
Exit 0, no diagnostics.

### npm run lint
`13 problems (0 errors, 13 warnings)` — all `@typescript-eslint/no-unused-vars`
on underscore-prefixed mock parameters in test files
(`f006-my-tasks-checkbox-optimistic.test.tsx`,
`palette-actions-recents.test.tsx`, and others). Pre-existing, unchanged
from scrutiny-7. Not a blocker.

### npx vitest run (full)
```
 Test Files  47 failed | 341 passed (388)
      Tests  38 failed | 2540 passed | 214 skipped (2792)
   Duration  491.60s
```
Filtering the failure list for non-`tests/integration/**` files returns
zero results — every failing file is an integration suite that signs real
users into live Supabase and fails on environment, not on milestone code.
Same class of failure documented in scrutiny-7 (49 files / 44 tests there);
the count moved because of live-data variance, not a regression. Unit and
component suites are fully green.

### MUT-R (AS-024)
```
baseline:      Test Files 1 passed (1)   Tests 4 passed (4)
under MUT-R:   Test Files 1 failed (1)   Tests 1 failed | 3 passed (4)
               ↳ test_AS_024_quick_action_close_without_navigate_clears_the_tombstone_map
                 command-palette.tsx:447 resetPaletteState() removed
```
