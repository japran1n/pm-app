# F007: Migration — approval requests and decision owners

**Milestone:** M2 — Approvals
**Estimated worker time:** 3 h
**Depends on:** F001 (portal_enabled, client RLS shape), F002b (typed client)

## Assertion IDs covered
- AS-019: A team member can create an approval request from a task, from a document, or standalone with an external artifact URL.
- AS-020: Creating an approval request against a task that is not client-visible is rejected at creation time with an explicit error.
- AS-022: A client who is not the named decision owner for an approval's decision type cannot record a decision, and the rejection is enforced server-side.
- AS-023: Approving a request records the decider, the timestamp, and the decision in one transaction, and clears the linked task's pending-approval flag.
- AS-024: A recorded approval decision cannot be edited or deleted; a changed mind requires a new approval request.

## Why this shape

The app already has approvals, but only as a boolean on a task
(`tasks.pending_client_approval`, migration `20260903050000`) with
`approve_portal_task_atomic` (`20260905130000`) acting on it. That works
for "approve this task" and cannot express the four things the Good Guys
process actually puts in front of a client: a sitemap (not a task), a
moodboard (not a task), a Figma link (not in this system at all), and a
priced change request.

So: a first-class `approval_requests` table becomes the source of truth,
and `tasks.pending_client_approval` stays as a denormalised indicator
that the RPC keeps in sync. Do not delete the boolean — the board and
the existing portal overview read it.

## Scope

### 1. `approval_requests`

```
id             uuid pk default gen_random_uuid()
project_id     uuid not null references projects(id) on delete cascade
phase_id       uuid null references project_phases(id) on delete set null
subject_type   text not null check (subject_type in ('task','doc','phase','artifact'))
subject_id     uuid null            -- task/doc/phase id; null for 'artifact'
artifact_url   text null            -- Figma / Octopus / anything external
artifact_snapshot_path text null    -- storage path, written at creation
title          text not null
description    text null
decision_type  text not null check (decision_type in ('content','brand','technical','commercial'))
state          text not null default 'pending'
               check (state in ('pending','approved','changes_requested','withdrawn'))
requested_by   uuid not null references auth.users(id)
requested_at   timestamptz not null default now()
due_at         timestamptz null
decided_by     uuid null references auth.users(id)
decided_at     timestamptz null
decision_note  text null
round          integer not null default 1
supersedes_id  uuid null references approval_requests(id)
created_at / updated_at
```

Constraints that matter:
- `subject_id` must be non-null when `subject_type <> 'artifact'`, and
  `artifact_url` non-null when it is — one CHECK covering both.
- A settled row is immutable (AS-024): enforce with a trigger that
  rejects any UPDATE whose `OLD.state <> 'pending'`, rather than trusting
  policies alone. A second decision is a new row pointing at the first
  through `supersedes_id`.

Index `(project_id, state)` and `(subject_type, subject_id)`.

### 2. `project_decision_owners`

```
id            uuid pk
project_id    uuid not null references projects(id) on delete cascade
decision_type text not null check (… same four …)
user_id       uuid not null references auth.users(id)
unique (project_id, decision_type)
```

One owner per decision type per project. The Phase 0 deliverable this
implements allows one person to own all four; the unique constraint is
on the pair, not on the user.

### 3. RLS

- Team: active workspace member, role not `client`, project visible.
- Client SELECT: the `tasks_select_client` shape plus `portal_enabled`,
  plus — for `subject_type = 'task'` — the subject task must itself be
  client-visible. An approval must never become a side channel that
  reveals an internal task's title.
- Client UPDATE: **none.** Clients decide only through the RPC.

Every SECURITY DEFINER function pins `search_path` including `pg_temp`,
per `20260908010000`.

### 4. `decide_approval_atomic(p_request_id, p_decision, p_note)`

One transaction:
1. Load the request; fail if not `pending`.
2. Verify the caller is the `project_decision_owners` row for that
   request's `decision_type`. **This is the enforcement point for
   AS-022** — the portal's disabled button is a courtesy, not a control.
3. Reject `changes_requested` with an empty note.
4. Write `state`, `decided_by`, `decided_at`, `decision_note`.
5. If `subject_type = 'task'`, clear that task's
   `pending_client_approval`.
6. Write `audit_log`.
7. Insert the team notification row through the existing
   `create_notification()` RPC — reuse it, do not insert into
   `notifications` directly (that table has no client INSERT policy by
   design).

Follow `approve_portal_task_atomic` (`20260905130000`) and
`accept_client_request_atomic` (`20260905100000`) for structure, error
shape and grants.

### 5. Read side

`lib/queries/approvals.ts`: `getOpenApprovalsForClient(projectId)`,
`getApprovalHistory(projectId)`, `getDecisionOwners(projectId)`, and
`getOpenApprovalsForWorkspace(workspaceId)` for F010's queue.

Also make `getPortalBadgeCounts` (F003's stub) return the real
awaiting-decision count.

### 6. Types

Regenerate with `npm run db:gen-types` (F002b). No `untyped()` casts.

## Files (approximate)

- `supabase/migrations/2026091X0000_approval_requests.sql`
- `lib/queries/approvals.ts`, `lib/queries/portal.ts`
- `lib/supabase/database.types.ts`
- `tests/integration/f007-approvals-rls.test.ts`

## Definition of done

- **Primary success test:** integration — the named decision owner can
  approve through the RPC; the request settles, the task's flag clears,
  and an audit row exists, all in one call.
- **Failure tests:** (a) a client who is not the decision owner is
  rejected by the RPC even when calling it directly; (b) a second
  decision on a settled row is rejected by the trigger; (c) an approval
  whose subject task is not client-visible is invisible to the client,
  title included.
- **Manual verification:** `npm run db:apply` succeeds; `npm run
  db:gen-types` produces types containing `approval_requests`.
- **Side-effect verification:** existing `approve_portal_task_atomic`
  tests still pass — the boolean path is not broken by the new table.
