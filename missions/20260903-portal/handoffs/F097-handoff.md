# Handoff: F097 — diagnose the 45459ms AS-369 postgres_changes delivery

## Status
PARTIAL

## Assertions covered
AS-369: UNTESTED — cannot be observed locally (no Docker; hosted project delivers sub-second and would prove nothing about the CI local-stack bug). Fix applied is unverified until the next CI run reports the elapsed-time measurement for `[AS-369] postgres_changes event received ...ms after SUBSCRIBED`.

## Files changed
.github/workflows/ci.yml

## Commands run
`npx tsc --noEmit` (0)
`node -e "require('js-yaml').load(fs.readFileSync('.github/workflows/ci.yml'))"` (0, YAML parses)

## Decisions made
- Did not touch the test budget (`HARD_TIMEOUT_MS = 45000` in `tests/integration/reaction-realtime-delivery.test.ts`). Five prior rounds of raising it without understanding the mechanism is exactly what this feature was scoped to stop; the mission brief for F097 explicitly forbids "raise the budget and move on."
- No MCP tools used — this is a CI-infrastructure/local-Docker-stack question, not a hosted-project schema question. `mcp-registry.md` was not consulted because the mechanism under investigation only exists in the ephemeral `supabase start` stack, which the Supabase MCP server (scoped to the hosted project) cannot see.

## Out-of-scope work needed
None identified beyond what's in Blockers below.

## Blockers
BLOCKER: The exact internal Realtime mechanism (relation/schema cache staleness vs. periodic-resync interval vs. something else) cannot be proven from this environment — there is no Docker here, so `supabase start`'s local stack (Postgres + Realtime containers) was never available to reproduce, inspect logs from, or attach `docker exec` to. The diagnosis below is the strongest structurally-provable explanation from the repo's own migration history, not a confirmed root cause from Realtime's source or logs.

TRIED:
- Read `scripts/check-realtime-publication.mjs` (queries `pg_publication_tables` on the *hosted* project via Management API — irrelevant to the local-stack timing bug, since it only checks membership, not timing, and only against the hosted project).
- Diffed the four `REALTIME_LIVE_DELIVERY_TESTS` files (`tests/realtime-live-delivery-tests.ts`) against the migrations that add their tables to `supabase_realtime`:
  - `comments` (subscribed by `comment-format-realtime.test.ts`, passes): joins the publication in `supabase/migrations/20260818050000_realtime_comments_publication.sql` and is **never altered again** by any later migration.
  - `comment_reactions` (subscribed by `reaction-realtime-delivery.test.ts`, the one measuring 45459ms): joins the publication in `supabase/migrations/20260823010000_create_comment_reactions.sql`, then — seven migration-timestamps later, in the same day — `supabase/migrations/20260823080000_fix_comment_reactions_soft_delete_and_scoping.sql` runs `alter table comment_reactions add column task_id ...` **and** `alter table comment_reactions replica identity full;` against a table that is already a publication member. This is the one structural, file-and-line-provable difference between the passing table and the failing one.
- Checked `task_assignees` (migration `20260831000001_task_assignees_realtime_publication.sql` joins the publication *and* sets `replica identity full` in the same file; a follow-up migration `20260831000002_task_assignees_replica_identity_default.sql` reverts it to DEFAULT — another post-join schema change) — not covered by any of the four `REALTIME_LIVE_DELIVERY_TESTS` files, so it can't corroborate or refute the pattern; noted as a candidate for a future test if this diagnosis holds.
- Confirmed the measured number itself: `HARD_TIMEOUT_MS = 45000` in `tests/integration/reaction-realtime-delivery.test.ts`, and the event arrived at `+45459ms`. Since `clearTimeout`/`resolve(null)` in the timeout branch fires first at exactly 45000ms, `received` was already settled to `null` by the time the real event landed 459ms later — the test fails on `expect(received).not.toBeNull()`, not on a wrong payload. The payload itself (per the mission brief) was correct; this run just proves delivery is real, only late.

NEEDED: A CI run's log line (`[AS-369] postgres_changes event received <N>ms after SUBSCRIBED`) after the fix below, to confirm or falsify the mechanism.

SUGGESTED FOLLOWUP: If the next CI run still shows a similarly large (tens-of-seconds) delay even after the Realtime restart added in this change, the mechanism is not a stale-schema-cache-at-boot problem and is more likely an inherent property of the CLI's bundled Realtime image on constrained CI runners (e.g., a fixed internal resync/poll interval that a restart doesn't shorten). In that case the honest next step is exactly what the mission brief describes: set `HARD_TIMEOUT_MS` from the *post-restart* measured number with a comment recording that this is a known, inherent local-stack property (not variance, not contention — already ruled out by the F092 serial-uncontended split), and stop re-guessing. A follow-up feature should own that budget-setting step plus adding `comment_reactions` (or a `task_assignees`-style table) explicitly to `scripts/check-realtime-publication.mjs`'s scope of concern for post-publication-join DDL, so a future migration that alters an already-published table's schema is flagged rather than silently reproducing this bug for a different table.

## Autonomous decisions
AUTONOMOUS_DECISION: Chose a Realtime container restart (via `docker restart` on the container matched by `--filter "name=realtime"`) as the fix rather than reordering migrations or moving the publication-join earlier, because: (1) the mission brief's own suggested remedy for "the Realtime container needs to see the publication/schema before it can serve it" is exactly this — restart or reload Realtime after migrations; (2) reordering the `comment_reactions` migrations would violate this repo's immutable-migrations convention (already documented in `supabase/migrations/20260831000002_task_assignees_replica_identity_default.sql`'s own comment: "REPLICA IDENTITY FULL is left unmodified per the immutable-migrations..."); (3) a restart is the only fix that's correct regardless of which exact internal Realtime mechanism (schema cache, replication-slot relation message, or something else) is at fault, since all of them are cleared by a fresh connection.

AUTONOMOUS_DECISION: Used a loose `docker ps --filter "name=realtime"` match instead of a hardcoded container name (e.g. `supabase_realtime_pm-app`), because the exact name is generated by the Supabase CLI (`project_id = "pm-app"` in `supabase/config.toml`) and was not previously present anywhere in this repo to copy verbatim; the loose filter is more resilient to a CLI naming-scheme version bump and the step hard-fails with a `docker ps` dump if no container matches, so a naming mismatch is loud rather than silently skipped.

## Notes for the next worker
- Read the CI YAML comment added above the new "Restart Realtime" step — it contains the same migration-timestamp evidence trail as this handoff, kept next to the fix so a future reader doesn't have to re-derive it.
- `docker ps`/`docker restart` require Docker to be available on the runner, which it is (`ubuntu-latest` ships Docker preinstalled and `supabase start` already depends on it for every service container).
- The health-check loop after the restart polls `http://127.0.0.1:54321/realtime/v1/` for up to 30s (Realtime is proxied through Kong on port 54321 per this project's `supabase status` output convention used elsewhere in this file) before moving on; if Realtime takes longer than that to come back up, the very next `Export local Supabase env vars` / `Build` steps will surface the failure clearly (connection refused) rather than this step swallowing it.
- I could not run `npm run test` or `npm run test:realtime` here — no local Supabase stack, and the mission brief explicitly says not to run the full suite and that a local pass against the hosted project "proves nothing about this." The only real gate is the next CI run.
