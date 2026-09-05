# Handoff: F117 — Close the create_channel_atomic authorisation hole (F116 out-of-scope item 2) + align create/browse authz (item 3)

## Status
COMPLETE

## Assertions covered
This is a standalone hardening task (same as F116), not tied to
`missions/20260903-portal/validation-contract.md` AS-NNN ids. Behaviours
verified with real signed-in sessions against PostgREST / real Server
Action calls (`tests/integration/f117-chat-security-hardening.test.ts`,
4/4 passing):

- An ordinary signed-in user calling `create_channel_atomic` directly over
  PostgREST with a fabricated member list is rejected — PASS (already true
  on the current schema before this task's own code change; see
  "Decisions made" below for why)
- A client (self-enrollable participant as of F116) cannot self-enroll
  into an arbitrary channel via a direct `create_channel_atomic` call —
  PASS (same pre-existing protection)
- An active workspace owner who is not an explicit `project_members` row
  cannot create that project's channel via `createChannel` — PASS (failed
  before this task's code change, confirmed by reverting the fix and
  re-running — see Commands run)
- An explicit `project_members` row can still create the project's
  channel via `createChannel` — PASS
- Regression: `tests/integration/f006i-create-channel-atomic-authz.test.ts`
  (6/6) and `tests/integration/f116-client-chat-channel-rls.test.ts` +
  `f116-portal-chat-wiring.test.ts` (15/15 + 2/2) still pass unchanged.

## Files changed
lib/actions/chat-channels.ts
tests/integration/f117-chat-security-hardening.test.ts
missions/20260903-portal/handoffs/F117-handoff.md

