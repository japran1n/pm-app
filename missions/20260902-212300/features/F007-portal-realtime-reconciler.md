# F007 — Portal realtime reconciler [CLARIFIED-AUTO]

_Clarified automatically under the user's standing instruction to run
the mission without pauses. The plan entry below is the full spec; the
clarification round added the Definition of Done section at the end._

### F007 — Portal realtime reconciler

**Milestone:** M2 · **Est:** 45 min · **Depends on:** F006
**Assertions:** AS-020, AS-024

**Scope:**
- New `lib/portal/reconcile-portal-realtime-task.ts`, in the shape of
  `lib/tasks/reconcile-list-realtime-task.ts`.
- Membership predicate: `client_visible === true && deleted_at == null`, plus a
  caller-supplied per-surface predicate (e.g. `pending_client_approval === true`
  for "Waiting on you").
- A row that fails the predicate is removed from the list, whether it arrived as
  an UPDATE or a DELETE (AS-020).
- Pure function, fully unit tested, no Supabase import.

**Files:** `lib/portal/reconcile-portal-realtime-task.ts`, its test.

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
7. A handoff file exists at `missions/20260902-212300/handoffs/F007-handoff.md`
   and the work is committed.
