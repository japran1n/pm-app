# F046: FU-4 — establish the real cause of the integration test failures

**Milestone:** M1 — Foundation (follow-up)
**Estimated worker time:** 40 minutes
**Depends on:** F001

## Assertion IDs covered
(none directly — this is a toolchain-integrity investigation the M1 scrutiny
report made a blocking condition for the milestone gate, not a product
assertion)

## Clarified implementation
Inherited from F001's clarification (missions/20260917-170249/clarifications/F001-clarification.md).

## Follow-up scope (from M1-scrutiny.md)

Every worker in F001–F004 asserted the 173 failing `tests/integration/**`
tests are a pre-existing sandbox network limitation. The scrutiny validator
measured that this is false in this environment: `curl https://example.com`
returns 200, `curl $NEXT_PUBLIC_SUPABASE_URL/rest/v1/` and an equivalent
plain `node fetch()` both return 401 (host reachable, auth required — not a
network failure). It also found a deterministic, tree-correlated A/B:
checking out the pre-mission commit vs. the F001 commit (same `.env`, same
shared `node_modules`) flips a representative integration test between
green and red, twice each direction — but reverting `package.json` alone, or
`package-lock.json` alone, at the F001 tree does NOT restore green, and
adding only F001's new test file to the baseline tree does NOT turn it red.
The validator could not isolate a mechanism and flagged this
INCONCLUSIVE-but-serious, explicitly noting the shared `node_modules`/Vite
dep-optimization cache across worktrees is an uneliminated confound.

Your job: determine the real cause, with clean isolation (a fresh
`node_modules` per arm, not a shared one — `npm ci` in each worktree rather
than reusing one), and produce a true, reproducible baseline. Candidate
causes worth checking first, in order of likelihood:
1. Vite/vitest's dependency-optimization cache being keyed on `package.json`
   content, producing stale/mismatched pre-bundled deps across the two
   checkouts sharing one cache — test with `--force` or a cleared
   `node_modules/.vite` per arm.
2. Whether `tests/integration/**` is actually designed to run against a
   local ephemeral Supabase stack (`supabase start`) rather than the hosted
   project referenced in `.env` — check `.github/workflows/ci.yml` for how
   CI actually runs this suite, since that may reveal these tests were never
   expected to pass against `$NEXT_PUBLIC_SUPABASE_URL` outside CI's own
   setup step.
3. Whether `npm install node-html-parser` silently changed the resolved
   version of some shared transitive dependency (compare
   `package-lock.json` diffs beyond just the new package) in a way that
   affects the Supabase client or fetch polyfill.

Produce a documented, reproducible finding — either "these tests require
`supabase start` locally and were never expected to pass here, unrelated to
this mission" (if #2 confirms) or the actual mechanism if #1 or #3 is the
cause. If a real regression from `node-html-parser`/lockfile changes is
found, fix it. If the tests genuinely require local infrastructure this
sandbox doesn't have, document that clearly in `run-log.md` and this
feature's handoff so no future worker asserts an unverified excuse again.

## Definition of done
- A clean-isolation (non-shared node_modules) re-run of the A/B either
  confirms or overturns the tree-correlation the validator observed.
- The actual mechanism is identified and documented, OR it is conclusively
  established (via `.github/workflows/ci.yml` or equivalent) that this suite
  requires local infrastructure not present in this environment and was
  never expected to pass here — in which case that documented finding
  becomes the standing, citable explanation for all future workers in this
  mission.
- If a real regression is found, it is fixed and verified.
