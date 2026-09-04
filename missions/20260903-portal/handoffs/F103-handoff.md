# Handoff: F103 — AS-369 replica-identity capability guard

## Status
COMPLETE

## Assertions covered
AS-369: PASS — verified against the hosted Supabase project (`.env` sourced): the F103 capability probe reports `capable=true` (562ms, 876ms across two local runs) and both `it` blocks in `tests/integration/reaction-realtime-delivery.test.ts` then run for real and pass (`AS-369: a real toggleReaction INSERT is delivered live...` in 536ms/569ms; `test_AS_369_the_subscription_is_scoped_at_the_transport_level...` also passed). I could not exercise the negative branch (stack reports `capable=false`, tests skip) locally without a Docker-backed `supabase start`, which this environment does not have — I only observed it indirectly, once, on 2026-09-04 before the migration reached the hosted project (see "Notes" below), where the probe correctly reported `capable=false` and both tests were reported as skipped (1 passed, 1 skipped — the second/warm test still ran and passed because the capability guard, correctly, only gates the first `it`).

## Files changed
supabase/migrations/20261030010000_f103_realtime_capability_probe_table.sql (new)
tests/helpers/replica-identity-delivery-probe.ts (new)
tests/integration/reaction-realtime-delivery.test.ts
.github/workflows/ci.yml
scripts/f102-replica-identity-probe.mjs (deleted)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint tests/helpers/replica-identity-delivery-probe.ts tests/integration/reaction-realtime-delivery.test.ts .github/workflows/ci.yml` (0, one pre-existing "file ignored" warning for the yml, no errors)
`npx supabase migration list --linked` (0) — confirmed every prior migration already applied remotely, only 20261030010000 pending
`npx supabase db push` (0) — applied the new probe-table migration to the hosted project
`set -a; source .env; set +a; npx vitest run tests/integration/reaction-realtime-delivery.test.ts --config vitest.realtime.config.ts` (0) — ran twice, both times 2 passed against the hosted project, capability probe reported capable=true both times
Did NOT run the full suite (per instructions).

## Decisions made

**Guard shape.** `tests/helpers/replica-identity-delivery-probe.ts` exports `probeReplicaIdentityFullDelivery()`, called once in `beforeAll`. It opens a *brand-new* client connection and subscribes to a permanent, tiny table (`public._realtime_capability_probe`, added by the new migration, kept in `REPLICA IDENTITY FULL` and in the `supabase_realtime` publication) — this is a first-ever postgres_changes subscription on a fresh connection against a FULL-identity table, an 8000ms ceiling (see rationale in the file). If it delivers, `canDeliverReplicaIdentityFull = true` and both `it` blocks run and assert exactly as before — nothing weakened. If not, each `it` calls Vitest's `ctx.skip(reason)`.

**Permanent probe table via migration, not dynamic DDL from the test.** The original `scripts/f102-replica-identity-probe.mjs` created/dropped scratch tables via `psql` in a CI step, outside the vitest process. A reusable-from-the-test probe needs DDL capability the JS test runner doesn't have (no `pg` driver in this repo, and adding one just for this felt like more risk than a 3-line migration). So the scratch tables became one small, permanent table, created once by `supabase/migrations/20261030010000_f103_realtime_capability_probe_table.sql`, RLS-enabled with no policies (service-role only, which is all the probe ever uses). Applied to the hosted project via `supabase db push` (also applies automatically to the local CI stack via `supabase start`'s migration replay, same as every other migration).

**Exit-code decision for the "cannot verify" branch: skip, not fail, not silent-pass.** When the stack can't deliver, the two `it` blocks call `ctx.skip(reason)` with the reason naming the replica-identity limitation and pointing at this handoff. Vitest reports these as **skipped**, a category distinct from both passed and failed, visible in every CI run's own summary line (`Tests  X passed | 2 skipped`). Trade, stated explicitly: this keeps the build green on a known environmental limitation instead of training the team to treat AS-369 red as noise — but it does NOT claim verification happened. A "2 skipped" line in the CI summary is the honest, auditable signal that this run did not check AS-369, and it is impossible to mistake for "2 passed" the way a silently-passing assertion would be. I rejected making the build fail red for this because CLAUDE.md's own framing plus the task brief's explicit "a red build for a known environmental limit trains people to ignore red" concern apply directly here, and I rejected silently passing because the task brief explicitly forbids it ("must not silently pass").

**Loud-if-it-disappears mechanism.** Rather than a separate alerting step, the guard's own `beforeAll` writes a distinct `[F103] capability probe: this stack DOES deliver...` stderr line, including the sentence "If this holds across CI runs going forward, the F103 skip branch in this file has outlived its reason and should be removed" every time it succeeds — which, per the "Also resolve" investigation below, is currently every hosted-project run I exercised, and per the historical CI log evidence, is NOT every CI-local-stack run (3 of 4 recent runs: incapable; 1 of 4: capable). The primary loud signal for "the limitation disappeared" is structural, not textual: once the local CLI stack reliably delivers, the skip branch stops firing on its own (the guard passes `capable=true` and both tests just run), so CI's summary line moves from `X passed | 2 skipped` to `X+2 passed | 0 skipped` — a visible, no-action-required change to the run's own numbers that a human glancing at CI history will notice. The stderr line is the accompanying pointer for *why* that number changed and what to go delete.

## Out-of-scope work needed

**The "REPLICA IDENTITY FULL never delivers" premise handed to me is not what the evidence actually shows, and the true root cause is still open.** I inspected the actual CI logs for run 33910074156 (the run cited as decisive) and three prior runs (33903580222, 33905606959, 33907896942) rather than reasoning about them, per the task's own instruction. Findings:

- In run 33910074156 itself — the same run whose F102 diagnostic step logged `[F102][REPLICA IDENTITY FULL] ... NOT received within 20000ms` — the REAL AS-369 test (also against `comment_reactions`, also REPLICA IDENTITY FULL) delivered its event in **515ms** and passed. `comment_reactions` unambiguously IS delivering postgres_changes on this exact stack, in this exact run, contradicting a "REPLICA IDENTITY FULL never delivers on this CLI image" framing taken literally.
- Across all four runs inspected, this file's SECOND `it` (`test_AS_369_the_subscription_is_scoped...`) — also against `comment_reactions` (FULL) — received its event in 254–905ms in every single run, including the three where the FIRST `it` timed out at 45s with no delivery at all.
- The one variable that differs between the two `it` blocks, consistently, across all four runs, is not replica identity (both are FULL) — it's that the first `it` is the first-ever postgres_changes subscription `subscriberClient` opens in the whole file (the `beforeAll` warmup channel has no postgres_changes binding), and the second `it` is a second, already-warm subscription on the same connection.
- F102's own experiment is confounded by the same variable: its script always probed the FULL scratch table first and the DEFAULT scratch table second, sequentially, on the *same* client — so "FULL fails, DEFAULT succeeds" in that script cannot distinguish "replica identity" from "subscription order" as the cause, because it never varied them independently.

Given this, I built the capability guard to reproduce AS-369's exact first-`it` condition (a fresh connection's first postgres_changes subscription against a REPLICA IDENTITY FULL table) rather than "REPLICA IDENTITY FULL" in isolation — this makes the guard's prediction valid regardless of which of the two variables (or both) turns out to be the true cause, but it does NOT resolve which one it is. A follow-up feature should run F102's original scratch-table experiment with the probe order swapped (DEFAULT first, FULL second) on the CI-local stack, to separate "replica identity" from "subscription order" for good; if DEFAULT-first also fails while FULL-second succeeds, replica identity is fully exonerated and the real, more valuable fix is warming up the FIRST postgres_changes subscription of every affected test file (a pattern likely to recur elsewhere), not anything specific to `comment_reactions`.

**"Also resolve" — does the second (scoping) test pass vacuously?** No, checked against actual CI logs, not reasoned about: in every run inspected (including all three where the first test timed out with zero delivery), the second test's own scoped channel received a genuine, correctly-shaped event in under a second, and the differently-scoped `leaked` channel genuinely received nothing. Both halves of that assertion are real, repeated, positive results against the same REPLICA IDENTITY FULL table in the same run — not "everything received nothing." I did not add a capability-guard skip to this test; doing so would suppress a test that reliably, verifiably passes for the right reason. This is explained inline in the test file at the top of that `it` block.

## Blockers

(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: Chose a permanent migration-created probe table over dynamic DDL from the test process (no `pg` driver in this repo; adding one for a single capability check was more surface area than a 3-line, RLS-locked-down migration).

AUTONOMOUS_DECISION: Chose Vitest's `ctx.skip(reason)` (test-level, not `describe.skip`) so only the assertion(s) that actually can't be verified are marked skipped, keeping the exact same file/describe structure and letting the second, unaffected test still run and count as a real pass even when the first is skipped.

AUTONOMOUS_DECISION: Did not add the capability-guard skip to the second (`test_AS_369_the_subscription_is_scoped...`) test, per the "Also resolve" finding above that it is not affected and is not vacuous — skipping it would have removed real, working coverage.

AUTONOMOUS_DECISION: Kept `PROBE_CEILING_MS = 8000` for the guard (vs. F102's old 20000ms) — F096's own hosted-project measurements (464–671ms) and this session's own measurements (562ms, 876ms) are the working baseline; 8s is ~12x that with headroom for CI contention, while not being the slowest thing in the CI job the way the old 20s diagnostic was.

## Notes for the next worker

- The migration `supabase/migrations/20261030010000_f103_realtime_capability_probe_table.sql` has been applied to the hosted project via `supabase db push` (run in this session) and will apply automatically to any local `supabase start` stack (CI included) via normal migration replay. No manual step needed.
- I could not exercise the guard's negative branch (stack reports incapable, tests skip) end-to-end locally, because that requires Docker and a `supabase start` local stack, which this environment does not have. Before applying the migration to the hosted project, I ran the same test once against the (then-unmigrated) hosted project and confirmed the probe correctly reported `capable=false` and the first test was skipped while the second still ran and passed — this is indirect evidence the skip path itself works, from the missing-table condition rather than the true local-CLI condition, but it is the closest I could get to a negative-branch exercise without Docker.
- Both cleanup items from the brief are done: the F099 publication-state diagnostic step and the F102 replica-identity scratch-table diagnostic step are removed from `.github/workflows/ci.yml`; `scripts/f102-replica-identity-probe.mjs` is deleted, its probe logic now living (reduced and reusable) in `tests/helpers/replica-identity-delivery-probe.ts`.
- `filter: task_id=eq.<id>`, the `beforeAll` warm-up, the serial `npm run test:realtime` split, the elapsed-time logging, and F098's channel cleanup are all unchanged.
- No MCP tools were used — this session's tools list did not expose a Supabase MCP server for this repo/session; migration application went through `npx supabase db push` per the CLI conventions already established elsewhere in the repo (e.g. `missions/20260817-230717/connections/mcp-registry.md`'s "Primary path for schema changes is the Supabase CLI").
