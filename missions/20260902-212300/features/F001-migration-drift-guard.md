# F001 — Migration drift guard [CLARIFIED-AUTO]

_Clarified automatically under the user's standing instruction to run
the mission without pauses. The plan entry below is the full spec; the
clarification round added the Definition of Done section at the end._

### F001 — Migration drift guard

**Milestone:** M1 · **Est:** 30 min · **Depends on:** none
**Assertions:** AS-001, AS-002, AS-003, AS-004

**Scope:**
- New `scripts/check-migration-drift.mjs`. Shells
  `npx supabase migration list --linked --output-format json`, parses the
  `migrations` array, and exits non-zero listing every entry with a falsy
  `remote`.
- Reads `SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF` from the environment;
  exits 1 with a plain message (no stack trace) when either is missing (AS-004).
- Must never print a credential value on any path (AS-003) — do not echo the
  spawned command line, do not dump `process.env` in error handlers.
- Add `"migrations:check": "node --env-file=.env scripts/check-migration-drift.mjs"`
  to `package.json`, matching the existing `db:apply` invocation style.
- Unit test with the subprocess mocked: a clean fixture exits 0, a fixture with
  one empty `remote` exits non-zero and names that version, a missing-env
  fixture exits 1 with the explanatory message, and no fixture's output contains
  a token value.

**Files:** `scripts/check-migration-drift.mjs`, `package.json`, new test.

**Note for the worker:** there is currently **no drift** — all 145 local
migrations have a remote counterpart. A first run that passes is the expected
outcome, not evidence the guard is broken.

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
7. A handoff file exists at `missions/20260902-212300/handoffs/F001-handoff.md`
   and the work is committed.
