# F006n: Five task RPCs any authenticated user can call

**Milestone:** M1 remediation, round 3 — **blocker**
**Estimated worker time:** 3 h
**Opened by:** F006l's class sweep, orchestrator-verified

## The defect

Five SECURITY DEFINER functions, each granted to `authenticated`, each
containing **zero** authorisation checks. Verified individually: no
`auth.uid()`, no `is_active_workspace_member`, no
`is_project_visible_to`, no `raise exception`.

| Function | Migration | What a caller gets |
|---|---|---|
| `bulk_delete_tasks_atomic` | 20260905070000 | delete any tasks by id |
| `duplicate_task_atomic` | 20260905060000 | duplicate any task |
| `restore_task_atomic` | 20260905080000 | restore any trashed task |
| `set_task_assignees_atomic` | 20260905050000 | reassign any task |
| `accept_client_request_atomic` | 20260905100000 | turn any client request into a task |

A caller needs only a task id, and PostgREST exposes every one of these
to any signed-in session.

## Why this is this mission's problem

All five predate the portal. Before it, "any authenticated user" meant
"a colleague" — these functions were written inside a trust boundary
where every account belonged to the agency, and the missing checks were
a latent bug rather than an exploitable one.

**The portal dissolves that boundary.** It puts external clients into
the workspace as authenticated users, by design. We are the ones moving
outsiders inside the perimeter these functions assume, so we are the
ones who have to close them. Shipping the portal on top of five
unguarded task RPCs would hand every client the ability to delete their
agency's tasks.

That is the argument for doing it here rather than filing it. It is not
scope creep; it is the cost of the feature we are building.

## Assertion IDs covered

None directly. This protects the mission's central premise — that a
client is a limited participant rather than a full one.

## Scope

1. Give each of the five real authorisation, matching what its own
   Server Action already checks. **Read the calling action first for
   each one** and mirror it; do not invent a bar. Where an action gates
   on project visibility as well as workspace membership, so must the
   function.
2. `accept_client_request_atomic` additionally needs the `portal_enabled`
   gate and the role bar — a client must never be able to accept their
   own request. Note that F016 (M3) will harden this function further
   for change-request pricing; leave its structure easy to extend and
   say in the handoff what you changed, so F016's worker is not
   surprised.
3. Add `revoke execute … from public` to each, following whatever the
   correctly-written functions in this repo do.
4. Tests call each of the five **directly through PostgREST** as: a
   client of the workspace, a viewer, a member of another workspace, and
   a legitimate caller. Four cases each. The legitimate case must still
   pass — these functions carry real features.
5. Check whether the same shape exists in any other RPC not yet swept,
   and list what you checked in the handoff. F006l's sweep found these
   five; say plainly whether you believe the list is now complete and on
   what basis.

## Definition of done

- **Primary success test:** each of the five rejects a client and a
  viewer calling it directly.
- **Failure test:** each of the five still works for its legitimate
  caller, exercised through the existing Server Action.
- **Manual verification:** `revoke` present on all five; the handoff
  states whether the sweep is now believed complete.
- **Side-effect verification:** the existing test suites for task
  delete, duplicate, restore, assignees and client-request acceptance
  all pass unchanged.
