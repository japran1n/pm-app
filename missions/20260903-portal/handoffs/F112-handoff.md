# Handoff: F112 — Project roles ("who does what on this project")

## Status
COMPLETE

## Assertions covered
This feature was assigned directly by the orchestrator from
`docs/client-portal-phase-2-plan.md` item D and
`docs/client-portal-six-star-review.md` Part 0/D, not from
`validation-contract.md` — no AS-NNN ids exist for it in that mission's
contract. Coverage below is self-authored from the spec's own behavioural
claims, each with a real test run observed:

- A `project_roles` row can hold PM/team lead/design lead/Webflow
  lead/designer/developer for a (project, user) pair, and a person can
  hold two roles on one project — PASS (`tests/integration/f112-project-roles-rls.test.ts`, seed script's `NORTHWIND_PROJECT_ROLES` gives `ivan` two rows on one project).
- A team member (active workspace writer) can read/insert/delete their
  project's own roles — PASS (`f112-project-roles-rls.test.ts`, "a team member reads..." / "...can insert and remove").
- A client can read their own project's roles when the portal is
  enabled — PASS (same file, "a client reads their own project's roles...").
- A client of project A cannot read project B's roles (the explicit
  failure case the spec calls for) — PASS (same file, "a client of
  project A cannot read project B's roles" and the converse).
- A client cannot write a project role — PASS (same file, "a client
  cannot insert a project role", asserts Postgres code 42501).
- The portal's Your team card renders a job title, a one-line "what they
  own" note, and an email contact link, sorted team-lead-first, one row
  per (person, role) — PASS (`tests/unit/portal-overview-queries.test.ts`
  new `getPortalTeam` cases; `components/portal/team-card.test.tsx` new
  cases).
- The team card's zero-roles state falls back to the pre-existing
  `project_members.project_role` label rather than showing nothing —
  PASS (existing `team-card.test.tsx` case + `getPortalTeam`'s "excludes
  a co-client's..." /empty-project cases, unchanged and still passing).
- The settings editor is reachable beside "Who approves what" and gated
  by the same `canWrite` predicate that gates decision owners — verified
  by live curl (see Notes) and by matching `DecisionOwnersSection`'s own
  `canManage` wiring exactly.

## Files changed
- supabase/migrations/20261101010000_f112_project_roles.sql (new)
- lib/project-roles-shared.ts (new — vocabulary/labels/types, isolated
  from server-only imports so a Client Component can use them)
- lib/queries/project-roles.ts (new)
- lib/actions/project-roles.ts (new)
- lib/validation/project-roles.ts (new)
- components/project/project-roles.tsx (new — settings editor)
- tests/integration/f112-project-roles-rls.test.ts (new)
- app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/page.tsx (wire the new "Team" section beside decision owners)
- lib/queries/portal.ts (`getPortalTeam` now reads `project_roles`, one row per job, team-lead-first sort, falls back to the old label when a person has none)
- components/portal/team-card.tsx (renders role, note, mailto contact)
- components/portal/team-card.test.tsx (updated + new cases)
- tests/unit/portal-overview-queries.test.ts (mock for `project_roles`, new cases)
- scripts/seed-demo.mjs (`WEBSITE_PROJECT_ROLES`, `NORTHWIND_PROJECT_ROLES`, `MERIDIAN_PROJECT_ROLES`, wired into the existing seeders)

Not committed by me: `lib/supabase/database.types.ts` is already staged
by a concurrent worker (F113, `page_links`) running in this same working
tree at the same time — the disk copy is a full `db:gen-types` dump that
already includes `project_roles` (verified: `grep -c "project_roles:"`
returns 1), so nothing is lost; I did not re-add it to avoid committing
someone else's staged, unrelated table changes under my message.

## Commands run
- `npm run db:apply -- supabase/migrations/20261101010000_f112_project_roles.sql` (0)
- `npm run db:gen-types` (0)
- `npm run migrations:check` (0) — run twice, clean both times
- `npx tsc --noEmit` (0, after the client/server boundary fix below)
- `npm run build` (0)
- `npx vitest run tests/unit/portal-overview-queries.test.ts components/portal/team-card.test.tsx tests/unit/server-client-boundary-imports.test.ts` (0, 34 tests)
- `set -a; source .env; set +a; npx vitest run tests/integration/f112-project-roles-rls.test.ts` (0, 6 tests, against the real hosted Supabase project)
- `set -a; source .env; set +a; npm run seed:demo` — run twice back to back, both exits 0, identical final counts ("55 tasks total") both times — idempotency proof
- `curl` against the running dev server (see Notes) — portal Overview 200 with "PM"/"Team lead"/"Design lead"/"Developer" in the markup; project settings page 200 with a "Team" `<h2>` beside "Who approves what"

## Decisions made
- **Fixed CHECK constraint, not workspace-configurable**, for the role
  vocabulary (`pm`, `team_lead`, `design_lead`, `webflow_lead`,
  `designer`, `developer`). Same trade this schema already makes for
  `approval_requests.decision_type` (four fixed values) and
  `notifications.kind` — a closed list is simpler and the portal's UI
  never has to render a role name it has no copy for, at the cost that a
  seventh role needs a migration. The spec only asked for a defended
  choice, not the configurable one.
- **`project_roles.note` is free text**, not derived, for "what they
  own." Nothing else in the schema names "the thing a person owns" as
  opposed to "the thing they're doing this week" (`tasks.assignee` is
  task-scoped, `project_phases` is project-wide, not person-scoped) — a
  new derivation would need its own taxonomy this feature has no other
  consumer for.
- **No contradiction between `project_roles` and `project_decision_owners`**:
  the two tables are never joined and neither is derived from the other.
  `project_decision_owners` always names a *client's* authority over a
  decision type (`setDecisionOwner` checks `getProjectClientMembers`);
  `project_roles` names an agency team member's job
  (`getProjectTeamCandidates` excludes anyone whose workspace role is
  `client`). They are read by disjoint queries and rendered in disjoint
  UI (project settings "Who approves what" vs "Team"; portal's decision
  owner badges vs "Your team" card). There is nothing to reconcile
  because the schema makes it structurally impossible for one to
  restate the other's answer about the same fact.
- **Team-side picker source is `project_members` minus clients**
  (`getProjectTeamCandidates`), the same audience `getPortalTeam` already
  restricts "your team" to — a job title is an agency-team concept.
- **UI/action gate reuses `canWrite`/`requireWrite`**, the exact
  predicate `DecisionOwnersSection`/`setDecisionOwner` already use, per
  this feature's own instruction to match how the decision-owners UI
  works rather than inventing a second authorization shape. RLS mirrors
  `project_decision_owners`' own policy shape line for line
  (`is_project_visible_to`/`is_project_client`/`is_project_portal_enabled`/`is_project_workspace_writer`, all pre-existing, pinned
  `search_path` predicates — no new SECURITY DEFINER function was added).
- **`lib/project-roles-shared.ts` split**: `components/project/project-roles.tsx`
  is a Client Component that needs the role vocabulary/labels/row types.
  Importing them from `lib/queries/project-roles.ts` pulled that whole
  module's `createClient`/`createAdminClient` imports (→ `next/headers`)
  into the client bundle and threw a real request-time 500 on
  `/w/.../settings` (caught by curling the dev server, NOT by `tsc`/`npm
  run build`, which both stayed green throughout — this is exactly the
  failure mode this feature's own instructions warned about). Fixed by
  moving the vocabulary/labels/types into a new file with zero
  server-only imports; `lib/queries/project-roles.ts` now re-exports them
  for server callers.

## Out-of-scope work needed
- **Team card email is often blank in practice.** `resolvePeople`
  (`lib/queries/people.ts`) only resolves `email` for a person who has no
  `profiles.display_name` yet (a deliberate perf optimization — it skips
  the `auth.users` lookup entirely once a display name exists). Every
  demo account has a display name, so the "how to reach them" email link
  this feature added rarely renders in practice; `getDecisionOwners`
  (F085) already carries the identical limitation for the exact same
  reason, so this is an existing, accepted pattern I matched rather than
  a defect I introduced — but if "how to reach them" is meant to always
  show an address, `resolvePeople` needs to fetch email unconditionally
  (a real perf cost, one extra batched RPC call per full name-resolution
  pass) or a separate always-populated email column needs adding
  somewhere. Flagging rather than silently changing shared perf-sensitive
  infra used by every other list in the app.
- The "Team" section's add-role picker offers every non-client project
  member with no de-duplication against roles they already hold beyond a
  client-side "already has this role" toast check — a second, concurrent
  add from two browser tabs could still race past the UI check (the DB's
  own unique constraint on `(project_id, user_id, role)` is the real
  guard and returns a Postgres error, but the UI surfaces it as the
  generic `GENERIC_ERROR` string rather than a friendlier "already
  assigned" message). Not fixed here — narrow, no assertion, no user
  ever reported it.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Assigned each demo project's `project_roles` rows
myself (Website Redesign: sasa→pm, maja→team_lead, ana→design_lead,
luka→developer; Northwind: sasa→pm, ivan→team_lead+developer; Meridian:
sasa→pm, ivan→developer) based on the existing task assignment patterns
already in `scripts/seed-demo.mjs` (e.g. ana does every design task on
Website Redesign, luka does every build task) — no spec named exact
per-demo-person assignments.

AUTONOMOUS_DECISION: Chose `canWrite` (not the narrower
`canManageProjectMembers`, which is lead/admin/owner-only) as both the
UI gate and the RLS write predicate for `project_roles`, matching
`project_decision_owners`'/`setDecisionOwner`'s exact existing gate
rather than the member-list's own narrower one — the spec said to put
this "beside decision owners" and match how that works, and decision
owners is the closer sibling (another "who does what" settings row) than
the member add/remove list is.

## Notes for the next worker
- No MCP tools were used for this feature (Supabase MCP is not
  registered per this mission's `connections/mcp-registry.md` at the
  time of writing this feature — all schema/RLS verification went
  through `npm run db:apply`/`db:gen-types`/`migrations:check` and real
  signed-in-session integration tests instead, consistent with how
  `tests/integration/f007-approvals-rls.test.ts` already verifies the
  sibling `project_decision_owners` table).
- **This working tree had a second worker (F113, `page_links`) editing
  files concurrently while I worked** — I observed several of my own
  `Edit` calls to already-tracked files (`components/portal/team-card.tsx`,
  the settings page, `lib/queries/portal.ts`,
  `tests/unit/portal-overview-queries.test.ts`, `scripts/seed-demo.mjs`)
  silently revert to their pre-edit HEAD content mid-session, while my
  *new* untracked files were unaffected. I re-verified with `git diff
  --stat` after every batch of edits and re-applied when a file had
  reverted; the versions verified in this handoff's "Commands run" are
  the final, currently-on-disk state, confirmed immediately before
  writing this handoff. If the orchestrator sees this table's UI or
  query missing after a merge, check for a stale revert first before
  assuming this handoff is inaccurate.
- Verified live via `curl` against the dev server on port 3000 with
  `/dev-login?email=nina@demo.test` (client) and
  `?email=sasa@demo.test` (owner): portal Overview
  (`/portal/acme-studio/p/<Website Redesign id>`) returns 200 with "PM",
  "Team lead", "Design lead", "Developer" all present in the rendered
  markup; the project settings page
  (`/w/acme-studio/projects/<id>/settings`) returns 200 with a "Team"
  `<h2>` beside "Who approves what".
- **What to screenshot**: sign in as `sasa@demo.test` at
  `/dev-login?email=sasa@demo.test`, open
  `/w/acme-studio/projects/<Website Redesign project id>/settings`,
  scroll to the new "Team" section beside "Who approves what" — you
  should see four rows (Maja/team lead, Saša/PM, Ana/design lead,
  Luka/developer) each with a one-line note and a remove (×) button.
  Then sign in as `nina@demo.test` at `/dev-login?email=nina@demo.test`
  and open the Website Redesign portal Overview — the right-rail "Your
  team" card should show the same four people in team-lead-first order,
  each with their job title and one-line note (email links will likely
  be absent per the "Out-of-scope work needed" note above, since these
  demo accounts all have display names set).
