# F025d: The same bug F025c fixed, on the other branch

**Milestone:** final remediation — **blocker**
**Estimated worker time:** 1.5 h
**Opened by:** the final gate's guard review

## The defect

`projects_assign_key` is a BEFORE INSERT trigger
(`20260819061129_project_keys_and_task_numbers.sql:196-200`) whose body
(`20260819061442:33-45`) populates `projects.key`. The column's schema
default is `''` (`20260819061442:26-27`).

`key` appears in none of the four tiers of the allow-list
(`20261019010000_f025c:70-73`). So on INSERT the guard compares
`NEW.key` — already populated, because Postgres fires same-timing row
triggers in name order and `projects_assign_key` sorts before
`projects_enforce_field_role_allowlist` — against the default `''`,
finds them distinct, and raises 42501.

**Any project creation through an authenticated session fails**, and
`projects_insert_active_members` grants exactly that to every active
workspace member over PostgREST.

## Why nobody noticed

Two independent masks, and both are worth recording because they are the
reason a blocker sat in main:

- **In the product**, `lib/actions/projects.ts:124` creates projects with
  the service-role client, and the guard's first branch exempts
  `service_role`. The shipped UI path never touches the defect.
- **In CI**, the only INSERT test
  (`tests/integration/f020b-projects-allowlist-guard.test.ts:229-236`)
  asserts `expect(error).not.toBeNull()` for a client inserting
  `baseline_frozen_at`. It passes whether the error is the intended
  baseline rejection or this one. And the suite's own fixture project is
  created with the admin client, so no test ever performs a clean
  authenticated INSERT.

That second mask is the eighth vacuous test in this mission: an
assertion that any error satisfies cannot distinguish the error it names
from the one it accidentally causes.

## Scope

1. Fix it the way F025c fixed the UPDATE branch: wrap
   `assign_project_key()`'s assignment in the
   `app.projects_field_guard_bypass` flag, rather than adding `key` to
   the allow-list by hand. The bypass is the mechanism for "the
   application wrote this, not a person"; widening the list re-opens the
   enumeration problem the inversion existed to close.
2. **Audit every other BEFORE INSERT and BEFORE UPDATE trigger on
   `projects`, `client_requests` and `approval_requests`** for the same
   shape — a trigger that populates a column the guard does not
   allow-list. Two of these were found by accident; find the rest on
   purpose. List what you checked.
3. Fix the test: assert the specific error, not merely that an error
   occurred. Then add a clean authenticated project INSERT test, which
   is the case no test currently covers.

## Definition of done

- **Primary success test:** an ordinary workspace member creates a
  project over PostgREST, as an authenticated session, and it succeeds.
- **Failure test:** a client and a viewer still cannot write
  `portal_enabled`, `baseline_frozen_at` or `task_counter` directly, and
  the guard remains self-maintaining.
- **Manual verification:** the trigger audit in the handoff covers all
  three guarded tables.
- **Side-effect verification:** F020b's, F025c's and the project
  creation suites pass.
