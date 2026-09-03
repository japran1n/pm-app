# F012: Migration — deliverables, scope, decisions, assumptions

**Milestone:** M3
**Estimated worker time:** 2.5–3 h
**Depends on:** F001, F002b

## Assertion IDs covered
- AS-028: A project can hold a list of items the client owes, each with a kind, owner name, due date, blocking flag, and state.
- AS-043: A project can record scope items marked as included or excluded, each with its source.
- AS-044: A project can record decisions, each with a rationale, a decision type, a date, and a client-visibility flag.
- AS-045: A decision marked not client-visible is absent from every portal response.
- AS-046: A project can record assumptions with a confirmation state.

## Scope

Four tables in one forward-only migration. They share a shape
deliberately: project-scoped, `client_visible`, RLS copied from
`tasks_select_client` plus `portal_enabled`, `pg_temp` pinned on any
SECURITY DEFINER predicate.

### 1. `client_deliverables`

```
id             uuid pk
project_id     uuid not null references projects(id) on delete cascade
phase_id       uuid null references project_phases(id) on delete set null
task_id        uuid null references tasks(id) on delete set null
title          text not null
description    text null
kind           text not null check (kind in ('copy','image','access','decision','data','other'))
owner_name     text not null          -- the person on the CLIENT side
due_at         date null
blocking       boolean not null default false
state          text not null default 'not_started'
               check (state in ('not_started','in_progress','delivered','accepted','waived'))
delivered_at   timestamptz null
accepted_at    timestamptz null
accepted_by    uuid null references auth.users(id)
review_note    text null              -- why it was sent back
position       integer not null
created_at / updated_at
```

`owner_name` is free text, not a user reference. The person who owes us
photographs is usually not a portal user, and forcing them to be one
would mean inviting half the client's marketing department.

`task_id` is what makes the blocking real: an overdue blocking
deliverable is what F014 surfaces on the overview and what puts its task
in Blocked.

### 2. `project_scope_items`

```
id, project_id, title, description,
included boolean not null,
source text not null check (source in ('proposal','change_request')),
change_request_id uuid null references client_requests(id) on delete set null,
position integer not null, created_at
```

### 3. `project_decisions`

```
id, project_id, phase_id null,
title text not null, rationale text null,
decision_type text not null check (… content|brand|technical|commercial …),
decided_on date not null default current_date,
decided_by_name text null,
client_visible boolean not null default true,
created_by uuid not null references auth.users(id),
created_at
```

### 4. `project_assumptions`

```
id, project_id,
text text not null,
state text not null default 'assumed' check (state in ('assumed','confirmed','invalidated')),
confirmed_on date null, confirmed_by_name text null,
client_visible boolean not null default true,
flagged_by_client_at timestamptz null,    -- the "Not correct" button
flagged_note text null,
created_at / updated_at
```

`flagged_by_client_at` is the one column on these four tables a client
may write, and only through an RPC — see F015. Clients get no direct
UPDATE policy on any of them.

### 5. Risks — deliberately not built

`project_risks` appears in the plan documents. It is **not** in this
migration. Risks are the one artefact of the four PM lists that is
almost always internal, and a table nobody fills is worse than no table.
Add it when a real project asks for it. Recorded here so a later reader
knows this was a decision, not an omission.

### 6. Read side

`lib/queries/deliverables.ts`, `lib/queries/project-records.ts`
(scope + decisions + assumptions — one file, they are always read
together by the Scope view).

`getPortalBadgeCounts` gains the real overdue-deliverables count.

### 7. Types

`npm run db:gen-types`. No casts.

## Definition of done

- **Primary success test:** integration — a client reads client-visible
  rows of all four tables for a portal-enabled project.
- **Failure tests:** (a) `client_visible = false` rows are absent from
  selects, counts and every RPC; (b) a client has no INSERT/UPDATE/
  DELETE path to any of the four tables.
- **Manual verification:** `npm run db:apply` and `db:gen-types` both
  succeed.
- **Side-effect verification:** existing portal and client-request tests
  unaffected.
