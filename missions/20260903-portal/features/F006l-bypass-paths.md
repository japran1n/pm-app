# F006l: The paths that never reach RLS

**Milestone:** M1 remediation, round 3 — **blocker**
**Estimated worker time:** 3 h
**Opened by:** the third M1 scrutiny, orchestrator-verified

## The class, not the four instances

Three sweeps have now closed the `portal_enabled` gate: F006b swept
reads, F006i swept writes, F006k gated the column itself. The RLS policy
matrix is clean — the third review reproduced it in full and found no
hole in it.

Every remaining gap is in code that **never reaches RLS**: SECURITY
DEFINER functions and Server Actions that use the service-role client.
Each sweep asked "is the policy right?", and the answer was yes each
time, because the vulnerable paths do not consult a policy at all.

That is the finding. The four instances below are how it shows up.

## The four

1. **`decide_approval_atomic`**
   (`20260916010000_approval_requests.sql:348-479`, granted to
   `authenticated`) checks the decision-owner row and nothing else. No
   `portal_enabled`, no project visibility, no `client_visible` on the
   subject. A client of a portal-disabled project can settle an
   approval, clear `pending_client_approval`, and read back `state` and
   `decided_at`. Verified: zero occurrences of any of those checks in
   the function body.

2. **`get_open_task_counts`**
   (`20260905010000_perf_task_count_rpc.sql:22-37`) is SECURITY DEFINER
   with **no authorisation check of any kind** and no `revoke … from
   public`. Verified: zero occurrences of `auth.uid`,
   `is_active_workspace_member` or `revoke`. `projects_select_active_members`
   hands a client every project id in the workspace, and this RPC then
   returns open-task counts for a portal-off project, counting tasks
   that are not client-visible.

3. **`addComment` (`lib/actions/comments.ts:136`)** inserts through the
   admin client. Its compensating checks cover membership,
   `client_visible` and project visibility — but not `portal_enabled`.
   Worse, `requestPortalTaskChanges`
   (`lib/actions/portal-approval.ts:183`) calls it **before** the gated
   RPC, so on a portal-off project the comment lands and only then does
   the RPC reject. The ordering was deliberate — an earlier mission
   fixed a bug by posting the comment first — so fix the gate, not the
   order, and leave that behaviour intact.

4. **`getAttachmentSignedUrl` (`lib/actions/attachments.ts:220-222`)**
   mints the URL with `admin.storage`, bypassing the gated storage
   policy entirely. Same missing check.

## Assertion IDs covered
- AS-007: A client whose project has `portal_enabled = false` receives a 404 for that project's portal routes, and its rows are not returned by any portal query.

## Scope

1. Fix the four.
2. **Then sweep the class properly**, which is the point of this
   feature. Enumerate:
   - every SECURITY DEFINER function granted to `authenticated`, with
     the authorisation it performs internally;
   - every Server Action that touches `ctx.admin` or an admin client,
     with the compensating checks it performs.
   For each, state whether a client of a portal-disabled project can
   reach it and what they get. Table in the handoff, one row per
   function. This is the sweep the three previous ones structurally
   could not perform.
3. Where a check is repeated in more than two places, extract it —
   `is_project_portal_enabled` already exists; use it rather than
   inlining the same subquery a fifth time.
4. Tests call each RPC and Server Action **directly** as a client of a
   portal-disabled project.

## Definition of done

- **Primary success test:** a client of a portal-disabled project is
  rejected by all four paths, called directly.
- **Failure test:** the legitimate flows still work — an owner decides
  an approval, the board's task counts still render, a portal comment
  still posts before its RPC on an enabled project, and an attachment
  URL is still minted for a permitted client.
- **Manual verification:** the class sweep table is in the handoff and
  covers every SECURITY DEFINER function granted to `authenticated`.
- **Side-effect verification:** `migrations:check` clean; no legitimate
  path regressed.
