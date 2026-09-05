# F006 — Add `client_requests` to the realtime publication [CLARIFIED-AUTO]

_Clarified automatically under the user's standing instruction to run
the mission without pauses. The plan entry below is the full spec; the
clarification round added the Definition of Done section at the end._

### F006 — Add `client_requests` to the realtime publication

**Milestone:** M2 · **Est:** 20 min · **Depends on:** none
**Assertions:** AS-017

**Scope:**
- New migration `supabase/migrations/<ts>_client_requests_realtime_publication.sql`,
  modelled on `20260831000001_task_assignees_realtime_publication.sql`.
- Idempotent: guard the `alter publication ... add table` so re-running is safe.
- Do NOT change replica identity — F042 of the previous mission reverted exactly
  that on `task_assignees`; the same reasoning applies here.
- The worker applies it with `npm run db:apply -- <file>` and confirms
  membership by re-querying `pg_publication_tables`.

**Files:** one new migration.

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
7. A handoff file exists at `missions/20260902-212300/handoffs/F006-handoff.md`
   and the work is committed.
