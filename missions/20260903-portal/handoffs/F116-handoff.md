# Handoff: F116 — Connect the existing chat to the client portal (docs/client-portal-phase-2-plan.md item A)

## Status
COMPLETE

## Assertions covered
This feature was assigned directly (not through the mission's own numbered
`validation-contract.md` — it is the final item of a follow-up plan doc, run
outside the per-feature clarification loop). No AS-NNN ids were pre-assigned
to it. The behaviours it had to make true, each verified with a real
signed-in session against PostgREST (`tests/integration/
f116-client-chat-channel-rls.test.ts`, 15/15 passing) or a real Server
Action call (`tests/integration/f116-portal-chat-wiring.test.ts`, 2/2
passing):

- A client cannot SELECT another project's channel by id — PASS
- A client cannot self-add into another project's channel by guessing its id — PASS
- A client cannot read messages posted in another project's channel — PASS
- A client's own channel list never contains another project's channel or the workspace-wide channel — PASS
- A client cannot SELECT or self-add into the workspace-wide (internal team) channel — PASS
- A `viewer` who is not an explicit project member cannot browse or self-join a client's project channel, even though the project is workspace-visible — PASS
- A client who is an explicit member of their own project channel can SELECT it, post to it, and a project team member sees that message — PASS
- A client can see their own channel's member roster (their actual project team), and it never includes the other project's client or the pure workspace viewer — PASS
- A client cannot edit a staff member's message; editing their own remains allowed at the RLS/action layer (unchanged, verified) — PASS
- `ensure_project_channel_atomic` is idempotent (two calls, one channel, no duplicate membership) — PASS
- `ensure_project_channel_atomic` is not callable by an ordinary authenticated session (service_role only) — PASS
- `setPortalEnabled(true)` (real Server Action) creates the project's channel and enrolls its current team — PASS
- `activateInvitedMemberships` (real Server Action) backfills a newly-accepted client onto an already-existing channel — PASS

## Files changed
supabase/migrations/20261103010000_f116_client_channel_access.sql
lib/actions/chat-channels.ts
lib/actions/invites.ts
lib/actions/portal-settings.ts
app/(portal)/portal/[workspaceSlug]/p/[projectId]/conversation/page.tsx
components/portal/portal-sidebar.tsx
components/portal/portal-sidebar.test.tsx
scripts/seed-demo.mjs
lib/supabase/database.types.ts (regenerated, `npm run db:gen-types`)
tests/integration/f116-client-chat-channel-rls.test.ts
tests/integration/f116-portal-chat-wiring.test.ts

## Commands run
`npx vitest run tests/integration/f116-client-chat-channel-rls.test.ts` — run BEFORE the migration applied: 1 suite failed (function did not exist) — expected, proves the test is real
`npm run db:apply -- supabase/migrations/20261103010000_f116_client_channel_access.sql` (0)
`npx vitest run tests/integration/f116-client-chat-channel-rls.test.ts` — after migration: 15/15 passed
`npx vitest run tests/integration/f116-portal-chat-wiring.test.ts` — 2/2 passed
`npx vitest run tests/integration/f080-portal-settings-authz.test.ts` — 9/9 passed (regression check on the file I edited)
`npx vitest run components/portal/portal-sidebar.test.tsx` — 13/13 passed (updated one assertion for the new nav item)
`npx tsc --noEmit` (0)
`npm run build` (0) — `/portal/[workspaceSlug]/p/[projectId]/conversation` present in the route list
`npx vitest run tests/unit/server-client-boundary-imports.test.ts` (0)
`npm run db:gen-types` (0) — `Wrote lib/supabase/database.types.ts (3908 lines)`
`npm run migrations:check` (0) — `✓ No migration drift — all migrations present on remote.`
`npm run seed:demo` (0) — run TWICE in a row, identical output both times (proves idempotency; the script deletes and rebuilds the whole demo workspace every run, so channel/messages/idempotency is inherited from that existing convention, not new state I had to de-duplicate myself)
`curl http://localhost:3000/dev-login?email=nina@demo.test` then `curl .../portal/acme-studio/p/<Website Redesign id>/conversation` → 200, body contains the seeded conversation text ("staging link works great", "homepage build is underway")
`curl .../portal/cedarwood-partners/p/<made-up id>/conversation` (as nina) → 404 (cross-workspace, correctly rejected before even reaching the channel lookup)

