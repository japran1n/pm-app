# F001: Migration — portal foundations (phases, page fields, portal switch)

**Milestone:** M1 — Shell, phases, pages
**Estimated worker time:** 2–3 h
**Depends on:** none

## Assertion IDs covered
- AS-007: A client whose project has `portal_enabled = false` receives a 404 for that project's portal routes, and its rows are not returned by any portal query.
- AS-008: Each project can hold an ordered list of phases, each with a client-facing name, description, state, and planned dates.
- AS-011: A phase's progress figure counts only tasks that are marked visible to the client.
- AS-012: A phase with `client_visible = false` appears in neither the portal timeline nor any portal progress figure.

## Scope

One forward-only migration plus the read-side query functions it
enables. **No UI in this feature.**

### 1. `project_phases`

```
id              uuid pk default gen_random_uuid()
project_id      uuid not null references projects(id) on delete cascade
name            text not null
client_description text null
position        integer not null
state           text not null default 'not_started'
                check (state in ('not_started','active','blocked','done'))
planned_start   date null
planned_end     date null
actual_start    date null
actual_end      date null
client_visible  boolean not null default true
created_at / updated_at timestamptz not null default now()
```

- Index on `(project_id, position)`.
- `set_updated_at` trigger, the convention established in
  `20260818004413_create_projects.sql`.
- Unique `(project_id, position)` is **not** required — reordering with a
  unique constraint needs deferred updates; follow whatever
  `saved_views` position (`20260903030000`) does and match it exactly.

### 2. Task columns

```
tasks.phase_id   uuid null references project_phases(id) on delete set null
tasks.page_slug  text null
tasks.page_order integer null
```

Index `tasks(phase_id)` and `tasks(project_id, page_order)`.

`page_slug` / `page_order` are only meaningful for tasks whose
`task_type` is the seeded `page` type; no constraint enforces that —
a check that reads another table is not worth the trigger.

### 3. Project columns

```
projects.target_launch_date  date null
projects.launch_confidence   text null
                             check (launch_confidence in ('on_track','at_risk','slipped'))
projects.launch_note         text null
projects.portal_enabled      boolean not null default false
projects.portal_enabled_at   timestamptz null
```

`portal_enabled` defaults **false**: existing projects must not become
client-visible the moment this migration lands.

### 4. `project_statuses.client_description text null`

The client-facing explanation of a status (AS-016). Nullable; the UI
falls back to the status name when it is null.

### 5. RLS

- `project_phases`: enable RLS.
  - Team SELECT/INSERT/UPDATE/DELETE — active workspace member, role not
    `client`, and project visible to them (`is_project_visible_to`).
  - Client SELECT — the `tasks_select_client` shape
    (`20260902010000`, hardened by `20260902020000`), **plus**
    `client_visible = true`, **plus** the project's `portal_enabled`.
- Extend the client-visible predicate for `tasks` so a project with
  `portal_enabled = false` returns nothing to a client. Do this by
  adding the condition to the existing helper if there is one, or by a
  new forward-only policy — **never by editing a prior migration**.
- Every SECURITY DEFINER function this migration adds or edits pins
  `search_path` including `pg_temp`, exactly as
  `20260908010000_pin_pg_temp_on_client_visibility_predicates.sql`
  does. This is the single most important line in the migration.

### 6. `seed_default_phases(p_project_id uuid)`

SECURITY DEFINER, pinned search_path, callable by an active non-client
member of the project's workspace. Inserts these ten phases in order,
with the client descriptions verbatim:

| # | name | client_description |
|---|---|---|
| 1 | Kick-off & setup | Deciding who approves what, and setting up the tools we will work in. |
| 2 | Audit & baseline | Measuring the current site so we can prove what changed after launch. |
| 3 | Site structure | Agreeing every page and every URL before anything is designed. |
| 4 | Visual direction | Choosing the look — moodboard, style, and one design direction. |
| 5 | Page design | Designing each page in Figma, for your approval, page by page. |
| 6 | Assets & content | Preparing images and getting the real text onto the pages. |
| 7 | Build | Building the approved designs in Webflow. |
| 8 | Quality assurance | A second developer and the designer check every page. |
| 9 | Launch | Going live, with tracking and redirects verified. |
| 10 | Handover | Training, documentation, and moving every account into your name. |

Idempotent: calling it on a project that already has phases returns
without inserting (do not duplicate).

### 7. Read side — `lib/queries/portal.ts`

- `getProjectPhases(projectId)` — client-visible phases with a computed
  progress percentage. Progress = client-visible tasks in that phase
  whose status category is done, over all client-visible tasks in that
  phase. Zero tasks means progress 0 and the UI says so; never divide by
  zero.
- `getPortalProjects` must additionally require `portal_enabled`.

## Files (approximate)

- `supabase/migrations/2026090301XXXX_portal_foundations.sql` (new)
- `lib/queries/portal.ts`
- `tests/integration/portal-phases-rls.test.ts` (new)

## Notes

- Apply with `npm run db:apply`. The Supabase MCP is not authorised in
  this session; the CLI is linked and is the path to use.
- Read `supabase/migrations/20260902010000_client_role_and_task_client_visibility.sql`
  and `20260908010000_pin_pg_temp_on_client_visibility_predicates.sql`
  before writing a line. They define the pattern this migration copies.

## Definition of done

- **Primary success test:** integration test — a client member of a
  project with `portal_enabled = true` selects its client-visible
  phases; a client of a project with `portal_enabled = false` selects
  zero phases *and* zero tasks.
- **Failure test:** a phase with `client_visible = false` is absent from
  the client's select **and** does not shift any progress figure.
- **Manual verification:** `npm run db:apply` succeeds against the
  linked project; `seed_default_phases` on a scratch project inserts ten
  ordered rows and a second call inserts none.
- **Side-effect verification:** existing task, project and portal tests
  still pass — in particular nothing that previously returned tasks to a
  client now returns nothing because `portal_enabled` defaulted false in
  a fixture. Fixtures that need it must set it explicitly.
