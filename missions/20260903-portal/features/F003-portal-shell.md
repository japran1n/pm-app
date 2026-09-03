# F003: Portal shell — sidebar, topbar, eight routes

**Milestone:** M1
**Estimated worker time:** 2–3 h
**Depends on:** F001 (`portal_enabled`, launch fields)

## Assertion IDs covered
- AS-001: The client portal renders a persistent left sidebar listing Overview, Approvals, Your list, Pages, Hours, Results, Scope & decisions, and Your site.
- AS-004: Navigating between portal views changes the URL and the browser back button returns to the previous view.
- AS-005: The portal header displays the project's target launch date and its current launch confidence.
- AS-006: A team member who opens any portal URL is redirected into the team app instead of seeing the portal.

## Scope

The prototype's shell, rebuilt with this app's components.

### 1. Layout

`app/(portal)/portal/[workspaceSlug]/layout.tsx` — replace the current
centred `max-w-5xl` top-nav shell with a two-column grid:

- **Sidebar** (fixed width, sticky, own scroll): `WorkspaceLogo` + name +
  "Client portal"; a project card naming the current project; the eight
  nav items; a footer with the signed-in client's name, `ThemeToggle`,
  and the existing sign-out form.
- **Main**: sticky topbar (breadcrumb eyebrow, view title, launch-date
  chip, launch-confidence chip) over the view container.

Keep every existing guard in this layout unchanged: unauthenticated →
`/sign-in`, unknown workspace → `notFound`, non-client role →
redirect to `/w/<slug>`. AS-006 is already satisfied by
`canViewClientPortal`; this feature must not weaken it.

Below the app's `md` breakpoint the sidebar becomes a horizontal
scrolling nav above the content.

### 2. Project scope

The portal is currently workspace-first with projects listed on the
landing page. The prototype is **project-first**. Resolve it this way:

- `/portal/<slug>` — if the client has exactly one portal-enabled
  project, redirect to that project's overview. If several, render the
  existing project cards as a chooser.
- All eight views live under `/portal/<slug>/p/<projectId>/…`, with
  `overview` as the index. Keep the existing `/p/<projectId>` route
  working by making it the overview.
- The sidebar's project card links back to the chooser when there is
  more than one project.

### 3. Nav and badges

`components/portal/portal-sidebar.tsx` (client component, `usePathname`
for `aria-current`, same approach as the existing `portal-nav.tsx`,
which this replaces).

Badge counts are computed in the layout (Server Component) by one query
and passed down as props: approvals awaiting this client, deliverables
past due. Until F007/F012 land, that query returns zeros — write it so
those features only change its body.

### 4. Route stubs

Create all eight routes. Anything not yet implemented renders
`EmptyState` with honest copy ("This section arrives with the next
release"), never a 404 and never fake data.

## Files (approximate)

- `app/(portal)/portal/[workspaceSlug]/layout.tsx`
- `app/(portal)/portal/[workspaceSlug]/p/[projectId]/{overview,approvals,your-list,pages,hours,results,scope,site}/page.tsx`
- `components/portal/portal-sidebar.tsx` (new), `portal-nav.tsx` (delete)
- `lib/queries/portal.ts` — `getPortalBadgeCounts(projectId)`

## Notes

- The prototype is the visual spec: sidebar item is a full-width row,
  active item is inverted (ink background, ground text), badge for
  overdue counts uses the blocked status token.
- Tokens only. Read `app/globals.css` before styling anything.

## Definition of done

- **Primary success test:** integration test — every one of the eight
  routes returns 200 for a client of a portal-enabled project and
  redirects a team member.
- **Failure test:** a client of a project with `portal_enabled = false`
  gets 404 on `/portal/<slug>/p/<id>/overview`.
- **Manual verification:** clicking through all eight views changes the
  URL; back returns; active item is highlighted; mobile width shows the
  horizontal nav.
- **Side-effect verification:** existing portal tests
  (`components/portal/*.test.tsx`) still pass, or are updated in this
  commit where the route shape genuinely moved.
