# F011: "Request changes" creates real work

**Milestone:** M2
**Estimated worker time:** 1.5–2 h
**Depends on:** F007, F009

## Assertion IDs covered
- AS-025: Requesting changes on an approval requires a comment and creates a task in the project carrying that comment.

## The failure this prevents

A client writes three paragraphs explaining what is wrong with a design.
Today that lands as a comment. Comments get read once, in a busy hour,
and then the work of turning them into something a designer will act on
depends on somebody remembering. The Good Guys process already has a
rule for this shape of problem — "if it is not in ClickUp it does not
exist" — and this feature is that rule, enforced.

## Scope

### 1. Extend `decide_approval_atomic`

When the decision is `changes_requested`, in the **same transaction**:

1. Insert a task in the approval's project:
   - title: `"Changes requested: <approval title>"`
   - description: the client's note, verbatim, attributed and dated
   - `phase_id`: the approval's phase
   - `task_type`: the subject task's type when there is one, else the
     project's default
   - assignee: the approval's `requested_by`
   - `client_visible`: **false by default.** The team decides what to
     show; a client's own words coming back at them as a visible task is
     a decision, not a default.
2. Link it: `approval_requests.resulting_task_id` (new column).
3. Post the note as a comment on the subject task as well, when the
   subject is a task — the existing behaviour (F024 of the prior
   mission) that people already rely on. Keep the ordering that mission
   fixed: comment first, then flags.

### 2. Rounds

The next approval raised for the same subject sets
`round = previous.round + 1` and `supersedes_id`. The portal's history
then reads as "round 2", which is information a PM needs and a client
respects.

At `round >= 3`, the team-side dialog (F008) shows a line suggesting
this may be a change request rather than feedback, with a link to raise
one. **Suggest only.** The tool does not get to decide that a client is
being unreasonable.

### 3. Portal side

The settled card names the task that was created — "We have logged this
as work" — without linking to it when it is not client-visible. The
client sees that their words became something, which is the whole point.

## Files (approximate)

- migration: `approval_requests.resulting_task_id`, RPC extension
- `lib/actions/approvals.ts`, `components/portal/approval-card.tsx`
- `components/approvals/request-approval-dialog.tsx`

## Definition of done

- **Primary success test:** integration — a `changes_requested`
  decision creates exactly one task carrying the note, linked back to
  the approval, in one transaction.
- **Failure test:** if the task insert fails, the decision does not
  land either — the client must never see "changes requested" recorded
  with no work created. Prove this with a forced failure.
- **Manual verification:** raising a second approval for the same
  subject shows round 2; at round 3 the dialog shows its suggestion.
- **Side-effect verification:** the existing request-changes comment
  behaviour and its tests still pass unchanged.
