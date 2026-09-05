# F009b: Two approval paths, one gate

**Milestone:** M2 remediation — security
**Estimated worker time:** 2.5 h
**Opened by:** the M2 gate, orchestrator-verified

## The defect

F009's plan entry said it "reuses and **replaces**"
`components/portal/approval-actions.tsx`. It did not. That component is
still wired at the portal task page
(`p/[projectId]/t/[taskId]/page.tsx:81`) and calls
`approve_portal_task_atomic` — whose gate contains **no**
`project_decision_owners` lookup at all. Verified: zero occurrences in
`20260905130000_approve_portal_task_atomic.sql`.

So a client who owns no decision type is refused with `42501` on the
Approvals view and **succeeds on the task page.** AS-022 holds on one
surface and not the other.

**How this got through, honestly:** F009's worker told me it kept the
component deliberately, because the task page's legacy
`pending_client_approval` toggle still uses it. That reasoning was
correct about why the file exists. I accepted it and recorded it as a
good call without checking whether the path it serves enforces the same
rule. The worker answered the question it was asked; I did not ask the
next one.

## Two more from the same gate

- **`subject_id` is validated only in TypeScript** (M2 report, F-1),
  giving a cross-project comment and flag write primitive through a
  SECURITY DEFINER function. A Zod schema is not an authorisation
  boundary.
- **`requestApproval` has no `portal_enabled` gate** (F-2), so an
  approval can be raised into a project the client cannot open — which,
  with no email in this mission, means it is raised into a void.

## Assertion IDs covered
- AS-022: A client who is not the named decision owner cannot record a decision, and the rejection is enforced server-side, not only by a disabled control.

## Scope

1. **One decision path.** Either route the task page's actions through
   `decide_approval_atomic`, or give `approve_portal_task_atomic` the
   same decision-owner and portal gates. Prefer the first — two
   functions that must agree forever is the shape this mission keeps
   getting caught by. If you choose the second, say why in the handoff.
2. Validate `subject_id` **in the database**: the subject must belong to
   the approval's project. In the RPC, not in Zod.
3. Gate `requestApproval` on `portal_enabled`.
4. Tests call every approval path directly as: the decision owner, a
   client who owns nothing, a client of another project, and a client of
   a portal-disabled project. Every path, every caller — the defect here
   is that one surface was tested and the other was not.

## Definition of done

- **Primary success test:** a client who owns no decision type is
  rejected on **both** the approvals view and the task page, proven by
  calling each path directly.
- **Failure test:** the decision owner still succeeds on both, and the
  legacy pending_client_approval toggle still works for what it is for.
- **Manual verification:** grep shows no remaining approval path that
  omits the decision-owner check.
- **Side-effect verification:** F007's and F009's tests pass unchanged.
