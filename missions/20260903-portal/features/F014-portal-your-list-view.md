# F014: Portal — Your list view, and the risk banner it feeds

**Milestone:** M3
**Estimated worker time:** 2.5 h
**Depends on:** F012, F013, F006 (the banner component)

## Assertion IDs covered
- AS-029: The portal Your list view shows delivered-and-accepted items separately from open and past-due items.
- AS-030: An item the client has uploaded remains counted as outstanding until a team member accepts it.
- AS-031: A blocking deliverable that is past its due date is surfaced on the portal overview, not only inside its own view.

## Scope

Replaces the stub at `p/[projectId]/your-list/page.tsx`.

### 1. Progress header

"N of M delivered" with a four-segment bar: accepted, still open, past
due — each with its count in text. Same `status-distribution` component
F005 built; do not write a second one.

### 2. Two lists, in this order

**Past due and upcoming** first, sorted by due date ascending, each row
carrying a left rule in the blocked or waiting token, the owner name,
and — the column that does the work — **what it holds up**, taken from
the linked task and its phase. "Holds up build of /blogg" is a sentence
that gets a file sent; "Due 6 Nov" is not.

**Delivered and accepted** second, muted, with the acceptance date.

A returned item shows the team's `review_note` inline. The client must
be able to see why something came back without asking.

### 3. Upload

Reuse `components/task/attachment-dropzone.tsx` and the existing storage
bucket and policies. Uploading sets state to `delivered` — never to
`accepted`. The row stays in the outstanding list with a "waiting for us
to check it" line, which is honest and also stops the "I sent it, why is
it still red" conversation.

### 4. The risk banner

Wire F006's dormant banner: renders when at least one blocking
deliverable is past due, naming the worst one and what it moves.

Write the copy plainly and without blame — "The Blogg page cannot be
built without its copy, and 18 Nov moves with it" — because this banner
is the one place in the portal allowed to be uncomfortable, and it only
works if it reads as information rather than as an accusation.

### 5. Badges

The sidebar's Your list badge (AS-003) goes live here.

## Files (approximate)

- `app/(portal)/portal/[workspaceSlug]/p/[projectId]/your-list/page.tsx`
- `components/portal/{deliverable-row,deliverable-upload}.tsx`
- `components/portal/risk-banner.tsx`
- `lib/actions/portal-deliverables.ts`

## Definition of done

- **Primary success test:** integration — an uploaded item moves to
  `delivered`, stays in the outstanding list and in the badge count, and
  leaves both only when the team accepts it.
- **Failure test:** a client cannot set a deliverable to `accepted`
  through any path, including calling the action directly.
- **Manual verification:** the banner appears only with a real overdue
  blocking item, and both themes read correctly.
- **Side-effect verification:** the overview renders unchanged when
  nothing is overdue — no empty banner shell.
