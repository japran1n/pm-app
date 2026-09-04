# Demo script

A live route through the app after `npm run seed:demo`. Every account below
signs in at `http://localhost:3000/sign-in` on the **Password** tab with
password `Demo1234!`. Two workspaces exist: **Acme Studio** (a design/dev
agency, most of the story) and **Cedarwood Partners** (a smaller ops/finance
consultancy, used for the workspace-switch and client-boundary beats). Keep
this tight — it's a sequence to click through live, not a feature list.

## 1. Sign in as the owner, orient in Acme Studio

Sign in as **sasa@demo.test** (owner). Land on Acme Studio's dashboard.

- Point at the sidebar: five projects, each in a different state —
  **Website Redesign** (mid-flight, portal on), **Mobile App v2** and
  **Internal Tooling** (portal off — nothing to show a client yet),
  **Brand Refresh** (greyed out / in the archive), **Northwind Loyalty App
  — Phase 1** (finished).

## 2. The workspace switcher — the moment it obviously does something

Click the workspace switcher in the sidebar. Two workspaces are listed:
Acme Studio and **Cedarwood Partners**. Switch to Cedarwood Partners — the
whole app reloads around a different client (Meridian Capital), different
projects (**Meridian Ops Dashboard**, **Meridian Compliance Audit**),
different people (Ivan Radović, not Maja/Luka/Ana). Switch back to Acme
Studio before continuing.

## 3. Website Redesign — the core mid-flight project

Open **Website Redesign**. Walk the board (tasks across every column),
then:

- **Timeline / phases tab**: several phases active at once (Visual
  direction & design and Build both `active`), one `blocked` (QA), one
  `not_started` (Launch), one deliberately empty of tasks (Kick-off &
  setup) — point out that "Done" alone renders, no stray `0%`.
- **Approvals**: one overdue (Site structure sign-off), one not, one
  approved, one sent back with changes requested.
- **Deliverables**: one overdue and blocking (final homepage copy), one
  accepted, one waived.
- **Hours**: a real budget period with billable/non-billable and
  categorised time — point at the per-category rollup and the billable-only
  toggle.
- **Client requests**: one already quoted and awaiting the client's
  decision, one still untriaged.

## 4. Preview as a client (staff-side)

From Website Redesign's settings, use **Preview as client**. This is the
same route worth using on **Northwind Loyalty App — Phase 1** afterward —
open it there too: every phase done, `target_launch_date` in the past, a
warranty window live on the project header. This is "what done looks
like," without needing a second client account.

## 5. What a client cannot reach — the boundary, shown not asserted

Sign out, sign back in as **nina@demo.test** (client, Acme Studio → Website
Redesign only).

- She lands in the **client portal** for Website Redesign: Overview,
  Timeline, Approvals, Deliverables, Hours (budget hidden from her — only
  the sold-hours figure surfaces), Pages, Your Site, Requests.
- Try navigating to `/w/acme-studio` (the internal app) or to any other
  Acme project (e.g. Mobile App v2) — she cannot reach either; RLS, not
  just UI, blocks it.
- Sign out. Sign back in as **petra@demo.test** (client, Cedarwood
  Partners → Meridian Ops Dashboard only). Show that Petra cannot reach
  Nina's workspace, Nina cannot reach Petra's, and within Cedarwood itself
  Petra cannot reach **Meridian Compliance Audit** (no client on that
  project at all) — three separate boundaries, three quick failed
  navigations.

## 6. Over budget — the red path

Still as an internal account (sign back in as **sasa@demo.test**), switch
to Cedarwood Partners and open **Meridian Ops Dashboard** → Hours. The
budget is 20h sold; logged time already exceeds it — the burn-down renders
genuinely over, not a contrived number.

## 7. The archive

Back in Acme Studio, open the workspace **Archive** screen. **Brand
Refresh** is there with a real archived-by name and timestamp — the screen
isn't empty.

## 8. Turn the portal on live

Open **Mobile App v2** → Settings → the portal toggle is off. Flip it on
live — this is the moment the "switched off" state pays off: the toggle
visibly changes what exists, rather than being demonstrated only by its
absence. (Flip it back off afterward if you want the seed's original state
preserved for the next run.)

## 9. Roles, for completeness

Briefly mention (no need to sign in as each): **maja** (admin), **luka** /
**ana** (member), **vuk** (viewer, Acme Studio) and **ivan** (admin,
Cedarwood Partners) round out the role matrix if a question comes up about
permissions.
