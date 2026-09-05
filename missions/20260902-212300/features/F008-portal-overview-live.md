# F008 — Portal overview live [CLARIFIED-AUTO]

_Clarified automatically under the user's standing instruction to run
the mission without pauses. The plan entry below is the full spec; the
clarification round added the Definition of Done section at the end._

### F008 — Portal overview live

**Milestone:** M2 · **Est:** 50 min · **Depends on:** F007
**Assertions:** AS-018, AS-019, AS-020, AS-024

**Scope:**
- Extract "Waiting on you" and "Delivered this week" out of the RSC
  `app/(portal)/portal/[workspaceSlug]/page.tsx` into a client component seeded
  by server props. The page stays an RSC and keeps its RLS-scoped queries.
- Subscribe to `tasks` via `acquireSharedTopicChannel`, reconcile with F007's
  function, one channel per table.
- Teardown on unmount (AS-024).

**Files:** `app/(portal)/portal/[workspaceSlug]/page.tsx`, new
`components/portal/portal-overview-live.tsx` (or similar), new test.

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
7. A handoff file exists at `missions/20260902-212300/handoffs/F008-handoff.md`
   and the work is committed.
