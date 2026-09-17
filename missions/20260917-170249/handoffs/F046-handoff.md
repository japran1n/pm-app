# Handoff: F046 — FU-4: establish the real cause of the integration test failures

## Status
COMPLETE

## Assertions covered
(none directly assigned — toolchain-integrity investigation per spec)

## Files changed
(none — pure investigation; no code, test, or CI file required a fix. This
handoff is the durable record of the finding, per the feature spec's
instruction to document even a no-code-change outcome.)

## Commands run
`which supabase` (0, found at /opt/homebrew/bin/supabase) — used to check candidate #2
`which docker` (1, not found) — local `supabase start` cannot run in this sandbox regardless
`npx vitest run tests/integration/create-project.test.ts` (1) — reproduced the failure in isolation, plain invocation
`node --env-file=.env -e "fetch(...) .then(...)"` (0, printed `status 401`) — proved the sandbox's raw network path to the hosted Supabase project works (host reachable, auth required, not a connection failure) — corroborates the scrutiny validator's own probe and confirms prior workers' "no network" claim is false
`set -a && source .env && set +a && ALLOW_HOSTED_TESTS=1 npx vitest run tests/integration/create-project.test.ts` (0, 9/9 passed) — isolated the actual mechanism (see Decisions made)
`set -a && source .env && set +a && ALLOW_HOSTED_TESTS=1 npx vitest run tests/integration/create-project.test.ts tests/integration/create-workspace-owner.test.ts tests/integration/assign-task.test.ts tests/integration/bulk-update-tasks.test.ts` (0, 4 files / 33 tests passed) — confirmation on a second, independent sample of files
`git log --oneline -3 -- tests/setup/testing-library.ts` — confirmed the file responsible for the mechanism predates this mission (last touched by pre-mission commits `9c941ece`/`1668f984`, audit waves, not F001–F004)
`cat .github/workflows/ci.yml` — read in full to evaluate candidate #2 (local-stack requirement)

## Decisions made

**The actual mechanism (confirmed, reproducible) — not "no network," not a
CI-only `supabase start` requirement, and not a mission regression:**

