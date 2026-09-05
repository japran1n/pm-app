# F004 — M1 wiring regression tests [CLARIFIED-AUTO]

_Clarified automatically under the user's standing instruction to run
the mission without pauses. The plan entry below is the full spec; the
clarification round added the Definition of Done section at the end._

### F004 — M1 wiring regression tests

**Milestone:** M1 · **Est:** 25 min · **Depends on:** F003
**Assertions:** AS-007, AS-010, AS-031, AS-032, AS-033

**Scope:**
- Assert the two-channel topology from the outside: the number of distinct
  topics acquired, and that each topic carries exactly one binding.
- Confirm no existing My Tasks test regressed as a result of F003.

**Files:** `components/my-tasks/*.test.ts(x)`.

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
7. A handoff file exists at `missions/20260902-212300/handoffs/F004-handoff.md`
   and the work is committed.
