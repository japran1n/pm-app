# F015: Scope, decisions and assumptions — both sides

**Milestone:** M3
**Estimated worker time:** 2.5–3 h
**Depends on:** F012

## Assertion IDs covered
- AS-043: A project can record scope items marked as included or excluded, each with its source.
- AS-044: A project can record decisions with a rationale, type, date and client-visibility flag.
- AS-045: A decision marked not client-visible is absent from every portal response.
- AS-046: A project can record assumptions with a confirmation state, and the client can flag one as incorrect from the portal.

## Scope

### 1. Team side — one panel, three tabs

A "Record" panel in the project: Scope · Decisions · Assumptions.
Inline add and edit, `client_visible` toggle per row, no separate detail
pages. These are one-line artefacts; a dialog per row would guarantee
nobody writes them.

**Create a decision from a comment.** A decision is almost always born
inside a discussion, and retyping it is the step where the practice dies.
Add "Turn into decision" to the comment menu
(`components/task/comment-list.tsx`), carrying the comment text, its
author and its date into the new row with the task's phase attached.
This one affordance decides whether the decision log gets used at all.

### 2. Portal side — the Scope view

Replaces the stub at `p/[projectId]/scope/page.tsx`:

- **In the signed scope** and **Not included**, side by side. An
  excluded item added by a change request shows which one.
- **Change requests** table — estimate, price, state. Reads
  `client_requests`; F016 fills the pricing columns, so until it lands
  render only what exists rather than empty money columns.
- **Decision log** — title, rationale, type chip, date. Newest first.
- **Assumptions** — each with its state, and a **"Not correct"** button
  on unconfirmed ones.

### 3. The "Not correct" path

`flag_assumption_atomic(assumption_id, note)`:
- callable by a client of that project only;
- writes `flagged_by_client_at` and `flagged_note`;
- does **not** change `state` — invalidating an assumption is the
  team's call after they read the note;
- writes an audit row and a team notification.

Team side: a flagged assumption is highlighted in the panel with a
"Raise a change request from this" action that opens F016's dialog
pre-filled with the assumption's text and the client's note. This is the
process rule — *an assumption that turns out wrong is a change request,
not a surprise* — made mechanical.

### 4. Copy that carries the point

Under the assumptions list in the portal, one line: "An assumption that
turns out wrong becomes a change request — not a surprise two weeks
before launch." It tells the client why the list exists and why flagging
one early is in their interest.

## Files (approximate)

- `components/project/record-panel.tsx` (+ three tab components)
- `components/task/comment-list.tsx`
- `app/(portal)/portal/[workspaceSlug]/p/[projectId]/scope/page.tsx`
- `components/portal/{scope-lists,decision-log,assumption-list}.tsx`
- `lib/actions/project-records.ts`, migration for `flag_assumption_atomic`

## Definition of done

- **Primary success test:** integration — a decision with
  `client_visible = false` is absent from the portal query; the same row
  is visible to the team.
- **Failure test:** a client calling `flag_assumption_atomic` for a
  project they are not a member of is rejected; flagging never changes
  `state`.
- **Manual verification:** "Turn into decision" from a comment produces
  a row carrying the comment's text, author and date.
- **Side-effect verification:** the comment menu's existing items still
  work; `tsc` and eslint clean.