All targeted tests run together at the end: 7 files / 53 tests passed.

## Decisions made

**Shape:** one project channel per project (per the plan), created lazily —
NOT at project creation, NOT on first message. The single decision point is
`portal_enabled` flipping true (`setPortalEnabled`, lib/actions/
portal-settings.ts), via a new idempotent `ensure_project_channel_atomic`
RPC. This avoids the plan's own "empty and unmentioned" clutter concern
(project creation) and the race concern (first message — two people hitting
"send" at once). `activateInvitedMemberships` (lib/actions/invites.ts) calls
the SAME RPC to backfill a client who accepts their invite AFTER the portal
is already on — it does NOT create the channel if the portal isn't enabled
yet, so channel creation stays a single decision point, not two. A partial
unique index (`channels(project_id) where kind='channel'`) backs the RPC's
`ON CONFLICT`, so concurrent calls from both trigger points can never create
two channels for one project.

**Visibility scope: project members only, not "workspace-visible browsing."**
The plan asked this explicitly: "are client channels visible to every
workspace member, or only project members?" Decision: only project members
(explicit `project_members` row). Defended by the plan's own reasoning — a
client's message landing in a channel a `viewer` can read (which the
PRE-EXISTING `channels_select_members_or_workspace` policy allowed, via its
`is_project_visible_to`-gated auto-enroll branch, for ANY workspace-visible
project) is a leak of the client's words, not ours. `f116-client-chat-
channel-rls.test.ts`'s "a viewer who is not a project member cannot browse"
block proves this against a real, deliberately workspace-visible project.

**Grant `ensure_project_channel_atomic` to `service_role` only, not
`authenticated`.** Unlike the pre-existing `create_channel_atomic` (which
IS granted to `authenticated` — noted as an existing widening I did NOT
touch, see Out-of-scope below), this new function has no internal
caller-identity check: it trusts `p_created_by` and admits every current
`project_members` row unconditionally. Granting it to `authenticated` would
let anyone call it directly against any `project_id` and enroll themselves.
Verified with a test: an ordinary client session calling it directly gets
rejected.

**Nav placement: NOT a tenth primary item.** The plan's own review already
called the eight primary views borderline too many. Conversation joins the
existing "secondary" tier alongside Requests (`buildPortalSecondaryNavItems`,
components/portal/portal-sidebar.tsx) rather than growing
`buildPortalNavItems`. Unlike Requests this is NOT marked TEMPORARY — there
is no future feature that gives chat a "real" home the way Scope & decisions
will eventually absorb Requests (per that function's own existing comment),
so I left Requests' comment as-is and added a new one explaining why
Conversation stays.

## Out-of-scope work needed

1. **A genuine, pre-existing, unrelated bug found while testing this
   feature: `channel_members_select_own_or_shared_channel`'s original
   "shared channel" branch never actually worked for ANYONE, not just
   clients.** It was an inline correlated subquery against `channel_members`
   itself, which is subject to its own RLS recursively — verified directly
   with two ordinary `member` accounts in a plain DM: each saw only their
   own membership row, never the other person's. I fixed this in the same
   migration (via a new `is_channel_member()` SECURITY DEFINER helper,
   mirroring `is_active_workspace_member`/`is_project_workspace_member`
   elsewhere in this schema) because the task's own "does the member list
   expose staff" question is unanswerable without a working roster query —
   but the STAFF-side implication (the "who's in this channel" UI in
   `/w/<slug>/chat` has been silently broken for every role since
   20260904020000 shipped) is worth its own look: is there other UI beyond
   the member-list strip that assumed this worked?

2. **`create_channel_atomic` is still granted to `authenticated` directly**
   (not just `service_role`), which means any signed-in user can call it
   over `supabase-js` with an arbitrary member id list, bypassing
   `createChannel`'s own app-layer visibility/membership checks entirely.
   This predates F116 and is a general chat-feature hole, not
   client-specific — I did not touch it because narrowing an existing
   grant on a function three other features may already depend on is a
   bigger, more carefully-tested change than this feature's stated scope.
   Flagging because a `client` calling it directly today (before this
   migration, or via any future re-widening) could self-enroll into an
   arbitrary channel the same way the `channel_members` insert hole did —
   worth a dedicated hardening pass.

3. **`createChannel`'s own project-scoped INSERT check still uses
   `isProjectVisibleToCaller`** (workspace-visibility-inclusive), not the
   tighter `project_members`-only rule this migration applied to SELECT/
   self-add. In practice this causes no leak (the creator is always
   auto-enrolled as a member of whatever they create, so they can always
   see their own creation regardless), but it is an inconsistency between
   create and browse for the SAME general ad-hoc-channel feature — worth
   aligning in a future pass for consistency, not urgency.

4. **No unread badge on the new "Conversation" nav item.** Every other
   badge-carrying nav item (Approvals, Your list) reads from
   `getPortalBadgeCounts` (lib/queries/portal.ts). Wiring an unread count
   through would need that query extended with the project's channel id and
   `get_chat_channel_summaries`; left out to bound this feature's scope to
   the security connection + basic view, not a new counting pipeline.

5. **No realtime "typing"/presence integration is portal-specific.**
   `ChannelView` already wires `useTypingIndicator`/`useWorkspacePresence`
   unconditionally (reused as-is) — these should already work for a client
   session since they're scoped by `channel_members`, but I did not
   separately verify presence/typing over Realtime end-to-end (out of this
   task's curl-only verification budget); worth a manual check during the
   screenshot pass below.

## Blockers

(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: Treated this as a standalone task outside the mission's
per-feature `/mission-tasks` clarification loop (no `features/F116-*.md` or
`clarifications/F116-clarification.md` exists in `missions/20260903-portal/`
— this task's own prompt IS the spec). Resolved every open question the
prompt raised ("decide deliberately...and defend it") directly in the
migration's own header comment and in "Decisions made" above, rather than
stopping to ask.

AUTONOMOUS_DECISION: Fixed the pre-existing `channel_members` roster-visibility
bug (see Out-of-scope #1) instead of only reporting it, because this
feature's own security enumeration ("does the member list expose staff")
cannot be answered against a query that shows nobody anything.

AUTONOMOUS_DECISION: Did not add a new AS-NNN id to `validation-contract.md`
— this plan doc's items are follow-up work layered on top of an already-
`APPROVED` mission contract, and the task's own instructions did not ask for
contract changes; the mission's own validators may already treat post-launch
follow-up docs as out-of-contract polish.

## Notes for the next worker

- **Screenshot targets, in order:**
  1. Sign in at `/dev-login?email=nina@demo.test`, then go to
     `/portal/acme-studio/p/<Website Redesign>/conversation` — should show
     the 5-message seeded thread ("staging link works great" ... "homepage
     build is underway now that the hi-fi is approved").
  2. The portal sidebar (either desktop `<aside>` or the mobile horizontal
     strip) — "Conversation" should appear in the smaller/dimmer secondary
     row beside "Requests", not in the main eight-item list.
  3. Sign in as `luka@demo.test` (workspace member, on the Website Redesign
     team) at `/w/acme-studio/chat` — the SAME channel ("Website Redesign")
     should appear in the staff chat nav with nina's messages already in it,
     proving "the team sees the same channel in their existing chat nav."
  4. Optional negative screenshot: sign in as `vuk@demo.test` (workspace
     `viewer`, not on the Website Redesign project) at `/w/acme-studio/chat`
     — the "Website Redesign" project channel should NOT be listed/joinable
     for them.

- The mobile back-button inside the reused `ChannelView` (`components/chat/
  channel-view.tsx`) still points at `/w/<slug>/chat`, which a client role
  is redirected away from by the workspace layout's own existing guard
  (`app/(workspace)/w/[workspaceSlug]/layout.tsx`, `currentRole === "client"`
  branch) — harmless (button is `md:hidden`, only visible on mobile where a
  client would just bounce straight back to `/portal/<slug>`), left
  untouched rather than adding a portal-specific `backHref` prop for a
  cosmetic edge case.

- MCP: no MCP registry entry was consulted for this task (this is a direct
  ad-hoc task outside `/mission-run`, not a numbered mission feature) — all
  Supabase verification went through the real REST/Management API
  (`npm run db:apply`, `db:gen-types`, `migrations:check`) and real signed-in
  sessions, per the task's own explicit instructions, rather than an MCP
  tool.
