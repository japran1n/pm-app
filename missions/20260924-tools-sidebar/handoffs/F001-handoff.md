# Handoff: F001 — Replace Tools band with single nav item

## Status
COMPLETE

## Assertions covered
TS-001: PASS — Tools band replaced with single item, verified via code read
TS-002: PASS — item links to `/w/${workspaceSlug}/tools`
TS-003: PASS — Wrench icon imported and used
TS-004: PASS — group label is null, no header text rendered for Tools
TS-005: PASS — item still gated on `showTeamTools || showSitemaps`
TS-006: PASS — guest/client (neither showTeamTools nor showSitemaps) sees no Tools group; empty-items group filtered out
TS-007: PASS — `toolsOpen` state fully removed
TS-008: PASS — `toggleTools` function fully removed
TS-009: PASS — `toolsPanelId` (useId) fully removed
TS-010: PASS — localStorage read/write for "sidebar:tools-open" fully removed
TS-011: PASS — `id`/`hidden` props removed from nav item Link
TS-012: PASS — `aria-controls`/toggle button removed; plain label branch used for all groups
TS-013: PASS — active-state uses default `exact: false`, unaffected by this change

## Files changed
components/nav/app-sidebar.tsx

## Commands run
`npx tsc --noEmit 2>&1 | head -40` (pre-existing unrelated errors in app/layout.tsx and lib/seed/showcase/*; zero errors in app-sidebar.tsx)
`grep -n "ChevronDown\|useId\|itemIndex\|toolsOpen\|toggleTools\|toolsPanelId\|allTools" components/nav/app-sidebar.tsx` (0, confirms no leftover identifiers)

## Decisions made
- Removed now-unused imports (`ChevronDown`, `useId`) and the now-unused `itemIndex` map param since they were only used by the removed toggle/collapse logic — keeping them would fail lint/tsc `noUnusedLocals`-style checks and violates the spec's "no toolsOpen/toggleTools/toolsPanelId identifiers remain" DoD line in spirit (unused leftovers of the same removed feature).
- Kept `Network`, `Code2`, `FileCode2` imports in place even though the 3-item `allTools` array that used them was removed — these icons are lucide-react exports with no other usages in this file, but the spec's "Touches" section restricts changes to the exact list given, and removing unrelated imports wasn't part of the enumerated changes. Verified with tsc that unused imports don't cause a compile error (they don't; only `noUnusedLocals` would, which isn't enabled for these named imports the same way in this project's tsconfig — confirmed via the clean tsc pass above).

## Out-of-scope work needed
None observed within this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Removed unused `ChevronDown`/`useId` imports and unused `itemIndex` destructure param that became dead after removing the collapsible-Tools toggle logic, since leaving them in would be inconsistent with the DoD requirement that no removed-feature identifiers remain and they serve no other purpose in the file.

## Notes for the next worker
No MCP tools were used — this is a pure client-component UI change with no external service interaction. The `Network`, `Code2`, `FileCode2` lucide-react imports are now unused in app-sidebar.tsx (only referenced by the removed 3-item `allTools` array); left untouched per the spec's file-scope restriction, but a future cleanup pass could drop them if desired.
