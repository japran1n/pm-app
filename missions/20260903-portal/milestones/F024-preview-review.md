# F024 — client preview mode: focused adversarial review

**Question 1 verdict: YES. A previewing admin can act as the client, on every client write path in the portal. This is a blocker.**

## 1. Act-as (blocker)

The mechanism is a real client session in cookies scoped `path: "/portal"`, read by
`lib/supabase/server.ts` `createClient()` (lines 29–54). Next.js Server Actions POST to
the URL of the page that invoked them, so an action fired from any `/portal/*` page
carries those cookies. `createClient()` therefore returns the impersonated client inside
the *action*, not only inside the render. Nothing anywhere in the codebase checks for the
preview cookies except `lib/supabase/server.ts` (to activate the session) and the portal
layout (to draw the banner) — verified by
`grep -rn "PORTAL_PREVIEW\|portal_preview"`: no write path consults them.

Every client write path is affected, and each one derives the actor from the session, so
the record is attributed to the client, not the admin:

| Path | Entry point | How the actor is taken |
|---|---|---|
| Approve task (legacy task-page control) | `components/portal/approval-actions.tsx` → `approvePortalTask` | `lib/actions/portal-approval.ts:104-122` `requireClientCaller` reads `supabase.auth.getUser()` — under preview this *is* the client, so the gate passes; `approve_portal_task_atomic` pins to `auth.uid()`. Also posts the "✅ Approved." trail comment as the client (`:163`). |
| Request changes | same file → `requestPortalTaskChanges` (`:174`) | identical |
| Decide approval (approvals view + change-request quote decision) | `components/portal/approval-card.tsx` → `decideApproval` | `lib/actions/portal-approval.ts:312-330` — no application-level auth at all, the entire check is `decide_approval_atomic`'s own `auth.uid()` decision-owner test. Under preview `auth.uid()` is the client, so `decided_by`/`decided_at` record the client. |
| Flag assumption | `components/portal/assumption-list.tsx` → `flagAssumption` | `lib/actions/portal-project-records.ts:34-46` — `getUser()` then `flag_assumption_atomic` on `auth.uid()`. |
| Mark deliverable delivered + file upload | `components/portal/deliverable-upload.tsx` → `deliverPortalDeliverable` | `lib/actions/portal-deliverables.ts:83-88` `getUser()`; `mark_deliverable_delivered_atomic` on `auth.uid()`. |
| Create client request | `components/portal/new-request-form.tsx` → `createClientRequest` | `lib/actions/client-requests.ts:192-198` — `created_by: user.id`, i.e. the client's id, written from an admin's browser. |
| Withdraw client request | `components/portal/request-list.tsx` → `withdrawClientRequest` | author-only DELETE policy, satisfied because the session *is* the author. |
| Portal comments | `components/portal/conversation.tsx` → `addComment` | authored as the client. |

Consequence, exactly as anticipated: the approval history shows the client approving when
the agency did; `audit_log` contains only `portal.preview_started`; there is no marker on
the resulting row distinguishing it from a genuine client decision. The decision log's
evidentiary value is gone for any workspace where preview is used.

No test covers this — the 17 tests in `tests/unit/portal-preview-action.test.ts` all
concern authz on `startClientPreview`, cookie scoping, redirect targets and audit rows.
None asserts that the preview session cannot write.

Note this is not a gap the spec left open: the spec's own mechanism ("mint a **scoped**
session") was implemented as an *unscoped* one. Read-only-ness has to be added on top,
because a genuine client session is by construction a writing session.

## 2. Session hygiene

- **Ending:** only the banner's "Exit preview" (`exitClientPreview`, no auth check —
  acceptable, it only clears path-scoped cookies).
- **Survives sign-out — yes, and worse.** `components/portal/portal-sign-out-button.tsx`
  → `lib/actions/auth.ts:74` `signOut()` calls `createClient()`, which under preview
  returns the impersonated client with a **no-op cookie adapter**
  (`setAll: () => {}`). So sign-out (a) revokes the *client's real Supabase session*
  server-side — logging the actual client out of their own portal as a side effect of an
  admin previewing, (b) does not clear the preview cookies, and (c) does not clear the
  admin's own `/`-scoped session either, despite redirecting to `/sign-in`. **Major.**
- **Duration:** the three cookies have no `maxAge`/`expires`, so they are browser-session
  cookies with no server-side TTL and no re-authorisation. Auto-refresh happens only
  in-memory (the no-op adapter discards rotated tokens), so once the access token expires
  the preview degrades unpredictably — with refresh-token rotation the stored refresh
  token is consumed on first use and becomes invalid, producing a signed-out-looking
  portal under a "Previewing as X" banner rather than a clean expiry. **Major.**
