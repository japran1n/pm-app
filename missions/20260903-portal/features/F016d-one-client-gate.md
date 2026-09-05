# F016d: One gate for every client RPC, and the client_requests columns nobody re-read

**Milestone:** M3 remediation
**Estimated worker time:** 2.5 h
**Opened by:** the M3 gate, orchestrator-verified

## Defect 1 — `flag_assumption_atomic` checks three gates of four

It verifies client-ness, project visibility and `portal_enabled`, and
never `client_visible` — the one gate the table's own SELECT policy
applies. Verified: zero occurrences in the function body.

**This is the fifth time in this mission that a gate has been applied in
some places and forgotten in another.** F006b (reads), F006i (writes),
F006k (a new column), F006l (paths that bypass RLS), F009b (a second
approval path) — and now this. Every individual instance was fixed
correctly and the class kept producing new instances, because the gate
is a checklist a human has to remember at each new call site.

So the fix here is not another patch.

## Scope 1 — make the gate a thing you call, not a thing you remember

Extract a single predicate — `client_may_act_on(project_id, ...)` or
whatever the existing naming convention supports — that encapsulates the
full client gate: active membership, `client` role, `portal_enabled`,
project visibility, and where a subject row is involved, its
`client_visible`. Then make **every** client-callable RPC in this
mission call it: `mark_deliverable_delivered_atomic`,
`flag_assumption_atomic`, `decide_approval_atomic`,
`approve_portal_task_atomic`, `request_portal_task_changes_atomic`,
`accept_client_request_atomic`'s client-facing branch.

Where a function needs a subset, it passes flags rather than
reimplementing the parts it wants. The goal is that there is exactly one
place left where this can be got wrong, and adding a new client RPC
without the gate becomes visibly odd rather than invisibly normal.

If some function genuinely cannot use it, say which and why in the
handoff — that answer is more valuable than a forced refactor.

## Defect 2 — fifteen new columns, zero policy changes

F016 added fifteen columns to `client_requests` and changed no policies.
The author-UPDATE policy pins five columns and leaves the client able to
write `quoted_amount`, `client_decision` and `decided_by`.

AS-047 still holds — the acceptance gate reads its values elsewhere — but
a client being able to write their own quote's price and approval state
is not something to leave standing on the basis that the gate happens to
read from somewhere else today.

## Scope 2

Pin every column a client must not write, in the policy, by name. Follow
F006k's `projects` trigger if a policy cannot express it. Then check the
same question for every table this mission has added columns to since
F006k's sweep — that sweep was run before M3 existed.

## Definition of done

- **Primary success test:** a client cannot write `quoted_amount`,
  `client_decision` or `decided_by` on their own request, called
  directly through PostgREST.
- **Failure test:** `flag_assumption_atomic` refuses an assumption with
  `client_visible = false`; every other client RPC still admits its
  legitimate caller.
- **Manual verification:** the handoff lists every client-callable RPC
  and whether it now routes through the shared predicate.
- **Side-effect verification:** M2's and M3's existing RPC tests pass
  unchanged.
