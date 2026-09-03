# F024: Client preview mode — "see it as they see it"

**Milestone:** M5
**Estimated worker time:** 3 h
**Depends on:** every portal view

## Assertion IDs covered
- AS-052: An owner or admin can view the portal exactly as a specific client sees it, produced through the client's own permissions rather than by bypassing them.
- AS-053: Every entry into the client-preview view is written to the audit log.

## Why this is not optional

Before anyone on the team marks something `client_visible`, they will
ask "what will they actually see?". If the answer takes more than one
click, the answer becomes "let's not turn the portal on for this
client". Every other feature in this mission depends on the team
trusting the visibility model, and this is the only feature that earns
that trust.

## Scope

### 1. The route

`/w/[workspaceSlug]/preview-as-client` — pick a client member of a
project, then render **the real portal**, inside a persistent banner
that says this is a preview and names whose view it is.

### 2. How it must be implemented

Through the chosen client's own permissions, not by bypassing them. In
practice: mint a scoped session for that client account server-side and
render the portal's own server components with it, so what the previewer
sees is produced by exactly the policies that produce the client's page.

**Not acceptable:** a `previewAsClientId` parameter threaded into
queries that then filter "as if". That reimplements the visibility rules
a second time, and a preview that agrees with a buggy reimplementation
is worse than no preview — it certifies the bug.

If minting a scoped session proves impossible with the current auth
setup, stop and write that in the handoff with what you tried. Do not
fall back to the parameter approach.

### 3. Access and audit

- Owner and admin only, checked through `lib/actions/authz.ts`.
- Every entry writes an `audit_log` row: who previewed, as whom, when.
- The banner is not dismissible. A previewer who forgets they are in
  preview and reports "the client can see internal tasks" costs a day.

### 4. The shortcut that makes it used

A "View as client" item in the task detail sheet and in the doc header,
opening the preview at that object. The one-click path is the feature;
the standalone route is the fallback.

## Definition of done

- **Primary success test:** integration — the preview's rendered data is
  identical to what a real session for that client returns, asserted by
  comparing the two payloads for the same project.
- **Failure tests:** (a) a `member` role cannot reach the route; (b)
  every entry writes exactly one audit row.
- **Manual verification:** the banner is always visible and names the
  client; the task-sheet shortcut lands on the right object.
- **Side-effect verification:** no query in the portal gained a
  preview-specific branch — grep for the absence of any such parameter.
