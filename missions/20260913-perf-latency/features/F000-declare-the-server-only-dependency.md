# F000: Declare the `server-only` dependency

**Milestone:** M0 — Make the gate trustworthy

**Est:** 30 min · **Depends on:** none
**Covers:** AS-023
- `lib/queries/chat.ts` imports `server-only`, which appears in neither
  `package.json` nor the lockfile. Next's bundler resolves it; vitest does not,
  so every test whose import graph reaches that file dies before it runs —
  including `tests/unit/sign-out-back-navigation.test.ts`, which guards the
  workspace layout that M1 and M4 rewrite
- Add it as a dependency at its current published version and install
- `server-only` throws by design when a client component imports it. If adding
  it surfaces failures in files that were green, that is a real pre-existing
  layering violation: **report it in the handoff, do not fix it** — it is not
  this mission's scope and the orchestrator decides what happens to it
- Remove from `tools/known-failing.txt` any file that now passes
**Files:** `package.json`, `package-lock.json`, `missions/20260913-perf-latency/tools/known-failing.txt`

## Clarification status

`[CLARIFIED-AUTO]` — the missing package is a fact of the lockfile, and the
fix is to declare what the code already imports. No open question.

## Why this is in a latency mission at all

It is not a latency change. It is here because without it this mission cannot
verify its own work: the test that guards the workspace layout — the single
file M1 and M4 change most — cannot load. A gate that cannot see the file you
are editing is not a gate.

## Notes for the worker

- Read `missions/20260913-perf-latency/tech-decisions.md`, section "The suite is red before this mission
  starts".
- Do **not** start a dev server. Port 3000 belongs to the user, who is using
  the app while you work.
- Do **not** fix any other failing test. If your change surfaces new failures,
  list them in `## Out-of-scope work needed` and set Status to COMPLETE if the
  gate passes, PARTIAL if it does not.
- Verify with `missions/20260913-perf-latency/tools/test-gate.sh`.
- Commit as `feat(F000): <summary> [assertions: AS-023]` before exiting.
