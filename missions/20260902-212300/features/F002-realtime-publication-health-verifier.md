# F002 — Realtime publication health verifier [CLARIFIED-AUTO]

_Clarified automatically under the user's standing instruction to run
the mission without pauses. The plan entry below is the full spec; the
clarification round added the Definition of Done section at the end._

### F002 — Realtime publication health verifier

**Milestone:** M1 · **Est:** 45 min · **Depends on:** F001 (script conventions)
**Assertions:** AS-005, AS-006

**Scope:**
- New `scripts/check-realtime-publication.mjs`. Scans `components/` and `lib/`
  for `postgres_changes` bindings and extracts each binding's `table:` value —
  discovery from source, never a hand-maintained list (AS-006).
- Queries the linked project for
  `select tablename from pg_publication_tables where pubname = 'supabase_realtime'`
  using the Management API pattern already proven in
  `scripts/apply-migration.mjs` (`SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`).
- Exits non-zero naming any subscribed table absent from the publication.
- Same credential-silence rule as F001.
- Add `"realtime:check"` to `package.json`.
- Unit test over the extraction function with fixture source strings, plus a
  test that a subscribed-but-unpublished table produces a non-zero result.

**Files:** `scripts/check-realtime-publication.mjs`, `package.json`, new test.

**Note:** at baseline this verifier is expected to FAIL on `client_requests`
once F007 adds that subscription — F006 adds it to the publication first, so
the ordering matters.

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
7. A handoff file exists at `missions/20260902-212300/handoffs/F002-handoff.md`
   and the work is committed.
