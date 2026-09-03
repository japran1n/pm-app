# F005: Portal — Pages view

**Milestone:** M1
**Estimated worker time:** 2–3 h
**Depends on:** F001 (`page_slug`, `page_order`), F003 (shell), F004 (StatusPill)

## Assertion IDs covered
- AS-014: The portal Pages view lists every client-visible task of type `page` for the project, ordered by the page order defined by the team, not by creation date.
- AS-016: Hovering a page status reveals a client-facing explanation of that status.
- AS-017: The Pages view shows a distribution bar summarising how many pages are waiting on the client, in progress, blocked, and ready to launch, with each count also stated in text.
- AS-018: Filtering the pages table by status hides non-matching rows without a page reload.

## Scope

### 1. Query

`getPortalPages(projectId)` in `lib/queries/portal.ts` — client-visible
tasks whose task type is the seeded `page` type, with status (name,
bucket, client description), assignee (name, avatar, role label),
`page_slug`, `page_order`, `updated_at`. Ordered by `page_order` nulls
last, then title. One batched `resolvePeople` call, matching the
convention in `lib/queries/templates.ts` — no N+1.

### 2. Distribution bar

`components/portal/status-distribution.tsx` — a single horizontal bar
of four segments with a 2px gap between them, plus a key beneath where
each bucket shows its **count as a number and its name as text**. State
must never be carried by colour alone.

Segments with a zero count are omitted from the bar but still listed in
the key as `0`.

### 3. Table

`components/portal/pages-table.tsx` (client component, receives typed
props):

| Page | Status | Who has it | Updated |
|---|---|---|---|

- Page cell: title plus slug in the mono label style.
- Status cell: `StatusPill` from F004.
- Who has it: `UserAvatar` + name + role, muted.
- A status filter select above the table filtering client-side.

Empty state via `EmptyState` when the project has no client-visible
pages: "No pages have been shared with you yet."

### 4. "How a page travels"

A static seven-step strip below the table, from the prototype: In
design → Waiting on you → In build → QA · development → QA · design →
Ready to launch → Live. The client's own step is visually distinguished
using the waiting token. Copy comes from the prototype verbatim.

### 5. Team side

In `components/task/task-detail-sheet.tsx`, for tasks whose type is
`page`, expose `page_slug` and `page_order` as editable fields. Reuse
the sheet's existing inline-edit pattern; do not build a new one.

## Files (approximate)

- `app/(portal)/portal/[workspaceSlug]/p/[projectId]/pages/{page,loading}.tsx`
- `components/portal/{pages-table,status-distribution}.tsx` (new)
- `lib/queries/portal.ts`
- `components/task/task-detail-sheet.tsx`
- `lib/actions/tasks.ts` (page fields)

## Definition of done

- **Primary success test:** integration test — a project with pages in
  four different buckets renders the right counts, and a task that is
  not client-visible appears in neither the table nor the counts.
- **Failure test:** a page task belonging to another project, or to a
  portal-disabled project, is absent.
- **Manual verification:** filtering by "Waiting on you" leaves only
  those rows, without a network request; both themes legible.
- **Side-effect verification:** `npx tsc --noEmit` clean; the task
  detail sheet still works for non-page tasks, with the new fields
  hidden.
