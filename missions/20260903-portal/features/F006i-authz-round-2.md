# F006i: Authorisation, round two

**Milestone:** M1 remediation, round 2
**Estimated worker time:** 2.5 h
**Opened by:** the M1 re-scrutiny

## The defects

1. **`seed_default_phases` fixed the role half and left the visibility
   half open** (`20260914010000:61`). The Server Action requires both
   `requireWrite` and `requireVisibility`; only the role check was
   ported into the function body. A workspace `member` or `guest` who is
   not in `project_members` of a **private** project can call the RPC
   directly and insert ten phases — and `client_visible` defaults true,
   so they render in that project's client portal.

2. **`client_requests` UPDATE and DELETE author policies are still
   ungated on `portal_enabled`**, contradicting F006b's own migration
   comment claiming the direct PostgREST path was closed.

3. **`assert_portal_task_actionable_by_client`
   (`20260906010000:35-80`) has no `portal_enabled` check** — a client
   of a disabled project can still flip `pending_client_approval`.
   F006b's audit was scoped to reads, so writes were never swept.

4. **`create_channel_atomic` has no authorisation at all**
   (`20260914010000:108-137`): SECURITY DEFINER, granted to
   `authenticated`, two unguarded INSERTs on caller-supplied
   `workspace_id`, `created_by` and `member_ids`.

   This is **pre-existing** — the original `20260905090000` has only a
   comment mentioning `auth.uid()`, never a check. But this mission
   re-created the function twice, the second time under a banner reading
   "authz gaps", without noticing. Verified by reading both migrations.

   Any authenticated user can create a channel in any workspace and add
   arbitrary members to it. Fix it here rather than filing it: we are
   the ones holding the file open.

## Scope

1. Port the visibility half of the check into `seed_default_phases`,
   matching what the Server Action requires.
2. Gate `client_requests` UPDATE and DELETE on `portal_enabled`.
3. Add the `portal_enabled` check to
   `assert_portal_task_actionable_by_client`.
4. Give `create_channel_atomic` real authorisation: the caller must be
   an active non-client member of `p_workspace_id`, `p_created_by` must
   equal `auth.uid()`, and every id in `p_member_ids` must be a member
   of that workspace. Follow whatever the equivalent guarded RPC in this
   repo does — find one with a grep before choosing a shape.
5. **Then sweep the write side**, as F006b swept the read side: every
   RPC and policy a client can reach, checked for `portal_enabled` and
   for role. List them in the handoff with a tick each.

## Definition of done

- **Primary success test:** each of the four defects has a test that
  calls the RPC or policy **directly**, as the attacker would, not
  through the UI.
- **Failure test:** an authenticated user who is not a member of a
  workspace cannot create a channel in it.
- **Manual verification:** the write-side sweep list is in the handoff.
- **Side-effect verification:** channel creation, client requests and
  portal approvals all still work for legitimate callers.
