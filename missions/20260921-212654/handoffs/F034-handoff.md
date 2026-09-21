# Handoff: F034 — sidebar-project-dialog-template-options

## Status
COMPLETE

## Assertions covered
SB-033: PASS — sidebar "+ New -> Project" dialog shows a selectable "Start from template" tab (non-empty stub) at 1280px and 375px Sheet; test fails when the templateOptions prop is removed (verified: 2 failures), passes with it.

## Files changed
components/nav/new-menu.tsx
lib/actions/templates.ts
tests/unit/f009-sb033-sb034-new-menu.test.ts
tests/unit/f034-sb033-list-project-template-options.test.ts
tests/unit/f007-sb030-switcher-width.test.ts
tests/unit/f008-sb031-sb032-search-palette.test.ts
tests/unit/f025-sb009-real-375px.test.ts

## Commands run
`npx vitest run tests/unit` (49 failed files, all in baseline-failing-files.txt; 0 new after adding templates stubs)
`npx vitest run` on f007/f008/f025/f009 in isolation (0) — first full run had these 3 newly failing (esbuild bundling next/server via the new import), fixed by stubbing lib/actions/templates
`npx tsc --noEmit` (0)
`npx eslint <touched files>` (0)

## Decisions made
- Lazy-fetch via new server action listProjectTemplateOptions(workspaceId), triggered on first menu open; NO layout change, so the streaming critical path gains no round trip.
- Action gated by canCreateProject (same as createProjectFromTemplate); guest/viewer/client/non-member/signed-out get [].
- Project click awaits the (memoised) fetch before opening the dialog so the default-template preselection is correct; dialog keyed on option ids.
- Reuses getWorkspaceProjectTemplateOptions, same query as the projects page.

## Out-of-scope work needed
None. Templates created after first menu open in the same page session are not refetched until reload.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: chose lazy server-action fetch over layout slot (spec allowed either) to keep the layout streaming.

## Notes for the next worker
Tests bundling the real AppSidebar must stub "@/lib/actions/templates" (now imported by new-menu.tsx). Not verified: live authenticated Next page against real Supabase.
