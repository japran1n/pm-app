# F026: Fix palette realtime soft-delete + add wiring tests

**Milestone:** M2
**Depends on:** F012

## Assertion IDs covered
- AS-023, AS-024

## Root cause

`deleteTask` performs a soft delete (`deleted_at = now()`), NOT a SQL DELETE. The palette reconciler only handles hard DELETE events (dead code) and doesn't check `deleted_at` on UPDATE events. So a deleted task stays in search results.

## Fix

1. `lib/palette/reconcile-palette-search-results.ts` — on UPDATE event: check if the payload's `deleted_at` field is non-null; if so, remove the task from results (treat as deletion)
2. `lib/palette/reconcile-palette-search-results.ts` — the hard DELETE branch can stay for completeness

Also fix `lib/hooks/use-palette-search-realtime.ts` — `createClient()` is called unconditionally in the effect, causing 8 previously-green tests to fail. Fix: pass the Supabase client as a parameter OR use the existing pattern from other realtime hooks in the codebase that don't break tests.

Add component-level wiring test: dispatch a fake UPDATE event with `deleted_at` set and assert the task is removed from palette results. Also dispatch a title UPDATE and assert the title changes.

## Files
`lib/palette/reconcile-palette-search-results.ts`, `lib/hooks/use-palette-search-realtime.ts`, `tests/unit/palette-search-realtime.test.ts`

## Definition of done
- AS-023: PASS — title updates in palette on UPDATE event (wiring test)
- AS-024: PASS — soft-deleted task removed from palette on UPDATE with deleted_at set
- The 8 previously-green tests that F012 broke must pass again
