# F006k: A client can turn their own portal on

**Milestone:** M1 remediation, round 2 — **blocker, and this mission caused it**
**Estimated worker time:** 2 h
**Opened by:** F006i's write-side sweep, orchestrator-verified

## The defect

`projects_update_active_members`
(`supabase/migrations/20260818004709_rls_projects.sql:45`) allows **any
active workspace member** to UPDATE **any column** of any project in
their workspace:

```sql
using (deleted_at is null and public.is_active_workspace_member(workspace_id))
with check (public.is_active_workspace_member(workspace_id))
```

There is no role gate. `client` and `viewer` are active workspace
members. The policy was written when the only editable fields were name,
description and dates (AS-029 of an earlier mission), and a trigger was
later added to guard `visibility` specifically — so the shape was
understood and defended once, for one column.

**Then F001 added `portal_enabled` to this table.** Nobody extended the
trigger.

The consequence undoes three features of work: a client can call
PostgREST directly and set `portal_enabled = true` on any project in the
workspace, then read that project's phases, tasks, pages and requests
through the very gate F006b, F006h and F006i exist to enforce. They can
also rewrite `target_launch_date`, `launch_confidence` and `launch_note`
— the fields the portal presents as the agency's own commitments.

This is not a pre-existing bug we inherited. The policy was adequate for
the columns it was written for; this mission added a security-critical
column to a table whose write policy it never re-read.

## Assertion IDs covered
- AS-007: A client whose project has `portal_enabled = false` receives a 404 for that project's portal routes, and its rows are not returned by any portal query.

## Scope

1. **Gate the columns, not just the table.** Follow the existing
   `visibility` trigger's shape: a `before update` trigger that rejects
   a change to `portal_enabled`, `portal_enabled_at`,
   `target_launch_date`, `launch_confidence` or `launch_note` unless the
   caller's role permits it. Read that trigger first and match it —
   there is no reason for two different mechanisms guarding two sets of
   columns on one table.
2. **Decide the role bar deliberately and say why in the handoff.**
   `portal_enabled` decides what an external party can see; it belongs
   with owner/admin, not with any member. The launch fields are ordinary
   project management and belong with writers. Do not give them all the
   same bar just because one trigger covers them.
3. **Sweep the same question across every column this mission has added
   to an existing table**, not only `projects`: `tasks.phase_id`,
   `tasks.page_slug`, `tasks.page_order`,
   `project_statuses.client_description`, `project_statuses.client_bucket`,
   `task_types.system_key`, `docs.client_visible` when it lands. For
   each, name the policy that governs writes to it and whether that
   policy's role bar is right for what the column now means. Table in
   the handoff, one row per column.
4. Tests call PostgREST **directly as a client and as a viewer**, for
   every column in the sweep. This defect exists because nobody tested
   the write path of a column added to an old table.

## Definition of done

- **Primary success test:** a `client` and a `viewer` are rejected when
  setting `portal_enabled` on any project, called directly.
- **Failure test:** an owner or admin can still set it, and an ordinary
  member can still edit a project's name — the AS-029 behaviour the
  original policy exists for must survive.
- **Manual verification:** the sweep table in the handoff covers every
  column this mission has added to a pre-existing table.
- **Side-effect verification:** project editing, archiving and the
  visibility trigger all still behave as before.
