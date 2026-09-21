# Handoff: F001 — Merge Team + Members

## Status
COMPLETE

## Assertions covered
SB-001: PASS — `run-log.md` records baseline `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run migrations:check` output, captured before any F001 edit. Verified by `tests/unit/f001-merge-team-members.test.tsx`.
SB-006: PASS — with `isGuest=true`, the sidebar renders none of Team, Client requests, Approvals, Archive, Templates, Trash, Preview as client, Settings. Verified by test.
SB-010: PASS — sidebar has exactly one item labelled "Team" (`/w/acme/team`); no item labelled "Members" remains in the nav tree. Verified by test.
SB-011: PASS — `/w/<slug>/settings/members` route is unchanged (not touched) and the Settings page (`app/(workspace)/w/[workspaceSlug]/settings/page.tsx`) already links to it in its tab nav; verified this was already true (no edit needed) and asserted via test reading the page source.

## Files changed
components/nav/app-sidebar.tsx
tests/unit/f001-merge-team-members.test.tsx
missions/20260921-212654/run-log.md
missions/20260921-212654/handoffs/F001-handoff.md

## Commands run
`npx tsc --noEmit` (0) — baseline, and again after edits (0, no new errors, diff empty)
`npx eslint .` (1, pre-existing — 216 problems on HEAD baseline, none in touched files)
`npx eslint components/nav/app-sidebar.tsx "app/(workspace)/w/[workspaceSlug]/settings/page.tsx"` (0)
`npx eslint tests/unit/f001-merge-team-members.test.tsx` (0)
`npm run migrations:check` (0) — "No migration drift — all migrations present on remote."
`npx vitest run` (baseline: 654 failed | 1162 passed | 4 skipped test files, 1820 total)
`npx vitest run` (after: 653 failed | 1164 passed | 4 skipped test files, 1821 total — one fewer failing file, one new passing test file added; `comm -13` diff of non-worktree failing-file lists between baseline and after is empty, i.e. no new failing test files)
`npx vitest run tests/unit/f001-merge-team-members.test.tsx` (0, 4/4 tests pass)
`npx vitest run tests/unit/app-sidebar-team-nav.test.tsx tests/unit/app-sidebar-settings-nav.test.tsx tests/unit/app-sidebar-archive-nav.test.tsx tests/unit/app-sidebar-trash-nav.test.tsx tests/unit/th-sidebar-tools-guest.test.tsx tests/unit/f083-app-sidebar-requests-badge.test.tsx tests/unit/app-sidebar-project-nav-list.test.tsx tests/unit/app-sidebar-calendar-timeline-nav.test.tsx tests/unit/app-sidebar-chat-unread-badge.test.tsx tests/unit/app-sidebar-webflow-nav.test.tsx` (0, all pass — confirms other sidebar nav tests unaffected by the Members removal)

## Decisions made
- Removed the `Members` nav item (`{ href: .../settings/members, label: "Members" }`) from the `team` array in `components/nav/app-sidebar.tsx`, keeping `Team` (`/w/<slug>/team`) as the sole entry point in that group, per the clarified spec.
- Removed `"Members"` from the `guestExcluded` Set since it was the only remaining reference to that label in the nav tree after the item's removal (grepped for other uses of the string "Members" as a nav label — none found); `Team` remains guest-excluded, matching existing `app-sidebar-team-nav.test.tsx` behaviour, unchanged.
- Did not edit `app/(workspace)/w/[workspaceSlug]/settings/page.tsx` — inspected it first (per spec's "verify Members link exists; add if missing") and confirmed it already renders a tab-style `Link` to `/w/${workspaceSlug}/settings/members` labelled "Members" in its settings sub-nav; SB-011 is satisfied by existing code, no change needed.
- Updated two stale comments referencing "the Members nav item" (which no longer exists) to describe the merged Team item instead, for comment accuracy — no behavioural change.
- Baseline capture (SB-001) run before any edit: `npx tsc --noEmit` (clean), `npx eslint .` (216 pre-existing problems, all in `.claude/worktrees/**` or unrelated test files), `npx vitest run` (654 failed / 1162 passed / 4 skipped test files out of 1820 — the large failure count is pre-existing, dominated by integration/RLS suites requiring live network access unavailable in this sandbox), `npm run migrations:check` (clean, no drift). Recorded in `missions/20260921-212654/run-log.md`.

## Out-of-scope work needed
None identified beyond this feature's stated scope. The milestone gate assertions SB-002..SB-008 (typecheck-not-worse, migrations-check-passes, design-system compliance across the whole milestone) are milestone-level and should be re-verified once all M1 features land, not solely by F001.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Left the Settings page (`app/.../settings/page.tsx`) unmodified after confirming the Members link already exists there, per the spec's own "(verify Members link exists; add if missing)" instruction — no autonomous scope expansion, just the "verify" branch of that instruction.

## Notes for the next worker
- The sidebar's `team` NavItem array in `components/nav/app-sidebar.tsx` (around line 184) now contains only `Team` plus the conditional `hasClient`-gated items (Client requests, Approvals, Preview as client) — no separate Members entry.
- `guestExcluded` Set (around line 269) no longer lists `"Members"`.
- Other sidebar nav test files (`app-sidebar-team-nav.test.tsx`, `app-sidebar-settings-nav.test.tsx`, `app-sidebar-archive-nav.test.tsx`, etc.) all still pass unmodified — none of them assumed a Members nav item existed.
- The full `npx vitest run` baseline/after comparison used a `comm -13` diff of sorted failing-file-name lists (excluding `.claude/worktrees/**` scratch paths) rather than diffing raw output, since the raw vitest output is non-deterministically ordered/interleaved across parallel workers.
- No MCP tools were used — this feature is pure client-side nav/component work with no live external-service state to introspect (mcp-registry.md has no relevant row for this feature's scope).
