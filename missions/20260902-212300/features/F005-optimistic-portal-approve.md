# F005 — Optimistic portal approve [CLARIFIED-AUTO]

_Clarified automatically under the user's standing instruction to run
the mission without pauses. The plan entry below is the full spec; the
clarification round added the Definition of Done section at the end._

### F005 — Optimistic portal approve

**Milestone:** M2 · **Est:** 40 min · **Depends on:** none
**Assertions:** AS-012, AS-013, AS-014, AS-015

**Scope:**
- `components/portal/approval-actions.tsx`: replace the bare `useTransition` +
  `await approvePortalTask` + `router.refresh()` sequence with an optimistic
  apply. Reuse `lib/hooks/use-optimistic-action.ts` if its `T`-valued shape
  fits; otherwise follow the same structure locally rather than widening the
  shared hook's contract.
- `approvePortalTask` returns `{ ok: false, error }` on failure and can also
  throw — both paths must revert and toast (AS-013, AS-014).
- In-flight guard so a second click issues no second call (AS-015). Use a ref,
  not `isPending` alone, since `isPending` lags a synchronous double-click.
- Keep `router.refresh()` on success for server-truth reconciliation.

**Files:** `components/portal/approval-actions.tsx`, new test file.

## Definition of done

1. Every assertion named above is covered by at least one test that
   fails if the behaviour is removed.
2. `npx tsc --noEmit` exits 0 (AS-031).
3. `npm run lint` introduces no new errors (AS-032).
4. The unit/component suite passes; no new test requires a live
   Supabase connection (AS-033, AS-034).
5. No new dependency was installed.
6. Public signatures of anything this feature touches still compile for
   existing callers.
7. A handoff file exists at `missions/20260902-212300/handoffs/F005-handoff.md`
   and the work is committed.