## Commands run
`grep -rn "create_channel_atomic" .` (0) — established every call site and every migration that touched the function, in order, before changing anything
`set -a; source .env; set +a; npx vitest run tests/integration/f006i-create-channel-atomic-authz.test.ts` (0) — 6/6 passed on the CURRENT (unmodified) schema
`git stash push -- lib/actions/chat-channels.ts` (0) — reverted item 3's code change to prove the new test fails first
`set -a; source .env; set +a; npx vitest run tests/integration/f117-chat-security-hardening.test.ts` (1) — 2/4 failed pre-fix: the owner-without-project-membership test failed (`expected true to be false`, i.e. creation SUCCEEDED when it should not have), and the positive-control test failed on a knock-on `23505 duplicate key` from the first test's channel having already been created — both are the expected pre-fix failure signature
`git stash pop` (0) — restored the fix
`set -a; source .env; set +a; npx vitest run tests/integration/f117-chat-security-hardening.test.ts tests/integration/f006i-create-channel-atomic-authz.test.ts tests/integration/f116-client-chat-channel-rls.test.ts tests/integration/f116-portal-chat-wiring.test.ts` (0) — 27/27 passed after the fix
`npx tsc --noEmit` (0)
`npm run build` (0) — no new/removed routes, `createChannel` has no UI caller yet (confirmed by repo-wide grep, unchanged from F116's own finding)
`npx vitest run tests/unit/server-client-boundary-imports.test.ts` (0)
`set -a; source .env; set +a; npm run migrations:check` (0) — "No migration drift — all migrations present on remote." (no new migration in this task — no schema change was needed, see Decisions made)
`npm run db:apply` — NOT RUN, no migration file was written (nothing to apply)
`npm run db:gen-types` — NOT RUN, no schema change (types file unaffected)
`curl` against a running local dev server (`/dev-login?email=nina@demo.test`, `/w/acme-studio/chat`, `/portal/acme-studio/p/<Website Redesign id>/conversation`) — all 200, team chat still lists "Website Redesign", portal conversation still renders "staging link works great"

## Decisions made

**Item 2 investigated first, before writing any code.** Grepped every
migration that has ever redefined `create_channel_atomic`, in chronological
order: `20260905090000` (original, no auth.uid() check) →
`20260910010000` (nullable args, still no check) → `20260914010000`
(pg_temp pinning only, still no check) → **`20260918010000_f006i_authz_
round_2.sql`** (adds a full internal check, gated on `auth.uid() is not
null`: `p_created_by` must equal the caller, the caller must be an active
**non-client** member of `p_workspace_id`, and every id in `p_member_ids`
must be an active member of that workspace). No later migration touches
the function. `20260918010000` predates F116 (`20261103010000`) by six
weeks. `tests/integration/f006i-create-channel-atomic-authz.test.ts`
already exercises exactly this — including a client-role rejection case —
and passes 6/6 on the schema as it stands today, unmodified.

**Conclusion: the hole F116's handoff described (item 2) is already
closed and was stale by the time that handoff was written.** The
`authenticated` grant is still present, but the function's own body now
independently re-derives and checks caller identity, role, and per-member
workspace membership whenever `auth.uid()` is not null — the "caller check
inside the function" branch this task's own prompt offered as the
alternative to revoking the grant, already implemented. The only
legitimate caller that needs the grant unaffected is `lib/actions/
chat-channels.ts`'s `createChannel`, which always calls via
`createAdminClient()` (service-role, `auth.uid()` is null for that JWT),
so the internal checks are skipped for it exactly as designed — confirmed
by reading `chat-channels.ts:75, 143-153` and by the "side-effect
verification" test in the F006i suite passing. **I did not revoke the
`authenticated` grant** because doing so would not close any additional
gap (the body-level checks already make a direct `authenticated` call as
safe as the `createChannel` Server Action's own checks) and revoking it
would remove a defence-in-depth layer for zero net security gain, for no
documented legitimate caller change. I did not add a new check either,
since none was missing. I wrote a fresh, explicitly-worded regression
test (`f117-chat-security-hardening.test.ts`) matching this task's own
prompt language ("an ordinary signed-in user ... with a fabricated member
list") plus the new client-specific scenario F116 raised (a client
self-enrolling), both of which pass against the current, unmodified
function — evidence that the claim in F116's out-of-scope item 2 no
longer describes a real gap, not evidence that I fixed something.

**Item 3: aligned `createChannel`'s project-scoped check with F116's
browse rule.** `isProjectVisibleToCaller` (the general read-access rule
used by essentially every other project-scoped Server Action — tasks,
comments, attachments, time entries, etc., confirmed by grep, ~15 call
sites) admits any active member of a `'workspace'`-visibility project, or
any owner/admin unconditionally, in addition to an explicit
`project_members` row. F116's `channels_select_members_or_workspace` RLS
policy and `channel_members_insert_self_or_existing_member` policy
(`supabase/migrations/20261103010000_f116_client_channel_access.sql`)
deliberately narrowed browse/self-add for project channels to **explicit
`project_members` only, with no workspace-visibility or owner/admin
bypass** — the migration's own comment explains why: a client's project
channel must never be reachable by a workspace member who merely has
read-access to the project. `createChannel`'s INSERT check was the one
path left using the broader rule. Fixed by replacing the
`isProjectVisibleToCaller` call in `createChannel` (project-scoped branch
only — the workspace-wide, non-project-scoped branch is untouched) with a
direct `project_members` row check, matching the SELECT/self-add policies
exactly, including removing the owner/admin bypass (verified: an owner
without an explicit `project_members` row can no longer create the
project's channel). I deliberately did NOT touch `isProjectVisibleToCaller`
itself or any of its other ~15 call sites — the task's own framing ("worth
aligning... for the SAME feature") and this feature's own scope both point
at `createChannel` specifically, and changing the shared helper's semantics
would ripple into tasks/comments/attachments/etc., which is out of scope
and not what item 3 asked for.

**No migration was needed for either item.** Item 2 required no schema
change (the existing 20260918010000 check already suffices). Item 3 is
pure application-code authorisation (a `project_members` lookup already
exposed by RLS to any authenticated caller reading their own row set,
performed here on the ADMIN client the same way `isProjectVisibleToCaller`
already did), so no RLS or function change was needed either.

## Out-of-scope work needed

None beyond what F116's own handoff already listed (items 1, 4, 5 — not
touched here per this task's explicit "Not in scope" instruction).

One thing worth flagging for a future worker: `create_channel_atomic`'s
internal check requires the caller be an active **non-client** member of
the *workspace* for ANY channel (including project-scoped ones), but does
not itself check *project* membership the way `createChannel`'s app-layer
check now does (item 3's fix). This is fine today because the RPC's only
`authenticated`-reachable legitimate path is a direct call bypassing
`createChannel` entirely (which this task's own tests prove is already
blocked for outsiders/clients at the workspace level), and `createChannel`
itself re-verifies project membership before ever calling the RPC. But if
a future feature adds a second Server Action that calls
`create_channel_atomic` directly for project-scoped channels without
re-deriving project membership itself first, the RPC's own workspace-level
check would not catch a non-project-member workspace member. Worth adding
a `p_project_id`-aware `project_members` check inside the RPC itself in a
future pass if a second caller appears, so the guarantee doesn't rely on
every future caller remembering to re-check it themselves (same "not just
the caller" principle the earlier F006/F082 audits established).

## Blockers

(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: Treated this as a standalone task outside the
mission's per-feature `/mission-tasks` clarification loop, same as F116
(no `features/F117-*.md` or `clarifications/F117-clarification.md` exists
— this task's own prompt is the spec).

AUTONOMOUS_DECISION: Chose NOT to revoke `create_channel_atomic`'s
`authenticated` grant, and explained why in "Decisions made" above rather
than silently doing the more dramatic thing the task's framing initially
suggested — the evidence (a prior, already-landed migration) pointed at
"nothing to fix here," not "fix conservatively." Per the task's own rule
("Do not justify a decision by claiming a precedent unless a grep proves
it and you can name the file and line"), the precedent is
`supabase/migrations/20260918010000_f006i_authz_round_2.sql`, lines
264–328 (function body + grants).

AUTONOMOUS_DECISION: For item 3, chose to remove the owner/admin bypass
entirely for project-scoped channel creation (full parity with browse's
`project_members`-only rule) rather than keeping an owner/admin exception.
Rationale: F116's own SELECT/self-add policies made no such exception, and
an owner/admin who creates a channel without being able to browse it
afterward (until they explicitly add themselves as a `project_members`
row) would be a worse inconsistency than the one being fixed.

## Notes for the next worker

- The claim in F116's handoff (out-of-scope item 2) that
  `create_channel_atomic` was still "bypassing createChannel's own
  app-layer checks entirely" was incorrect as of the time it was written —
  it predates a hardening migration by six weeks. If a similar claim shows
  up again for some other function, grep the function's full migration
  history (not just the latest `create or replace`) before trusting a
  handoff's characterization of "still granted to authenticated" as
  synonymous with "still unguarded" — grants and internal checks are
  independent axes.
- MCP: no MCP registry entry was consulted (same rationale as F116 — this
  is a direct ad-hoc task outside `/mission-run`). All Supabase
  verification went through real signed-in sessions via `@supabase/
  supabase-js` against the live project (`.env`-sourced credentials),
  `npm run migrations:check`, and manual `curl` against a running local
  dev server, per the task's own explicit instructions.
