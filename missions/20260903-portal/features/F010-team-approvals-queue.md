# F010: Team UI — the approvals queue

**Milestone:** M2
**Estimated worker time:** 2 h
**Depends on:** F007, F008

## Assertion IDs covered
- AS-027: The team app has a queue listing every open approval request across projects, ordered by how long it has been waiting.

## Why this one matters more than it looks

Email is out of scope for this mission (see `description.md`). That
removes the portal's only push channel: nothing reaches the client
unless they open the portal, and nothing tells the team that a client
has gone quiet. This queue is the entire escalation mechanism that
remains. Build it as the thing a PM checks every morning, not as a
report.

## Scope

`/w/[workspaceSlug]/approvals` — a workspace-wide list.

### 1. Ordering

By **how long it has been waiting**, longest first. Not by due date,
not by project. The oldest untouched request is the one costing money.

### 2. Columns

What · project · decision type · who must decide · waiting for (days,
with the blocked token past the due date) · what it blocks.

"What it blocks" is the column that earns the screen: for a
`subject_type = 'task'` approval, name the task and its phase; a phase's
name is enough to say "page design is stopped here". Derive it, do not
ask the PM to type it.

### 3. Actions

- **Withdraw** — pulls the request (state `withdrawn`), for when the
  team changes its mind before the client answers.
- **Copy link** — the direct portal URL for that approval, so a PM can
  paste it into whatever channel they actually talk to the client on.
  With no email, this is how a reminder gets sent, and it should be one
  click.

Do not build a "remind" button that pretends to send something. A
control that looks like it notifies and does not is worse than no
control.

### 4. Summary strip

Three figures at the top: open approvals, the oldest one's age, and how
many are past their due date. The last two are the numbers that make a
PM act.

### 5. Nav

Add the route to the workspace sidebar (`components/nav/app-sidebar.tsx`)
with a count badge, following whatever badge convention that sidebar
already uses.

## Files (approximate)

- `app/(workspace)/w/[workspaceSlug]/approvals/{page,loading,error}.tsx`
- `components/approvals/approvals-queue.tsx`
- `components/nav/app-sidebar.tsx`
- `lib/queries/approvals.ts`

## Definition of done

- **Primary success test:** integration — the queue returns open
  requests across several projects of the workspace, oldest first, and
  excludes settled ones.
- **Failure test:** a `client` role hitting `/w/<slug>/approvals` is
  redirected out, as every other workspace route does.
- **Manual verification:** withdraw settles the row and it leaves the
  queue; copy link yields a URL that opens that approval in the portal.
- **Side-effect verification:** `tsc` and eslint clean; the sidebar
  badge does not double-count withdrawn rows.
