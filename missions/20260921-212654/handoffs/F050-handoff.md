# Handoff: F050 — surface-inbox-fetch-failures

## Status
COMPLETE

## Assertions covered
SB-052: PASS — regression-guarded. This feature's changes to the Inbox data path (typed error on `getWorkspaceClientRequests`, throw-on-error in `AllTabContent`/`RequestsTabContent`/`inbox/page.tsx`) do not touch `lib/inbox/visible-tabs.ts`'s `isClient`-keyed gate from F049. All existing SB-052 tests (`tests/unit/f049-tab-gating-guest-parity.test.tsx`, the SB-052 case in `tests/unit/f013-all-tab-content.test.tsx`) still pass unchanged after adapting their `getWorkspaceClientRequests` mocks to the new `{ list, error? }` shape — the tab-visibility rule itself was not modified.

## Files changed
lib/queries/client-requests.ts
components/client-requests/requests-tab-content.tsx
components/inbox/all-tab-content.tsx
app/(workspace)/w/[workspaceSlug]/inbox/page.tsx
app/(workspace)/w/[workspaceSlug]/page.tsx
tests/unit/f013-all-tab-content.test.tsx
tests/unit/f049-tab-gating-guest-parity.test.tsx
tests/unit/f050-inbox-fetch-failures.test.tsx (new)

## Commands run
`npx vitest run tests/unit/f050-inbox-fetch-failures.test.tsx tests/unit/f013-all-tab-content.test.tsx tests/unit/f049-tab-gating-guest-parity.test.tsx` (0, 16 passed)
`npx tsc --noEmit -p .` (0)
`npx eslint lib/queries/client-requests.ts components/inbox/all-tab-content.tsx components/client-requests/requests-tab-content.tsx "app/(workspace)/w/[workspaceSlug]/page.tsx" "app/(workspace)/w/[workspaceSlug]/inbox/page.tsx" tests/unit/f050-inbox-fetch-failures.test.tsx tests/unit/f013-all-tab-content.test.tsx tests/unit/f049-tab-gating-guest-parity.test.tsx` (0; 1 pre-existing unrelated unused-var warning in the dashboard page, not touched by this change)
`npx vitest run tests/unit` (nonzero — 46 failed/541 passed/1 skipped files; baseline is 47 failing files; diffed by name after path-normalizing: zero new failing files vs `baseline-failing-files.txt`; one baseline-failing file, `tests/unit/f041-final-gate.test.tsx`, now passes — pre-existing flake unrelated to this change, not investigated further since it's an improvement not a regression)

## Decisions made
- Changed `getWorkspaceClientRequests`'s return type from `TeamClientRequest[]` to `{ list: TeamClientRequest[]; error?: string }`, mirroring `getNotificationsForWorkspace`'s existing "typed error, caller decides how to surface it" convention (`lib/queries/notifications.ts`) named explicitly in the spec. Updated all three real call sites: `RequestsTabContent`, `AllTabContent`, and the workspace dashboard (`app/.../page.tsx`, which already fails open via its `Promise.allSettled`/`unwrap` pattern — unwrapped to `.list` there, no behaviour change to that page).
- `RequestsTabContent` and `AllTabContent` now `throw` when the typed error is present, letting the existing `inbox/error.tsx` (and the standalone `RequestsTabContent`'s only caller, the Inbox page) render the error boundary instead of an empty state. Chose `throw` over a bespoke inline error affordance because `error.tsx` files already exist at every level that reaches these components and the spec explicitly allows "renders an error affordance or throws to `error.tsx`".
- `inbox/page.tsx`'s membership lookup now destructures and checks `error` and throws before computing `isClient`, so a DB error can no longer silently fall through to a wrong (guest-like) role.
- Approvals (`getOpenApprovalsForWorkspace`) and watching (`getWatchedTasksForUser`) were left untouched — the spec's FU-M4-3 text names only `getNotificationsForWorkspace` and `getWorkspaceClientRequests`; approvals has the identical swallow-to-`[]` pattern but is out of scope here (see below).
- No MCP tools used — this feature is pure application logic (Next.js server components + existing Supabase query functions), no live schema/policy change.

## Out-of-scope work needed
- `getOpenApprovalsForWorkspace` (`lib/queries/approvals.ts`) has the same "real fetch error collapses to `[]`" pattern as the two sources fixed here, and it also feeds the "All" and "Approvals" Inbox tabs. The M4 scrutiny report's FU-M4-3 text only named the notifications and client-requests queries, so this was left alone, but a `getOpenApprovalsForWorkspace` request failure will still render "no open approvals" indistinguishable from a real zero. A follow-up feature could extend the same typed-error convention there and to `ApprovalsTabContent`.
- `getWatchedTasksForUser` was not inspected for the same failure-swallowing pattern; also out of scope per the spec's explicit list.
- SB-054's `hasClient` gating gap and SB-053's nav ordering (separately tracked as FU-M4-1/FU-M4-4 in the same scrutiny report) are unrelated to this feature and untouched.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept the error message strings user-facing-safe and short ("Couldn't load notifications." / "Couldn't load client requests." / "Couldn't resolve your workspace role.") since `error.tsx` boundaries in this app typically render the thrown `Error.message` directly; no spec answer specified exact copy.

## Notes for the next worker
- `getWorkspaceClientRequests`'s new `{ list, error? }` shape must be kept in sync with any future caller — only three real call sites existed at the time of this fix (`RequestsTabContent`, `AllTabContent`, and the workspace dashboard page); grep for `getWorkspaceClientRequests(` before adding a new one.
- The scrutiny report's FU-M4-3 also asked to "cover with tests that force each query to fail and assert an error is visible" — done via `tests/unit/f050-inbox-fetch-failures.test.tsx` (RequestsTabContent) and the new `describe("FU-M4-3...")` blocks appended to `tests/unit/f013-all-tab-content.test.tsx` (AllTabContent, both notification and client-request failure paths, plus a non-throwing legitimate-empty control) and `tests/unit/f049-tab-gating-guest-parity.test.tsx` (membership-lookup error in `inbox/page.tsx`). All are behavioural (force the mocked query to return the error field, assert the component rejects/throws) rather than source-text greps, and each has a paired "does not throw on legitimate empty" control where relevant to prove they're non-vacuous.
