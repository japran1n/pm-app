# F017: Migration — project budget, work category, client-safe hours RPC

**Milestone:** M4 — Hours and results
**Estimated worker time:** 3 h
**Depends on:** F001, F002b

## Assertion IDs covered
- AS-033: A project can record a budget of sold hours for a period.
- AS-035: The portal's hours figures exclude every non-billable time entry.
- AS-036: No portal hours response contains a time entry's note or the name of the person who logged an individual entry.
- AS-037: Hours logged against tasks that are not client-visible are included in the totals but reported without the task's name.

## The rule that shapes this feature

There are **two** read paths for hours, not one with a flag.

A single RPC with an `is_client` parameter is one wrong boolean away
from handing a client the note field on every time entry — and notes are
where people write "redoing this because we misread the brief". Two
functions, two grants, two tests. The duplication is the point.

## Scope

### 1. `project_budgets`

```
id, project_id references projects on delete cascade,
period_start date not null, period_end date not null,
sold_minutes integer not null check (sold_minutes > 0),
currency text null, rate_amount numeric null,
rollover text not null default 'none' check (rollover in ('none','next_period','unlimited')),
note text null, created_at / updated_at
```

Named `project_budgets` rather than `retainers` because the first use is
a fixed-scope website build, and a retainer is one shape this table
takes, not the only one. Overlapping periods for one project are
rejected by an exclusion constraint — two live budgets is an
unanswerable "how many hours are left".

### 2. `time_entries.work_category`

```
work_category text null
  check (work_category in ('design','development','content_seo','pm','qa'))
```

Nullable, because backfilling six months of entries with a guess is
worse than an honest "uncategorised" bucket. New entries get a default
proposed from the task's type (F003's task types) and are editable.

### 3. Two RPCs

**`project_hours_team(p_project_id, p_from, p_to)`** — everything:
billable and not, per person, per category, notes included. Grant to
`authenticated`; RLS/authz gates it to non-client members.

**`project_hours_client(p_project_id, p_from, p_to)`** — returns only:
- totals by ISO week (cumulative and per-week), billable only;
- totals by `work_category`, billable only, with uncategorised as its
  own labelled bucket;
- the budget's `sold_minutes` for the period.

It returns **no** person, **no** note, and **no** task title. AS-037 is
satisfied structurally: the function never selects the task's title at
all, for any task, so a client-invisible task cannot leak through it.
That is stronger than filtering titles by visibility, and simpler to
prove.

Both pin `search_path` with `pg_temp` (`20260908010000`).

### 4. Read side

`lib/queries/hours.ts` with a team function and a client function whose
return types are structurally different — so a future refactor cannot
accidentally pass the team shape to a portal component and have it
type-check.

## Definition of done

- **Primary success test:** integration — `project_hours_client` totals
  match a hand-computed sum of billable entries for the period.
- **Failure tests:** (a) the client RPC's JSON contains no `note`, no
  user id, no task title, for a project seeded with entries that have
  all three — assert on the serialised payload, not on named fields;
  (b) non-billable entries change no client-visible figure; (c) a client
  cannot select `time_entries` directly.
- **Manual verification:** `db:apply` and `db:gen-types` succeed;
  overlapping budget periods are rejected.
- **Side-effect verification:** existing time-entry queries and the
  dashboard KPI RPCs are unaffected.
