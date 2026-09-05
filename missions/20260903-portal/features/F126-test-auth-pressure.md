# F126: The test suite creates and signs in a user per file, and hits
Supabase's auth rate limit

**Milestone:** post-portal — **infrastructure**
**Estimated worker time:** 4 h (bounded — see "Scope discipline")
**Assertions:** AS-089, AS-090, AS-091
**Opened by:** repeated "Request rate limit reached" failures that have
blocked every attempt at a clean full-suite run in this mission

## Evidence

- **240** integration test files call `admin.auth.admin.createUser`
- **167** call `signInWithPassword`

That is 400+ auth operations per full run, in a few minutes, against
one Supabase project. Three separate workers in this mission hit
"Request rate limit reached" and none could produce a clean full-suite
run. `vitest.config.ts`'s own comments already document this class of
failure (F278, F312).

Each file defines its own local `makeUser` / `signIn` pair — the pattern
is duplicated ~240 times (see `tests/integration/f116-task-types.test.ts`
lines ~73–92 for a representative copy).

This is also why the shared database now holds ~2,500 workspaces and
~37,000 profiles: files clean up in `afterAll`, but a failed or
timed-out run never reaches it.

**Measured context:** a Supabase call from this machine costs ~130–180 ms.
Sign-ins alone are roughly 25 seconds of every full run, before any
rate limiting.

## The approach

A pool of identities created **once** per run, signed in **once**, with
sessions reused across files — instead of a fresh user per file.

**The correctness constraint that makes this non-trivial:** tests need
users in specific roles (owner, admin, member, viewer, guest, client).
A pooled user must therefore be added to each test's own workspace with
whatever role that test needs. That is legitimate — a user belongs to
many workspaces in normal use — but it means:

- A pooled identity will be a member of many workspaces at once. Any
  test that assumes "this user has exactly one workspace", or asserts
  on a workspace *list*, will break and must keep its own dedicated
  user rather than being forced onto the pool.
- Tests asserting on a user's global state (profile, notification
  counts across workspaces) are in the same category.

Identifying those honestly is the core of this work. **Do not migrate a
file you are not sure about** — leaving a file on its own user is a
correct outcome, not a failure.

## Scope discipline — read this before starting

Do **not** attempt all 240 files. Build the shared helper, migrate a
substantial and representative subset, prove the reduction with real
numbers, and leave the rest for a follow-up. A half-migrated suite that
passes is worth far more than a fully-migrated one that is subtly
broken.

1. Create a shared helper (e.g. `tests/helpers/auth.ts`) providing
   pooled identities per role and a session cache keyed by identity, so
   repeated sign-ins of the same identity reuse one session.
2. Migrate a meaningful subset — prioritise the files that run most
   often and the heaviest offenders. State exactly which files you
   migrated and which you deliberately did not, and why.
3. **Preserve cleanup (AS-091).** Pooled identities must NOT be deleted
   by an individual file's `afterAll`; per-test workspaces and rows
   still must be. Getting this backwards would either break other files
   mid-run or leave more junk behind.
4. Measure: count auth operations (or run time) for the migrated subset
   before and after, and put the numbers in the handoff.

## Out of scope

- Migrating to a local Supabase (Docker) — the user has explicitly
  ruled this out. Everything stays on the hosted project.
- Cleaning the ~2,500 existing junk workspaces — a separate decision the
  user has not yet made.
- Changing `vitest.config.ts`'s parallelism or timeouts to mask the
  problem. Fix the cause, not the symptom.
- Application code. This feature touches `tests/` only.

## Definition of done

- AS-089 shown with real numbers for the migrated subset.
- AS-090: every migrated file passes with its assertions unchanged. If
  a file needs an assertion altered to pass, do not migrate it —
  migrating it would be changing what the test proves.
- AS-091: verify cleanup still runs, including on a deliberately failed
  test.
- The handoff lists what was migrated, what was left, and why — and
  states plainly whether the remaining files are a mechanical follow-up
  or need judgement.
