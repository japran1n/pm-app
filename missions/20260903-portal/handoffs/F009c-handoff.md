# Handoff: F009c — Doc approvals and a test that can fail

## Status
COMPLETE

## Assertions covered
AS-002: PASS — `tests/unit/portal-overview-queries.test.ts` (`getPortalBadgeCounts — AS-002, AS-003` describe block). Migrated the `project_decision_owners` mock to the shared `applyFilters`/`eqFilter` helper (`tests/unit/helpers/query-filter-mock.ts`, F006j) instead of a hand-set `ownerRows` fixture that discarded both `.eq()` calls. Demonstrated the test can fail: temporarily deleted `.eq("user_id", user.id)` from `lib/queries/portal.ts`'s `getPortalBadgeCounts`, ran the suite, and `test_AS_002_another_clients_owned_decision_type_is_not_counted` failed (`expected data: 1, wanted data: 0`) as expected — then restored the line and re-ran to confirm green.
AS-021: PASS — `components/portal/approval-card.test.tsx`, new `describe("doc-subject snapshot open control (F009c, AS-021)")` block: `test_AS_021_doc_approval_renders_an_open_control`, `test_AS_021_opening_a_doc_approval_mints_a_signed_url_and_opens_it`, `test_AS_021_doc_approval_open_failure_toasts_and_does_not_open_a_window`, `test_AS_021_doc_approval_with_no_snapshot_path_renders_no_open_control`.

## Files changed
lib/actions/approvals.ts
lib/queries/approvals.ts
components/portal/approval-card.tsx
components/portal/approval-card.test.tsx
tests/unit/portal-overview-queries.test.ts

## Commands run
`npx vitest run tests/unit/portal-overview-queries.test.ts components/portal/approval-card.test.tsx` (0)
`npx vitest run tests/integration/f008-request-approval-action.test.ts` (0)
`npx vitest run tests/unit/portal-phases-query.test.ts` (0)
`npx vitest run tests/integration/f010-approvals-queue.test.ts` (1 — pre-existing, unrelated: fails with "workspace: JWT issued at future", a live-Supabase-clock-skew integration failure that reproduces on this file untouched by this feature; not caused by this change)
`npx tsc --noEmit` (0)
`npx eslint lib/actions/approvals.ts lib/queries/approvals.ts components/portal/approval-card.tsx components/portal/approval-card.test.tsx tests/unit/portal-overview-queries.test.ts` (0)

## Decisions made
- Chose "render the stored snapshot" over "link to a client-readable view of the live doc" (the spec's own suggested framing) — the snapshot is what `decide_approval_atomic` records the decision against, and F008 already writes it at request time. Linking to a live doc view would let the doc change out from under an already-recorded decision, which is the exact staleness problem the snapshot exists to avoid (see `lib/actions/approvals.ts`'s own `uploadDocSnapshot` comment).
- Added `getApprovalDocSnapshotUrl` (`lib/actions/approvals.ts`) rather than adding a `storage.objects` SELECT policy for the snapshot path. Grepped for the precedent before choosing it: `components/portal/file-list.tsx:1-8` and `lib/actions/attachments.ts`'s `getAttachmentSignedUrl` (both real files, both already following "private bucket → server action mints a fresh signed URL on click → `window.open`") are the exact shape reused here, so `ApprovalCard` now has a second click-to-open button mirroring `PortalFileList`'s `FileRow.handleOpen`.
- Authorization for the new action is the ordinary RLS-respecting server client (`createClient()`) selecting the `approval_requests` row by id — `approval_requests_select_client`/`_team` (20260916010000_approval_requests.sql) already scope that read correctly (same convention every other function in `lib/queries/approvals.ts` documents at the top of that file). Only after that read succeeds does the action reach for `createAdminClient()`, and only to call `storage.createSignedUrl` — never to re-decide who can see the row. This mirrors `getAttachmentSignedUrl`'s own two-tier trust shape (RLS-respecting client resolves visibility, admin client only mints the URL) even though the concrete checks differ (attachments re-derive membership/`client_visible`/`portal_enabled` by hand because Storage RLS is bypassed by the admin client for the actual object read; approvals doesn't need to re-derive anything because the `approval_requests` row itself already carries the RLS-checked visibility fact this action needs).
- Did not remove the doc-snapshot upload — after this change it has a reader (`getApprovalDocSnapshotUrl`), so the dead-write condition the spec asked me to check for does not hold.
- Added `artifact_snapshot_path` to `APPROVAL_COLUMNS`/`PortalApproval`/`mapApprovalRow` in `lib/queries/approvals.ts` since the card needs to know whether a snapshot exists to decide whether to render the Open button at all (never renders a button that would just 404).
- `ApprovalCard`'s doc-open button uses its own `useTransition` (`isOpeningDoc`), separate from the existing decide-transition's `isPending` — clicking "Open" must never disable Approve/Request changes, and vice versa.
- Checked the rest of `tests/unit/portal-overview-queries.test.ts` for the same "mock discards its own filter args" shape the spec warned about. The `approval_requests` mock (`getPortalBadgeCounts`'s count query) and the `tasks` mock (`getPortalWaitingOnYou`) were already migrated to the shared `applyFilters`/`eqFilter`/`inFilter` helper by F006f/F006j/F009 — only the `project_decision_owners` mock (one query to the left, per the spec's own description) still had the old shape. No other instance found in this file.

## Out-of-scope work needed
None identified beyond this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Reused the existing `task-attachments` bucket and `approval-requests/{request_id}/doc-snapshot.md` path F008 already established (per that feature's own comment) rather than introducing a new bucket or path convention — the spec's own text says "Reuse the existing attachments storage bucket and its policies" and F008 had already done the write side of that; this feature only needed to add the read side.

## Notes for the next worker
- `getApprovalDocSnapshotUrl` returns the generic `"This approval has no document to open."` / `"Approval request not found."` errors rather than ever confirming an approval exists to a caller RLS would otherwise hide it from — same "not found, not forbidden" convention `lib/actions/attachments.ts`'s `getAttachmentSignedUrl` documents at its own `isProjectVisibleToCaller` check.
- The `project_decision_owners` mock in `tests/unit/portal-overview-queries.test.ts` is now a thenable builder object (`{ eq, then }`) rather than an `async eq()` — this matches how real `supabase-js` query builders resolve when awaited directly after a chain with no terminal method call (`.select(...).eq(...).eq(...)` with no trailing `.single()`/`.maybeSingle()`). If a future worker adds a new query in this file with the same "await the chain directly" shape, copy this pattern rather than the old `async eq()` shape, which cannot observe a real filter.
