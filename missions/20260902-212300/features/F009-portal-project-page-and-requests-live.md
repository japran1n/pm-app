# F009 — Portal project page and requests live [CLARIFIED-AUTO]

_Clarified automatically under the user's standing instruction to run
the mission without pauses. The plan entry below is the full spec; the
clarification round added the Definition of Done section at the end._

### F009 — Portal project page and requests live

**Milestone:** M2 · **Est:** 50 min · **Depends on:** F006, F007
**Assertions:** AS-021, AS-022, AS-023, AS-024

**Scope:**
- `components/portal/task-list.tsx`: subscribe to `tasks`, reconcile via F007 —
  status/title updates land live (AS-021), deletes and
  `client_visible → false` remove the row (AS-022).
- `components/portal/request-list.tsx`: subscribe to `client_requests`, insert
  and status-change land live (AS-023).
- Both seeded by their existing server props; both tear down on unmount.

**Files:** `components/portal/task-list.tsx`,
`components/portal/request-list.tsx`, tests for both.

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
7. A handoff file exists at `missions/20260902-212300/handoffs/F009-handoff.md`
   and the work is committed.
