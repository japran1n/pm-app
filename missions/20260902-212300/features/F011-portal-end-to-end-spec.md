# F011 — Portal end-to-end spec [CLARIFIED-AUTO]

_Clarified automatically under the user's standing instruction to run
the mission without pauses. The plan entry below is the full spec; the
clarification round added the Definition of Done section at the end._

### F011 — Portal end-to-end spec

**Milestone:** M3 · **Est:** 60 min · **Depends on:** F005, F008
**Assertions:** AS-029, AS-030

**Scope:**
- New `tests/e2e/portal-approve.spec.ts` following the auth and fixture
  conventions already used in `tests/e2e/` (see `notifications.spec.ts` and
  `f272-two-context-notifications.spec.ts` for the two-context pattern).
- Path: sign in as a client → open the portal overview → assert a task is listed
  under "Waiting on you" → click Approve → assert the row leaves the section
  **without a page reload** (assert on absence of a navigation event, not just
  on the final DOM).
- Creates its own fixture task and tears it down (AS-030).
- If no client-role E2E fixture exists, this feature creates one.

**Files:** `tests/e2e/portal-approve.spec.ts`, fixture helper if needed.

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
7. A handoff file exists at `missions/20260902-212300/handoffs/F011-handoff.md`
   and the work is committed.
