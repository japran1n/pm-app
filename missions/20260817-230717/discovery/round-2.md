# Discovery Round 2

_Captured: 2026-08-17T21:15:00Z_
_Answered by: orchestrator, on the user's behalf per explicit standing authorization._

Based on round-1 answers, these gaps needed clarifying (real-time + Postgres,
invite-only + magic-link disambiguation, multi-tenant isolation, storage
details, board-reorder mechanics — the last being the #1 correction flagged
in the reference-app reverse-engineering pass).

---

**1. Realtime implementation for the board/task updates (Q8: WebSockets/SSE for some features)?**
- (a) Supabase Realtime (Postgres logical replication → WS)   ← chosen
- (b) Custom WS server
- (c) Redis pub/sub broker
- (d) Third-party (Ably/Pusher)

Rationale: native to the Supabase stack, zero extra infra.

**2. Which tables get Realtime subscriptions?**
- (a) tasks only
- (b) tasks + comments               ← chosen
- (c) everything (projects, tasks, comments, teams)
- (d) none — defer to v2

Rationale: covers "someone else moved a card" and "someone else commented" —
the two moments collaboration actually needs to feel live. Projects/teams
change rarely enough that a refetch-on-navigation is fine.

**3. Invite-only (Q5) + magic-link auth (Q3) — how does an invited user activate?**
- (a) Invite creates a row keyed by email; magic-link signup checks it exists before allowing workspace access   ← chosen
- (b) Admin creates the full user account manually, shares credentials
- (c) Invite link contains a one-time signup token, separate from magic-link
- (d) Anyone can sign up; admin approves workspace access afterward

Rationale: keeps Supabase Auth's native magic-link flow untouched — the
`workspace_members` invite row (status `invited`) is what gates workspace
access, not the auth mechanism itself. Simplest to implement correctly with
RLS.

