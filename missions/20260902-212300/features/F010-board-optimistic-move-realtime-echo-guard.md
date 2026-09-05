# F010 — Board optimistic-move / realtime-echo guard [CLARIFIED-AUTO]

_Clarified automatically under the user's standing instruction to run
the mission without pauses. The plan entry below is the full spec; the
clarification round added the Definition of Done section at the end._

### F010 — Board optimistic-move / realtime-echo guard

**Milestone:** M3 · **Est:** 50 min · **Depends on:** none
**Assertions:** AS-025, AS-026, AS-027, AS-028

**Scope:**
- `components/board/board.tsx` already guards optimistic **creates** with
  `pendingOptimisticCreatesRef`. Add the equivalent for **moves**: a
  `pendingMovesRef` holding task ids whose drag Server Action is in flight.
- The realtime reconciliation callback skips `tasks` UPDATE events for an id in
  that set (AS-025).
- The id is released in every terminal path — success, `{ ok: false }`, throw,
  and the `rollback()` helper (AS-026, AS-027). A release that only happens on
  success is the bug this feature exists to prevent.
- Events for ids not in the set are unaffected (AS-028).
- Tests must be discriminating: a mutant that never populates the set, and a
  mutant that never releases it, must both fail.

**Files:** `components/board/board.tsx`, board test file.

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
7. A handoff file exists at `missions/20260902-212300/handoffs/F010-handoff.md`
   and the work is committed.
