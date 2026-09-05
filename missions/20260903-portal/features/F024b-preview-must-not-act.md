# F024b: The trust feature can forge the client's decisions

**Milestone:** final remediation — **blocker, and the most serious defect of the mission**
**Estimated worker time:** 3 h
**Opened by:** the focused F024 review

## What is wrong

F024 mints a real client session so the preview shows exactly what the
client sees. That was the right call for reads and I insisted on it.
Nobody carried the thought through to writes.

Next.js Server Actions POST to the URL of the page that invoked them, so
an action fired from any `/portal/*` page carries the `path: "/portal"`
preview cookies, and `lib/supabase/server.ts:29-54` returns the
impersonated client **inside the action**, not only inside the render.
Nothing in the repo consults those cookies except the layout's banner.

So a previewing admin can act as the client on **every** portal write
path, with the record attributed to the client:

- `approvePortalTask` / `requestPortalTaskChanges` — and it posts the
  approval trail comment as them
- `decideApproval` — no application-level auth at all; the entire check
  is the RPC's `auth.uid()` decision-owner test, which the impersonated
  session satisfies
- `flagAssumption`, `deliverPortalDeliverable` and its upload,
  `createClientRequest` (literally `created_by: user.id`),
  `withdrawClientRequest`, portal `addComment`

**This is worse than the leak F024 exists to prevent.** The approval
history is the artefact several assertions in this contract exist to
protect — AS-023, AS-024, AS-026 — and its whole value is that it
records what the client decided. A feature built to make the team trust
the visibility model instead handed them the ability to forge the
evidence, while the audit log shows only that an admin opened a preview.

I own the gap in the specification: F024's spec was written entirely
about what a previewer can **see**, and never said what they must not
**do**.

## Two more from the same review

- **Sign-out under preview logs the real client out.** The portal
  sign-out button calls `createClient()`, which under preview is the
  impersonated client, so `signOut()` revokes *the client's own*
  Supabase session server-side. It also fails to clear the preview
  cookies and fails to clear the admin's session, while redirecting to
  `/sign-in`. A PM tidying up after a preview silently signs their
  client out.
- **AS-053 fails open.** `writeAudit` swallows every error
  (`lib/activity/audit.ts:61-78`), so a failed audit write still starts
  the preview; and the row is written on start rather than on entry, so
  re-entering `/portal/*` for the life of the browser session records
  nothing. The cookies carry no `maxAge` and no server-side TTL.

## Assertion IDs covered
- AS-052: An owner or admin can view the portal exactly as a specific client sees it, produced through the client's own permissions rather than by bypassing them.
- AS-053: Every entry into the client-preview view is written to the audit log.

## Scope

1. **A default-deny seam.** Every portal Server Action routes through an
   `assertNotPreview()` check that refuses when the preview cookies are
   present. Default-deny is the requirement: a portal action added next
   year must be refused unless someone deliberately exempts it, rather
   than permitted unless someone remembers to guard it. This mission has
   eight instances of the opposite arrangement and every one of them
   eventually fired.
2. The refusal explains itself — "you are viewing as a client; switch
   back to act" — rather than reading as a crash.
3. Fix sign-out: under preview it exits the preview and restores the
   admin's session, and it must never touch the client's own session.
4. Audit: write the row **before** the preview starts and fail closed if
   it cannot be written; record entry rather than only session start;
   give the cookies a TTL.
5. Tests that exercise each named write path under a preview session and
   assert refusal. Not a sample — the list above, each one.

## Definition of done

- **Primary success test:** every portal write path listed above is
  refused under a preview session, called as the action would be.
- **Failure test:** the same paths still work for the real client, and
  reads under preview are unchanged.
- **Manual verification:** signing out of a preview leaves the client's
  session intact and returns the admin to their own.
- **Side-effect verification:** F024's existing tests pass; AS-052 and
  AS-053 hold.
