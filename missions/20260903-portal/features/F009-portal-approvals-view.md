# F009: Portal — Approvals view

**Milestone:** M2
**Estimated worker time:** 2.5–3 h
**Depends on:** F007, F008

## Assertion IDs covered
- AS-021: The portal shows every open approval request for the client's projects, with what is being approved, who must decide, and its due date.
- AS-022: A client who is not the named decision owner cannot record a decision, enforced server-side.
- AS-023: Approving a request records the decider, timestamp and decision in one transaction and clears the linked task's pending-approval flag.
- AS-026: The portal shows the full decision history for the project, including who decided and when.

## Scope

Replaces the `PortalComingSoon` stub at
`p/[projectId]/approvals/page.tsx`.

### 1. Open approvals

Cards in the prototype's shape: kind eyebrow, title, due chip (blocked
token when overdue, waiting token otherwise), body text, then Approve /
Request changes / open-artifact link.

- "Request changes" opens a required-comment field. An empty note is
  rejected by the RPC anyway (F007), but the client should never reach
  that error — the form asks first.
- A client who is not the decision owner sees the buttons disabled with
  a line naming who decides. **This is presentation only**; the RPC is
  the control.
- After a decision the card settles in place, showing what was decided
  and when. Do not remove it from the page on success — a client who
  clicks Approve and watches the card vanish cannot tell success from a
  crash.

Reuse and then delete `components/portal/approval-actions.tsx`, whose
task-boolean path this supersedes. Its test file
(`approval-actions.test.tsx`) must be carried over, not dropped.

### 2. Decision history

A table: what, decision type, decided by, outcome chip, date, and the
note. Ordered newest first. This is the record that ends "I never
approved that" — it is worth more than the open list.

### 3. Who approves what

The four decision types with their named owner, from
`project_decision_owners`. When a type has no owner, say so plainly
rather than showing an empty cell.

### 4. Badges and overview

- `getPortalBadgeCounts` now returns the real awaiting count (F007) —
  the sidebar badge (AS-002) goes live here.
- The overview's waiting strip switches from
  `tasks.pending_client_approval` to `approval_requests`, without
  changing `PortalOverviewLive`'s component shape.

## Files (approximate)

- `app/(portal)/portal/[workspaceSlug]/p/[projectId]/approvals/page.tsx`
- `components/portal/{approval-card,approval-history,decision-owners-grid}.tsx`
- `components/portal/portal-overview-live.tsx`
- `lib/actions/portal-approval.ts` (route to `decide_approval_atomic`)

## Definition of done

- **Primary success test:** integration — the decision owner approves
  from the portal; the row settles, the linked task's flag clears, the
  history shows the decision, and the sidebar badge drops by one.
- **Failure test:** a client who is not the owner calling the action
  directly is rejected by the RPC, and no row changes.
- **Manual verification:** both themes; an overdue approval reads as
  overdue; the settled card stays on the page.
- **Side-effect verification:** the carried-over approval-actions tests
  still pass; the overview strip renders the same shape as before.
