# F016b: Turn a wrong assumption into a change request

**Milestone:** M3 — small, and deferred twice already
**Estimated worker time:** 1 h

## Why this is its own feature now

F015 deferred it because F016's dialog did not exist yet. F016 deferred
it because it needs a team-write authorisation surface its own spec did
not name. Both refusals were correct in isolation. Together they are how
a small piece of connective tissue disappears from a project — each
feature declines it for a locally sound reason and nobody owns it.

So it gets its own feature rather than a third mention in someone
else's prompt.

## What it is

On a `project_assumptions` row the client has flagged as incorrect, a
team-side action that opens F016's quote dialog pre-filled with the
assumption's text and the client's note, creating a `client_requests`
row with `kind = 'change'` and `scope_verdict = 'change_request'`.

This is the Good Guys process rule — *an assumption that turns out wrong
is a change request, not a surprise* — made mechanical. Without it the
rule stays a sentence in a document, which is where it currently lives
and why it is currently not followed.

## Scope

1. The action, on the team's Record panel (F015), on flagged
   assumptions only.
2. Pre-fill: the assumption text, the client's `flagged_note`, the
   project, and a link back to the assumption row so the resulting
   request carries its origin.
3. Authorisation: the same bar as creating a client request by hand.
   Read what F016's own triage path requires and match it — do not
   invent a new surface, which is the reason this was deferred.
4. When the change request is later approved, the originating assumption
   moves to `invalidated` — the team's call, made explicit by the
   approval rather than by a separate edit.

## Definition of done

- **Primary success test:** flagging an assumption then raising a change
  request from it produces a request carrying the text and the note,
  linked to the assumption.
- **Failure test:** the action is unavailable on an unflagged assumption
  and rejected for a role that cannot create client requests.
- **Manual verification:** approving that change request moves the
  assumption to invalidated.