- **Previewer's own session:** recoverable. Path scoping means `/w/*` never sees the
  preview cookies and the no-op adapter never writes back, so the admin's real session is
  genuinely untouched. This part is correct.
- **Attribution:** as in section 1 — `created_by`, comment authorship, and all
  `auth.uid()`-derived decision fields are the client's. Nothing in `audit_log` links a
  write back to the previewing admin.

## 3. Access and audit

- **Owner/admin only:** correct and server-side in both places —
  `app/(workspace)/w/[workspaceSlug]/preview-as-client/page.tsx:59-63` redirects
  non-admins, and `lib/actions/portal-preview.ts:96` re-checks `requireWorkspaceAdmin`
  independently of the page, so a hand-crafted action call is rejected. Tested for
  member/viewer/no-membership/signed-out. **PASS.**
- **One audit row per entry:** written once, before the mint, from the previewer's own
  session — correct design. Two gaps: (a) `writeAudit` swallows all failures
  (`lib/activity/audit.ts:61-78`), so a failed RPC lets the preview start with **no**
  audit row; the tests mock `writeAudit` and so cannot see this. (b) The row is written
  on *start*, not on entry into the view; since the cookies persist, the previewer can
  leave and return to `/portal/*` any number of times for the life of the browser session
  with no further rows. Against AS-053's literal "every entry into the client-preview
  view", **major**.

## Assertions

| ID | Verdict | Reason |
|---|---|---|
| AS-052 | FAIL (blocker) | The view is produced through the client's own permissions, which is what the spec asked for — but the session is unscoped, so the previewer also inherits the client's write permissions on every portal action. |
| AS-053 | FAIL (major) | One row per `startClientPreview` call, but audit failure is swallowed (fail-open) and re-entry into the view writes no row. |

## Recommended follow-ups

**FU-1 (blocker) — make the preview session read-only.** Add a single server-side seam
that every mutating portal path consults, rather than patching each action. The cleanest
shape given this architecture: have `lib/supabase/server.ts` expose the preview state
alongside the client (e.g. `createClient()` returns as today, plus a
`isPortalPreview()` helper reading the same cookies), and add a guard at the top of every
portal-reachable Server Action — `approvePortalTask`, `requestPortalTaskChanges`,
`decideApproval`, `flagAssumption`, `deliverPortalDeliverable`, `createClientRequest`,
`withdrawClientRequest`, `addComment` — returning `{ ok: false, error: "You're previewing
as a client. Actions are disabled in preview." }` before any RPC or insert. Prefer a
default-deny formulation (a shared `assertNotPreview()` called from a wrapper all portal
actions go through) over eight independent call sites, so a future portal action is safe
by omission rather than unsafe by omission. Belt-and-braces at the DB layer is worth
considering too: stamp a claim into the minted token (`app_metadata`/`amr` is not
writable per-session here, so a separate approach would be needed) — but the application
guard is the required part. Tests must assert, per action, that a preview session's call
is rejected AND that no row was written.

**FU-2 (major) — preview session lifecycle.** Give the preview cookies an explicit short
`maxAge` (15–30 min feels right for "see what they see"), have the banner surface the
remaining time, and make `exitClientPreview` the only way to extend it (re-entry writes a
new audit row, satisfying AS-053's "every entry"). Separately, fix the sign-out
collision: `signOut()` invoked from a portal page under preview must clear the preview
cookies and return the previewer to their own session rather than revoking the real
client's Supabase session — today it logs the actual customer out.

**FU-3 (major) — audit must not fail open for preview.** `startClientPreview` should
treat a failed `write_audit_log_entry` as fatal (return `{ ok: false }`, do not mint),
which is a deliberate departure from `writeAudit`'s general non-fatal convention and
should be commented as such. AS-053 is a security assertion, not a nicety. Add a test that
forces the RPC to error and asserts no cookies are set.

**FU-4 (minor) — E2E parity test.** The definition of done's primary success test
(preview payload identical to a real client session) is still architecturally-argued
rather than exercised. Once FU-1 lands, an E2E spec should also assert the preview renders
the same data *and* that the write controls are absent or inert.

## Commands run

Per instructions (a worker is active in this repo) the full vitest suite was NOT run. No
individual test file needed executing — every finding above is established by reading the
code and by `grep -rn "PORTAL_PREVIEW\|portal_preview" --include="*.ts" --include="*.tsx"`,
whose complete output is: `lib/supabase/server.ts`, `lib/actions/portal-preview.ts`,
`app/(portal)/portal/[workspaceSlug]/layout.tsx`,
`tests/unit/portal-preview-action.test.ts`. No write path appears in that list.
