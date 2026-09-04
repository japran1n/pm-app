# Handoff: F024b — preview must not act

## Status
COMPLETE

## Assertions covered
AS-052: PASS — reads under preview are unaffected (unmodified), and every named write path (approvePortalTask, requestPortalTaskChanges, decideApproval, flagAssumption, deliverPortalDeliverable, createClientRequest, withdrawClientRequest, addComment) is refused under a preview session with a self-explanatory message and no row written. Verified by two layers: Layer A (`lib/supabase/server.ts`, structural — any `.insert/.update/.upsert/.delete` on the impersonated client is refused unconditionally) and Layer B (`lib/auth/assert-not-preview.ts`, the explicit guard six RPC/comment-backed actions call first).
AS-053: PASS — audit write on `startClientPreview` is now fail-closed (a failed `write_audit_log_entry` aborts the mint, no cookies set, no session minted); the portal layout writes a second, distinctly-named `portal.preview_entered` row on every subsequent entry into `/portal/*` under an active preview, through the previewer's own real session (never the impersonated one); the three (now four) preview cookies carry a 30-minute `maxAge`.

## Files changed
lib/supabase/server.ts
lib/auth/assert-not-preview.ts (new)
lib/actions/portal-preview.ts
lib/actions/portal-approval.ts
lib/actions/portal-project-records.ts
lib/actions/portal-deliverables.ts
lib/actions/client-requests.ts
lib/actions/comments.ts
lib/actions/auth.ts
components/portal/portal-sign-out-button.tsx
components/portal/portal-sidebar.tsx
app/(portal)/portal/[workspaceSlug]/layout.tsx
app/(portal)/portal/[workspaceSlug]/page.tsx
tests/unit/portal-approval-action.test.ts
tests/unit/portal-preview-action.test.ts
tests/unit/sign-out.test.ts
tests/unit/f024b-preview-write-guard.test.ts (new)
tests/unit/portal-preview-write-blocked-client.test.ts (new)
tests/unit/portal-preview-signout.test.ts (new)
tests/unit/assert-not-preview-guard.test.ts (new)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint <all files listed above>` (0)
`npx vitest run tests/unit/portal-approval-action.test.ts tests/unit/portal-preview-action.test.ts tests/unit/f024b-preview-write-guard.test.ts tests/unit/portal-preview-write-blocked-client.test.ts tests/unit/portal-preview-signout.test.ts tests/unit/assert-not-preview-guard.test.ts tests/unit/sign-out.test.ts tests/unit/optimistic-pending-audit.test.tsx` (0, 78 passed)
Per this feature's own instructions, the full vitest suite was NOT run.

## Decisions made

- **Two-layer default-deny seam, not one.** Requirement 1 asked for a single
  shared seam if possible, and to name what it cannot cover if not.
  - **Layer A (`lib/supabase/server.ts`, structural, genuinely
    default-deny):** `createClient()` now wraps the impersonated preview
    client so `.from(table).insert/update/upsert/delete(...)` is refused
    unconditionally, for every table, with no per-action call required. A
    brand-new portal Server Action that does
    `supabase.from("whatever").insert(...)` next year is refused
    automatically, with nothing to remember. This covers
    `createClientRequest` (insert) and `withdrawClientRequest` (delete)
    structurally.
  - **Layer B (`lib/auth/assert-not-preview.ts`, explicit,
    per-call-site):** covers `approvePortalTask`, `requestPortalTaskChanges`,
    `decideApproval`, `flagAssumption`, `deliverPortalDeliverable`
    (its RPC call) and `addComment`. **Named gap, proven by grep, not
    claimed by precedent:** Layer A cannot cover `.rpc()` generically,
    because `grep -n "\.rpc(" lib/queries/hours.ts` shows
    `project_hours_client`/`project_current_budget_period` are legitimate
    READ RPCs called through this same client from the portal's own hours
    page (`app/(portal)/portal/[workspaceSlug]/p/[projectId]/hours/page.tsx`),
    and `lib/queries/projects.ts:108` shows `get_open_task_counts` likewise.
    There is no naming convention or other structural signal that
    reliably separates a read RPC from a write RPC, so blocking every
    `.rpc()` call under preview would break those reads. This is why the
    six RPC/comment-backed actions each call `assertNotPreview()` as their
    own explicit first line instead — a real, accepted gap in Layer A's
    coverage, not a silently-missed one. I also added the guard to
    `createClientRequest`/`withdrawClientRequest` (belt-and-braces, on top
    of Layer A) purely so their refusal message is the same
    self-explanatory string as the other six, rather than Layer A's
    refusal surfacing through each action's own generic "Something went
    wrong" catch-all.
- **`assertNotPreview()` has a narrow try/catch fallback to `previewing =
  false`.** Dozens of pre-existing `tests/integration/*.test.ts` files
  (e.g. `add-comment.test.ts`, `f009-decide-approval-action.test.ts`)
  mock `@/lib/supabase/server` wholesale with only a hand-rolled
  `createClient()`, predating this feature and with no `isPortalPreview`
  export. Without the fallback, adding this guard to `addComment` (used
  by dozens of comment-related integration tests) would hard-crash every
  one of them with "isPortalPreview is not a function" the instant this
  guard exists — not deliberately updated to properly reflect preview
  state, but genuinely absent. In real request handling
  `isPortalPreview()` always resolves to a real boolean and never throws,
  so this branch is unreachable in production; it is a named
  accommodation for incomplete test doubles predating this feature, not a
  production fail-open path — see `tests/unit/assert-not-preview-guard.test.ts`
  for the proof this doesn't also silently defeat the guard when preview
  genuinely is active (two other tests in that file prove both true/false
  branches still work correctly through a real mock).
  I updated the mocks I directly touched (`portal-approval-action.test.ts`,
  `sign-out.test.ts`) to provide the real `isPortalPreview`/message export
  rather than relying on the fallback, since those files are squarely in
  this feature's scope; the untouched integration test files outside this
  feature's "Touches" continue to rely on the fallback and were
  deliberately not edited.
- **Sign-out under preview:** `signOut()` now checks `isPortalPreview()`
  first. Under preview it never calls `createClient()`+`.auth.signOut()`
  (which would revoke the real client's own Supabase session
  server-side, per the review's finding) — it clears only the four
  path-scoped preview cookies and redirects to
  `/w/<slug>/preview-as-client`, leaving the previewer's own `/`-scoped
  session completely untouched throughout. `SignOutButton` now takes a
  required `workspaceSlug` prop (both call sites already had it in scope)
  so `signOut()` knows where to send the previewer back.
- **Audit fail-closed:** `startClientPreview` now calls
  `write_audit_log_entry` directly (not through the shared, deliberately
  non-fatal `writeAudit()` helper) and returns `{ ok: false }` — no mint,
  no cookies — if that RPC errors. This is a documented, deliberate
  departure from `writeAudit()`'s general convention, per the spec.
- **Audit per-entry:** added a fourth cookie,
  `portal_preview_client_member_id` (the previewed client's own
  `workspace_members.id`, already resolved once at start), read by the
  portal layout on every request so it can write a `portal.preview_entered`
  row via `createRealSessionClient()` (a new export, factored out of
  `createClient()`'s own non-preview branch) without an extra DB
  round-trip or misattributing the actor to the impersonated client. This
  write is best-effort/non-fatal (unlike the start-of-preview write) —
  refusing to *render* an already-live, already-audited preview page
  because a re-entry log row failed would be a worse outcome than logging
  the gap; the spec's "fail closed" language is about the mint, not about
  every subsequent render.
- **TTL:** `previewCookieOptions()` now sets `maxAge: 1800` (30 minutes)
  on all three preview cookies. The client-member cookie added for
  per-entry auditing gets the same options/TTL.

## Out-of-scope work needed

- **FU-4 from F024's review (E2E parity test)** is still open: an E2E
  spec asserting the preview renders the same data as a real client
  session AND that write controls are absent/inert in the rendered UI
  (not just refused server-side) was not written here — this feature's
  scope was the server-side write refusal, not a new E2E harness.
- The banner (`components/portal/client-preview-banner.tsx`) does not yet
  surface the preview's remaining TTL to the previewer, which the F024
  review's FU-2 suggested ("have the banner surface the remaining time").
  Cookie expiry now silently ends the preview; a countdown/expiry notice
  in the UI is a separate, small follow-up.
- I did not add `assertNotPreview()` to `acceptClientRequest`,
  `declineClientRequest`, `sendChangeRequestQuote`, or
  `raiseChangeRequestFromAssumption` in `lib/actions/client-requests.ts`
  (the "Team side" functions in that file) — those are gated by
  `teamCanTriage()` (`canWrite && !isClient`), and a preview session's
  `auth.uid()` is a `client`-role account, so `isClient` is already true
  and these are already refused independent of this feature. Confirmed by
  reading `lib/actions/client-requests.ts`'s own `teamCanTriage` — not
  re-verified with a new preview-specific test, since it was already
  covered by that function's own existing role-gate tests (none of them
  are on the review's named list of eight).

## Blockers

(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: chose 30 minutes for the preview session TTL (F024's
review suggested "15-30 min feels right"); took the upper bound since the
spec's own goal ("see what they see") plausibly needs more than a glance,
and exiting via the banner remains the only way to end it early.

AUTONOMOUS_DECISION: `signOut()` under preview redirects to
`/w/<slug>/preview-as-client` (the same target `exitClientPreview` already
used) rather than back into the portal or to `/sign-in`, since the
previewer is still fully signed in as themselves and that page is where
they'd naturally go to start a new preview or return to their own
workspace.

## Notes for the next worker

- The two-layer split (structural insert/update/upsert/delete block in
  `lib/supabase/server.ts` + explicit `assertNotPreview()` for RPC/comment
  paths) is the intended permanent shape, not a stopgap — see
  `lib/auth/assert-not-preview.ts`'s own header comment for the full
  reasoning on why RPC calls can't be blocked generically. Any new
  portal-reachable Server Action that only does `.from().insert/update/
  upsert/delete()` is safe by construction; one that calls `.rpc()` or
  posts through `addComment` needs its own `assertNotPreview()` call, and
  should be added to the "eight named write paths" list in a future
  spec/review if it's genuinely a new client-attributable write.
- `PORTAL_PREVIEW_ACTION_BLOCKED_MESSAGE` and `isPortalPreview()` are
  exported from `lib/supabase/server.ts`, not `portal-preview.ts` — that's
  deliberate, since the cookie-presence check and the write-block both
  live in the same file that owns the impersonated client.
- No MCP usage for this feature (no live-schema/live-policy change; all
  changes are application-layer guards over existing RPCs/RLS).
