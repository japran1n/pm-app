# F003b: Move the three legacy portal routes inside the new shell

**Milestone:** M1
**Estimated worker time:** 1–1.5 h
**Depends on:** F003
**Opened by:** the orchestrator, from F003's own out-of-scope findings

## Why this exists

F003 moved the portal's chrome into
`app/(portal)/portal/[workspaceSlug]/p/[projectId]/layout.tsx`, because a
Next.js layout cannot read a descendant's route params. Correct decision
— but it leaves three routes stranded one level up, outside that layout:

- `portal/[workspaceSlug]/files/page.tsx`
- `portal/[workspaceSlug]/requests/page.tsx`
- `portal/[workspaceSlug]/t/[taskId]/page.tsx`

They now render with no sidebar and no topbar. A client who opens a task
from the overview lands on a page with no way back other than the browser
button. That is a live regression, not a cosmetic gap, and it should not
sit in the tree while five more features land on top of it.

`tests/e2e/portal-approve.spec.ts` is also stale against the new route
shape — F003 recorded it and left it.

## Assertion IDs covered

- AS-004: Navigating between portal views changes the URL and the browser back button returns to the previous view.
- AS-006: A team member who opens any portal URL is redirected into the team app instead of seeing the portal.

(Both are re-verified here for the relocated routes; the ID owners stay
F003.)

## Scope

1. **Relocate all three routes** under
   `p/[projectId]/`, so they inherit the shell:
   - `files` → `p/[projectId]/files`
   - `requests` → `p/[projectId]/requests`
   - `t/[taskId]` → `p/[projectId]/t/[taskId]`
   Keep each page's existing behaviour and queries; this is a move plus
   the param threading it needs, not a rewrite.
2. **Fix every internal link** that pointed at the old paths — the
   overview cards, the file list, the request list, the sidebar, and
   anything in `components/portal/*`.
3. **Redirects for the old paths.** A client may have an old URL open or
   bookmarked. Add small route handlers at the previous locations that
   resolve the client's project and redirect into the new path (when the
   client has exactly one portal-enabled project) or to the project
   chooser (when they have several). Do not 404 a URL that worked
   yesterday.
4. **Nav placement.** `files` and `requests` are not two of the eight
   views. `files` is reachable from Your site (F023) and `requests` from
   Scope & decisions (F016). Until those land, leave both out of the
   sidebar — reachable by link, not orphaned in the nav.
5. **Update `tests/e2e/portal-approve.spec.ts`** to the new route shape
   without weakening what it asserts.

## Files (approximate)

- `app/(portal)/portal/[workspaceSlug]/p/[projectId]/{files,requests,t}/…`
- `app/(portal)/portal/[workspaceSlug]/{files,requests,t}/…` (redirects)
- `components/portal/*` (links)
- `tests/e2e/portal-approve.spec.ts`

## Definition of done

- **Primary success test:** integration test — each relocated route
  returns 200 for a client of a portal-enabled project and renders
  inside the shell (the sidebar's nav landmark is present).
- **Failure test:** a team member hitting any of the three new paths is
  redirected into `/w/<slug>`; a client of a portal-disabled project
  gets 404.
- **Manual verification:** open a task from the overview — the sidebar
  and topbar are present, and the old URL still lands somewhere sensible
  rather than a 404.
- **Side-effect verification:** `npx tsc --noEmit` and eslint clean; no
  route in `app/(portal)` renders outside the shell any more — verify by
  listing every `page.tsx` under `app/(portal)` and checking each one's
  layout ancestry.
