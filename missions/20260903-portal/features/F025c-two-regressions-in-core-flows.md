# F025c: My remediation broke task creation, and an approval cannot notify

**Milestone:** M5 remediation — **blocker**
**Estimated worker time:** 2 h
**Opened by:** F025b's side-effect run

## Defect 1 — F020b's allow-list blocks the app's own writes

`20261017010000_f020b_projects_allowlist_guard.sql` raises
*"projects: task_counter cannot be changed directly (not an
allow-listed column)"* when `accept_client_request_atomic` inserts a
task, because the `tasks` insert trigger bumps `projects.task_counter`.

So accepting a client request — a core flow — now fails.

This is mine. F020b was my remediation for the eighth instance of the
missing-guard class, and its allow-list enumerated the columns a **human
member** may write without accounting for the columns the **application
itself** writes through triggers. An allow-list is only self-maintaining
for the case it was derived from, and I asked for it to be derived from
`pg_attrdef` defaults, which `task_counter` satisfies without being a
user-editable field.

The fix is not to widen the list by hand — that reintroduces the
enumeration this feature existed to remove. Distinguish the caller:
a trigger-driven internal write is not a member editing a project.
`F016j`'s equivalent guard on `client_requests` solved exactly this with
a transaction-local bypass flag for its legitimate SECURITY DEFINER
writers; read how, and apply the same idea rather than inventing a
third mechanism.

## Defect 2 — `notifications_kind_check` rejects what an approval writes

`decide_approval_atomic` inserts a notification whose `kind` is not in
`notifications_kind_check` (`20260823020000_create_notifications.sql`).
Deciding an approval therefore raises inside the RPC.

Check whether this fails the whole decision — if the insert is in the
same transaction, a client clicking Approve gets an error and nothing is
recorded, which is the worst outcome available. Establish that first,
then fix.

## Definition of done

- **Primary success test:** accepting a client request creates its task;
  deciding an approval records the decision and its notification.
- **Failure test:** a client or viewer still cannot write
  `task_counter`, `portal_enabled` or the baseline fields directly —
  F020b's actual purpose must survive intact.
- **Manual verification:** F016, F016b, F016j and F007's suites all pass,
  which they do not today.
- **Side-effect verification:** the self-maintaining property holds — a
  column added in a rolled-back transaction is still covered without
  editing the guard.
