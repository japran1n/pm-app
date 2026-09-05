# Task types — one honest taxonomy for agency work

F116 (missions/20260903-portal). `task_types` is a workspace-owned,
single-select taxonomy on `tasks.task_type_id`. Every workspace is seeded
with six system-keyed rows, resolvable by their stable `system_key`
column rather than their (human-editable) `name`. A workspace may also
create its own additional, purely cosmetic types — those carry no
`system_key` and none of the rules below apply to them.

The business question this taxonomy answers, which `time_entries` and
`estimate_minutes` alone cannot: **how much of a project went into fixing
our own mistakes.** We bill websites and marketing sites from fixed
quotes. If rework is 20% of three projects running, the next quote is
20% short and nobody can prove it. The missing dimension was what kind of
work the hours went into — this table is that dimension.

## The taxonomy — six types, one axis

The axis is **the nature of the work**, never the area of the site. Two
task types on a different axis (which part of the site) — `component`,
`content`, `seo` — remain valid `system_key` values in the database
(dropping them would break any existing row already tagged with one) but
are not seeded and not part of this taxonomy; mixing the two axes is what
makes taxonomies rot.

| key | name | meaning | billable | default client_visible |
|---|---|---|---|---|
| `page` | Page | one page of the site we deliver — it has a URL | yes | true |
| `delivery` | Delivery | any other agreed-scope work with no URL of its own | yes | false |
| `qa` | QA issue | something we delivered does not work as agreed — **our fault** | **no** | false |
| `client_request` | Client request | client asks for something **after** delivery, small enough to absorb | yes | true |
| `change_request` | Change request | client asks for something outside agreed scope — goes to quote | yes | true |
| `improvement` | Improvement | our own idea; nobody asked | no | false |

## The separation rules, verbatim

- **Page vs Delivery** — can you type an address and open it in a
  browser? Then Page. Otherwise Delivery. Both are agreed scope, both
  billable; the only difference is that Page appears in the client's
  Pages list.
- **QA issue vs Client request** — did we commit to this? Agreed and
  broken → QA issue, not billable. Not agreed and now wanted → client
  request or change request.
- **Client request vs Change request** — does it change scope or
  deadline? No → client request. Yes → change request. **When unsure,
  change request**, because that path already has a quote gate
  (`f016_change_requests_quote_gate`) and an unaccepted quote costs less
  than unbilled work.
- **Client request only exists after delivery.** While a page is still
  being built, client feedback on it is part of that Page task, not a
  new task. `projects.warranty_until` (f023) marks the period where the
  post-launch three — QA issue / client request / change request — carry
  the whole story of a project.
- **Improvement vs QA issue** — would the client ever notice? Visible
  and off-spec → QA. Only ugly to us → improvement.

## What is fixed, and what a team can still change

A team can rename or recolour any of the six system rows freely — the
portal and every RPC in this feature follow `system_key`, never `name`.

What is locked at the database level
(`task_types_lock_system_flags_trigger`), for every system-keyed row:

- `is_billable` can never be changed on a system-keyed row (AS-059).

What is additionally locked, for the five keys this feature introduces
(`delivery`, `qa`, `client_request`, `change_request`, `improvement`)
but **not** for `page`:

- `system_key` itself cannot be reassigned or cleared. `page` is
  exempt — F006c already built and tested a dedicated admin affordance
  for tagging/untagging which of a workspace's own types plays the
  portal's page role, and this feature does not relitigate that.

A workspace-created custom type (no `system_key`) is fully editable,
including deletion — deleting any task type, system or custom, that is
still assigned to a task is rejected (`tasks_task_type_id_fkey ... on
delete restrict`) rather than silently leaving a task typeless, now that
a type is required on every task.

## Type is required (AS-057, AS-058)

Every task has a `task_type_id`; the column is `not null`. A
`before insert` trigger on `tasks` (`tasks_default_task_type`) fills in
the calling workspace's `delivery` row whenever an insert omits one, so
every existing creation path — the web app, the browser extension API,
templates, recurrence generation, any RPC — produces a typed task without
having to be individually audited and edited. If a workspace somehow has
no `delivery` row yet (for example, a fixture built by inserting directly
into `workspaces` instead of calling `create_workspace_with_owner`), the
trigger creates one on the spot via `ensure_task_type` rather than
failing the insert.

Existing tasks were backfilled once, in the migration that added the
`not null` constraint: any live task with a null `task_type_id` received
its own workspace's `delivery` row; tasks already carrying `page` (or any
other type) were untouched.

## Client visibility (AS-060, AS-061)

`tasks.client_visible` — which already existed, defaults to `false`, and
is the single gate every client-callable RPC and portal query routes
through — remains the **sole** authority on whether the client can see a
task. `task_types.default_client_visible` contributes only the task's
*initial* `client_visible` value at the moment it is created; it is never
read again, and no portal or client-facing query consults it. Changing a
type's `default_client_visible` after the fact changes nothing about any
task already created with that type.

## Automatic typing (AS-063)

- `accept_client_request_atomic` types the task it creates
  `client_request`, unless the request's own `scope_verdict` is
  `change_request` — in which case the task is typed `change_request`.
  Both are resolved by the requesting workspace's `system_key`, never by
  name.
- The task is only ever created by `accept_client_request_atomic`
  (`raise_change_request_from_assumption_atomic` only creates the
  `client_requests` row that later gets accepted through the same path).

## Reporting (AS-062)

`rpc_project_time_totals(p_project_id)` returns tracked and estimated
minutes grouped by task type for a project — one row of numbers, no
charts, no trends. The number that matters is the QA share: if QA issue
minutes are a large fraction of a project's total, the last quote was too
tight.

## Out of scope — deliberately

- No label system. `tasks.tags text[]` is unrelated and unchanged.
- No triage rules or automation — typing a task is still a deliberate,
  manual choice (or the one automatic case above).
- No second axis (Area — which part of the site). If that is ever
  needed, it is a new column, not a widening of `system_key`.
- No `client_visible` column on `task_types`. Only
  `default_client_visible`, read once, at task insert.
