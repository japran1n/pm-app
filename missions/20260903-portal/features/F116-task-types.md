# F116: Task types — one honest taxonomy for agency work

**Milestone:** post-portal — **feature**
**Estimated worker time:** 3–4 h
**Assertions:** AS-056 … AS-063
**Opened by:** the user, after a Linear comparison

## Why

`task_types` (20260903040000) already exists as a workspace-owned,
single-select taxonomy on `tasks.task_type_id`, with an optional
`system_key` from a closed set (20260912010000). In practice only one
row is ever seeded — `page` — which exists solely to drive the portal
Pages view (`lib/queries/portal.ts:1745`).

So the mechanism is built and unused. This feature fills it.

The business question it answers, which the schema cannot answer today:
**how much of a project went into fixing our own mistakes.** We bill
websites and marketing sites from fixed quotes. If rework is 20% of
three projects running, the next quote is 20% short and nobody can prove
it. `time_entries` and `estimate_minutes` are already there; the missing
dimension is what kind of work the hours went into.

## The taxonomy — six types, one axis

The axis is **the nature of the work**, never the area of the site.
Do not add `component` / `content` / `seo` rows; they are a different
axis (which part of the site) and mixing the two is what makes
taxonomies rot. They stay in the check constraint so existing rows
survive, and they are not seeded.

| key | name | meaning | billable | default client_visible |
|---|---|---|---|---|
| `page` | Page | one page of the site we deliver — it has a URL | yes | true |
| `delivery` | Delivery | any other agreed-scope work with no URL of its own | yes | false |
| `qa` | QA issue | something we delivered does not work as agreed — **our fault** | **no** | false |
| `client_request` | Client request | client asks for something **after** delivery, small enough to absorb | yes | true |
| `change_request` | Change request | client asks for something outside agreed scope — goes to quote | yes | true |
| `improvement` | Improvement | our own idea; nobody asked | no | false |

### The separation rules, verbatim — these go in the docs file

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

## Scope

1. **Migration, forward-only.**
   - Widen `task_types_system_key_check` to add `delivery`, `qa`
     (already present), `client_request`, `change_request`,
     `improvement`. Keep `component`, `content`, `seo` in the check —
     dropping them would break existing rows. **Read the constraint's
     current definition before re-creating it**; this mission has lost
     work four times to a migration re-created from memory.
   - Add `task_types.is_billable boolean not null default true` and
     `task_types.default_client_visible boolean not null default false`.
   - Seed the six rows in `create_workspace_with_owner`, following the
     existing `on conflict (workspace_id, system_key) where system_key
     is not null do nothing` pattern already in that function.
   - **Backfill existing workspaces** — `create_workspace_with_owner`
     does not run retroactively, so this is a separate statement in the
     same migration. Existing workspaces get the five new rows.
   - **Backfill existing tasks**: any live task with a null
     `task_type_id` gets that workspace's `delivery` row (AS-057).
     Tasks already carrying the `page` type keep it.
   - **Lock the system flags** (AS-059): a trigger or a
     `with check` on the update policy must reject any write that
     changes `is_billable` or `system_key` on a row whose `system_key`
     is not null. Workspace-created types (system_key null) stay fully
     editable.

2. **Type becomes required.**
   - `task_type_id` required at creation in `lib/validation/tasks.ts`
     and in `lib/actions/tasks.ts` (AS-058). Decide deliberately whether
     to add a `not null` column constraint — the backfill makes it
     possible, but check every insert path first, including
     `create_project_from_template`, task templates, and recurrence
     generation. If any path cannot supply one, default it to
     `delivery` there rather than leaving the column nullable in
     practice.
   - The type picker (`components/task/list-task-type-select.tsx`,
     `components/task/task-detail-sheet.tsx`) shows no empty option.
     Each system type's one-line definition from the table above is its
     tooltip.

3. **Default visibility only (AS-060, AS-061).**
   `tasks.client_visible` — which already exists, defaults false, and is
   the gate every client-callable RPC routes through per f016d — stays
   the single authority. The type contributes `default_client_visible`
   as the *initial value at insert* and nothing else. There must be no
   read path anywhere that consults the type to decide portal exposure.
   Adding a second source of truth beside `tasks.client_visible` is the
   one thing this feature must not do.

4. **Automatic typing on the two existing paths (AS-063).**
   `accept_client_request_atomic` types its task `client_request`;
   `f016b_raise_change_request_from_assumption` types its task
   `change_request`. Both resolve the type by `system_key`, never by
   name.

5. **One report (AS-062).**
   An RPC in the shape of `rpc_project_time_totals`, returning tracked
   and estimated minutes grouped by task type for a project. One row of
   numbers in the project UI. No charts, no trends. The number that
   matters is the QA share.

6. **`docs/task-types.md`** — the table and the separation rules above,
   verbatim, as the thing a person reads in six months instead of
   reconstructing intent from a migration.

## Out of scope — deliberately

- No label system. `tasks.tags text[]` stays exactly as it is.
- No triage rules or automation.
- No second axis (Area). If it is ever needed it is a new column, not
  a widening of this one.
- No `client_visible` column on `task_types`. Only
  `default_client_visible`, and only read at insert.

## Definition of done

- All eight assertions AS-056…AS-063 have tests, in the style of the
  existing `tests/` files for this mission.
- A test proves AS-061 directly: a task of a type whose
  `default_client_visible` is true, but whose own `client_visible` is
  false, is absent from every portal response.
- A test proves AS-059: an update attempting to flip `is_billable` on a
  system-key row is rejected.
- The backfill is verified against a workspace created before this
  migration, not only a fresh one.
- Existing tests still pass — in particular the portal Pages view, which
  depends on the `page` system key this migration touches.