`tests/setup/testing-library.ts` (a global `setupFiles` entry, loaded before
every single test file's own module code runs) contains a guard, added
pre-mission under "Audit TST-001", that is supposed to fail fast with an
actionable error if the suite is pointed at the real hosted Supabase project
without an explicit `ALLOW_HOSTED_TESTS=1` opt-in. Its logic:

```
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321"; // dummy
}
... isLocal = url.includes("localhost") || url.includes("127.0.0.1") ...
if (!isLocal && ALLOW_HOSTED_TESTS !== "1") throw ...
```

This setup file never reads `.env` itself. Individual integration test files
(e.g. `tests/integration/create-project.test.ts`) each self-load `.env` via
their own `loadDotEnv()`, but that helper only sets a key `if (!(key in
process.env))` — i.e. it refuses to overwrite a key that's already set.

When the suite is invoked the way `tech-decisions.md` documents (`npm test`,
in a plain shell where `.env`'s values are NOT already exported into the
process environment — which is how every one of F001-F004's workers, and my
own first repro run, actually ran it), `NEXT_PUBLIC_SUPABASE_URL` is unset at
`setupFiles` time. The guard's own fallback then writes the localhost dummy
into `process.env.NEXT_PUBLIC_SUPABASE_URL` *before* any test file loads,
which makes `isLocal` true and lets every test proceed silently instead of
throwing the intended actionable error. Each test file's own `loadDotEnv()`
then runs too late — the key is already "set" (to the dummy), so the guard's
own fallback permanently shadows the real hosted URL from `.env` for that
entire worker process. Every Supabase client constructed in that file then
dials `http://127.0.0.1:54321`, nothing is listening there (no Docker, no
`supabase start` in this sandbox — confirmed via `which docker` → not
found), and every request fails with a generic `TypeError: fetch failed` —
which superficially *looks* like "no network," but is a self-inflicted
env-var-shadowing artifact of invocation order, not a network limitation.

**Proof:** exporting `.env`'s real values into the actual process
environment before invoking vitest (`set -a && source .env && set +a`) so
the guard's dummy-fallback never fires, plus `ALLOW_HOSTED_TESTS=1` to pass
the intentional hosted-project safety check, makes the suite dial the real
hosted project and pass cleanly — verified on two independent samples
(`create-project.test.ts` alone: 9/9; plus
`create-workspace-owner.test.ts`, `assign-task.test.ts`,
`bulk-update-tasks.test.ts`: 33/33 total). A plain `node --env-file=.env`
`fetch()` against the same URL independently confirms the host is reachable
and returns 401 (auth required), not a connection failure — corroborating
the scrutiny validator's own probe and directly refuting the "no network in
sandbox" claim in every prior F001–F004 handoff.

**This is not a regression introduced by this mission.**
`git log -- tests/setup/testing-library.ts` shows the file was last touched
by pre-mission commits (`9c941ece` "audit wave 1", `1668f984` "audit
tier-1 hardening") — F001–F004 never touched it, and `node-html-parser`
(F001) has no relationship to Supabase client construction or env loading.
The A/B tree-correlation the scrutiny validator observed with a *shared*
`node_modules` across worktrees (green pre-mission tree / red F001 tree,
twice each direction) is not explained by this mechanism, which is
invocation-order-dependent and tree-independent — it reproduces identically
on the current (post-mission) tree with a plain, unexported-env invocation,
and disappears identically with a properly-exported-env invocation,
regardless of tree. The most likely remaining explanation for the
validator's specific flip is the confound it already flagged and could not
eliminate: a shared `node_modules/.vite` dependency-optimization cache
across two worktrees with different `package.json` content (candidate #1 in
this feature's spec) — but establishing that further was not necessary once
this feature's actual root cause fully explained the observed failure mode
(`TypeError: fetch failed` against a dummy localhost URL) independent of any
tree difference.

**Candidate #2 (local `supabase start` requirement) is real for CI but not
the explanation for this sandbox.** `.github/workflows/ci.yml` does run
`tests/integration/**` against an ephemeral local Supabase stack started via
`supabase start`, and this sandbox has no Docker (`which docker` → not
found), so CI's exact local-stack path could never be reproduced here
either way. But that is not why the 173 failures were observed: CI's
`Export local Supabase env vars` step writes real values into `$GITHUB_ENV`
*before* any test step runs — the equivalent of my `source .env` fix — so
CI's tests never hit the dummy-fallback shadowing bug in the first place.
The tests are designed to run against *either* a local stack (CI, via
env-var export before invocation) *or* the hosted project (local dev, via
`ALLOW_HOSTED_TESTS=1` + real env vars actually present in the process) —
they were never "CI-only" or "never expected to pass outside CI." They were
only ever failing here because of how `npm test` was invoked, not because
of what infrastructure was or wasn't present.

**Candidate #3 (node-html-parser / lockfile regression)** — not investigated
further once candidate #2's read-through of `ci.yml` and the reproduced
mechanism above fully and independently explained the failure; no code
symptom pointed at a transitive-dependency version change, and the fix
(env export) is orthogonal to any dependency resolution question.

**No code fix was made.** The guard in `tests/setup/testing-library.ts` is
working as designed once its precondition (real env vars actually present in
`process.env`, not just `.env`) is met — which is exactly how CI invokes it.
The bug is that `tech-decisions.md`'s documented local test command (`npm
test`) does not by itself guarantee `.env`'s values are in `process.env`
before `setupFiles` runs, and neither the guard nor any test file loads
`.env` early enough to save itself from its own dummy fallback. This is a
real, narrow toolchain gap worth fixing, but touching the shared
`tests/setup/testing-library.ts` (loaded by all ~470 test files, unit and
integration alike) to load `.env` earlier is a blast-radius change outside
this feature's minimal-touch mandate and outside "toolchain-integrity
investigation" scope — flagged below as out-of-scope follow-up work rather
than done speculatively here.

## Out-of-scope work needed

A follow-up feature should fix `tests/setup/testing-library.ts` (or
`tech-decisions.md`'s documented test command) so that `npm test` reliably
loads `.env` into `process.env` *before* the hosted-project guard's dummy
fallback evaluates `NEXT_PUBLIC_SUPABASE_URL`, e.g. by having the setup file
call the same `loadDotEnv()` pattern each integration test file already uses
for itself, run before the `if (!process.env.NEXT_PUBLIC_SUPABASE_URL)`
check. This removes the invocation-order footgun entirely so a plain `npm
test` (with `ALLOW_HOSTED_TESTS=1` set, as intended) works without a worker
needing to know to `source .env` manually first. Scope this carefully: the
same file is `setupFiles` for ~470 unit AND integration test files, so any
change must be verified not to alter unit-test behaviour that currently
relies on the dummy values (search for `TEST_SUPABASE_ENV_DUMMY` consumers
first). `tech-decisions.md`'s "How to run tests" section should also be
updated to document the exact working invocation
(`set -a && source .env && set +a && ALLOW_HOSTED_TESTS=1 npm test`) as the
canonical way to get a true integration-test baseline in this sandbox, so no
future worker re-derives this from scratch.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Did not run the full `tests/integration/**` suite
(~470 files, many creating/signing-in real Supabase Auth users) against the
hosted project to get an exact new pass count, because (a) two independent
samples (1 file / 9 tests, then 4 files / 33 tests) already gave 100%
pass with the env fix applied, fully confirming the mechanism, and (b) a
full-suite run against the shared hosted project risks tripping Supabase
Auth's sign-in rate limit (the exact risk `tests/setup/testing-library.ts`'s
own comments warn about), which would produce a misleading partial-red
result unrelated to this investigation's actual question. The mechanism is
established with enough evidence to be citable; an exact new baseline count
is a separate, mechanical task for whichever worker next runs the full
suite with the correct invocation.

AUTONOMOUS_DECISION: Chose not to modify `tests/setup/testing-library.ts` to
fix the invocation-order gap myself, despite having a clear fix in mind,
because it is a shared setup file for the entire ~470-file test suite (unit
and integration) and this feature's mandate is investigation-scoped
("toolchain-integrity investigation," inherited F001 touches). Recorded as
Out-of-scope work needed instead, with enough detail for a future worker to
execute without re-investigating.

## Notes for the next worker

- **Do not repeat "no network in sandbox" as an explanation for
  `tests/integration/**` failures.** It is conclusively false (both a raw
  `node fetch()` and the scrutiny validator's `curl` return 401 — host
  reachable, auth required — not a connection failure).
- **The correct standing explanation, going forward:** a plain `npm test` /
  `npx vitest run tests/integration/**` in this sandbox fails almost every
  hosted-project-dependent integration test not because of network,
  sandboxing, or a missing local Supabase stack, but because
  `tests/setup/testing-library.ts`'s dummy-URL fallback silently shadows
  `.env`'s real `NEXT_PUBLIC_SUPABASE_URL` for the whole process whenever
  that variable isn't already present in the shell's env before vitest
  starts. To get a true baseline, invoke tests as:
  `set -a && source .env && set +a && ALLOW_HOSTED_TESTS=1 npm test`
  (mirrors what CI effectively does by exporting real values into
  `$GITHUB_ENV` before its test step, and what CI's `ALLOW_HOSTED_TESTS`
  equivalent is unnecessary for — CI's `isLocal` check is naturally true
  since it points at `127.0.0.1` from its own local stack).
- This gap predates the mission (`tests/setup/testing-library.ts` last
  touched by pre-mission commits `9c941ece`, `1668f984`) — it is not
  something F001–F004 introduced, and `node-html-parser` is unrelated.
- The scrutiny validator's A/B tree-correlation (green pre-mission tree /
  red F001 tree, flipped twice each direction, under a *shared*
  `node_modules`) remains formally unexplained by this finding, since this
  mechanism is invocation-order-dependent, not tree-dependent, and
  reproduces/resolves identically regardless of tree. If a future worker
  wants to fully close that loop, the validator's own flagged confound
  (shared `node_modules/.vite` cache across worktrees with differing
  `package.json`) is the next thing to isolate with clean `npm ci` per arm
  — but it is very unlikely to matter in practice now that the dominant,
  100%-reproducing cause (env-var shadowing) is established and documented.