**4. Multi-tenant isolation model (correcting the reference app's total absence of one)?**
- (a) Single shared schema, `workspace_id` FK + Postgres RLS on every table   ← chosen
- (b) Schema-per-tenant
- (c) Database-per-tenant
- (d) No isolation — single global workspace

Rationale: standard Supabase multi-tenancy pattern; RLS policies keyed on
`workspace_id` + membership are exactly what Supabase is designed for, and
this is the single biggest structural fix over the reference app.

**5. Can a user belong to more than one workspace?**
- (a) No — one workspace per user
- (b) Yes — user picks active workspace via a switcher   ← chosen
- (c) Yes — but only one workspace active at signup, others read-only
- (d) Not applicable — no workspace concept

Rationale: realistic even for a solo MVP (consultant/freelancer scenario);
cheap to model up front (`workspace_members` join table), expensive to retrofit.

**6. Task board drag-and-drop — what must persist (correcting reference app: column changes but in-column order does not)?**
- (a) Column only (status), order not persisted
- (b) Column + position within column, using a `position` float/fractional-index field   ← chosen
- (c) Column + position, using integer re-sequencing of all cards on every move
- (d) Defer ordering to v2

Rationale: fractional-indexing (`position: float8`, new card gets midpoint
between neighbors) avoids re-writing every row on every drag — the correction
explicitly called out during reverse-engineering.

**7. Status and priority — how should they be modeled (correcting reference app's plain strings)?**
- (a) Postgres native `enum` types
- (b) Plain `text` + CHECK constraint   ← chosen
- (c) Plain `text`, validated only in app code
- (d) Separate lookup tables (`statuses`, `priorities`)

Rationale: CHECK constraint gives the same DB-level validity guarantee as a
native enum without enum-alteration pain (`ALTER TYPE ... ADD VALUE` has sharp
edges, e.g. can't run in a transaction); a lookup table is unnecessary
indirection for a fixed, small set of values (4 statuses, 5 priorities).

**8. File attachments — access control on Supabase Storage buckets?**
- (a) Public bucket, unguessable URLs only
- (b) Private bucket + signed URLs, RLS-gated by workspace membership   ← chosen
- (c) Private bucket, service-role proxy through a Route Handler
- (d) No attachments in v1

Rationale: keeps files private per workspace using the same RLS model as the
rest of the data, consistent with the Q4 isolation decision, without adding
a proxy layer.

**9. Comments — realtime + soft delete interaction: does deleting a comment remove it from other users' live view?**
- (a) Yes — soft-deleted comments are filtered out of the Realtime payload too   ← chosen
- (b) No — soft-deleted comments still show "deleted" placeholder for others
- (c) Hard delete comments only (no soft delete for this entity)
- (d) Not applicable — comments not in v1

Rationale: RLS policy excludes `deleted_at IS NOT NULL` rows from the
`SELECT` used by Realtime, so deletion is consistent across polling and live
subscription without special-casing.

**10. Assignment modeling — fixing the reference app's duplicated `assignedUserId` column + unused `TaskAssignment` join table?**
- (a) Single-assignee only: `tasks.assignee_id` FK, drop the join table entirely   ← chosen
- (b) Multi-assignee: keep only the join table, drop the column
- (c) Keep both, document `assignedUserId` as "primary" and join table as "watchers"
- (d) Defer — keep both as in the reference app

Rationale: the reference app never actually used the join table in any
controller — it's dead weight. A PM tool's core interaction is "one owner per
task"; multi-assignee is a real feature but not core-MVP, so the join table
is removed rather than half-supported.

**11. Workspace switcher + RLS — where does "current workspace" state live?**
- (a) URL segment, e.g. `/w/[workspaceSlug]/...`, RLS checked per request via membership lookup   ← chosen
- (b) Client-side only (localStorage), no server enforcement
- (c) Server session/cookie only, no URL indication
- (d) Subdomain per workspace

Rationale: URL-encoded workspace is shareable, bookmarkable, and makes the
Server Component data-fetching boundary obvious; RLS is still the actual
security boundary, the URL is just routing.

**12. Home dashboard charts (bar: tasks by priority, pie: tasks by status) — computed where?**
- (a) Client-side aggregation of a full task fetch
- (b) Postgres view / RPC function returning pre-aggregated counts   ← chosen
- (c) Materialized view, refreshed on a schedule
- (d) Defer charts to v2

Rationale: a `SELECT status, count(*) ... GROUP BY` RPC scales fine at MVP
data volumes and avoids shipping the full task list to the client just to
count it.

**13. Search (Q19: DB full-text) — scope of what's indexed?**
- (a) Task titles only
- (b) Task title + description                ← chosen
- (c) Tasks + projects + user names
- (d) Everything including comments

Rationale: matches the reference app's `/search` endpoint scope (tasks,
projects, users) minus comments, which would make the FTS index noisy for
limited MVP value; extends title-only to include description since that's
where most searchable content actually is.

**14. Vercel preview + Supabase (Q23: prod + preview) — do PR previews get their own database?**
- (a) All previews share the single prod Supabase project (same data)
- (b) One shared "staging" Supabase project for all previews   ← chosen
- (c) A fresh Supabase branch/project per PR
- (d) No database access in preview builds

Rationale: Supabase branching is a paid-tier feature; a single shared staging
project is the free-tier-compatible middle ground between "test against prod
data" (risky) and "per-PR databases" (costly/complex) for a solo project.

**15. Definition-of-done default for "board reorder" and similar interaction-heavy features — what evidence is required?**
- (a) Unit test on the position-calculation function only
- (b) Unit test + one Playwright test that drags a card and asserts persisted order   ← chosen
- (c) Manual QA only, no automated test
- (d) Playwright only, no unit test

Rationale: sets the default answer that `task-clarification`'s "definition of
done" round will reuse for every drag/reorder-style feature — pairs a fast
unit test on the pure position math with one E2E test proving it survives a
reload, without demanding a Playwright test per edge case.
