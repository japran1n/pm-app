# Handoff: F011 — Restylize navigation and sidebar to Linear aesthetic

## Status
COMPLETE

## Assertions covered
No assertion IDs were assigned in the feature spec file (contents were only `[CLARIFIED-AUTO]`, no numbered "Assertions" section present). This is a visual-only styling task per the task brief; no new/changed behaviour to assert. Verified visually via source diff that no logic, props, hrefs, or active-state detection changed.

## Files changed
components/nav/app-sidebar.tsx
components/nav/project-nav-list.tsx

## Commands run
`npx tsc --noEmit -p .` (pre-existing unrelated errors only, in components/ui/status-badge.tsx and tests/unit/docs-markdown-editor-export-import.test.tsx — confirmed unrelated to these files)
`npx vitest run tests/unit/app-sidebar-project-nav-list.test.tsx --reporter=dot` (2 pre-existing failures, confirmed identical on `git stash` baseline before my changes — a next/navigation useRouter mock gap unrelated to this styling change)
`npx vitest run tests/unit --reporter=dot` (same pre-existing failures list as baseline; no new failures introduced by my class-only edits)

## Decisions made
- Kept `bg-sidebar-accent`/`text-sidebar-accent-foreground` token names only where the spec's literal Linear treatment (`bg-accent text-foreground font-medium`) explicitly overrides them for the *active* item state; replaced non-active hover styling from `hover:bg-sidebar-accent hover:text-sidebar-accent-foreground` to `hover:bg-[#ffffff0d]` per spec.
- Applied the same nav-item/section-header treatment to both the primary nav list (app-sidebar.tsx) and the Projects section (project-nav-list.tsx, including project rows, the "Projects" collapsible trigger label, and the "Favourites" sub-label) for visual consistency across the whole sidebar, since the task brief's aesthetic rules apply to "nav items" and "section headers" generically and project-nav-list.tsx is mounted inside the same sidebar shell.
- Removed only `border-r` from the desktop `<aside>` wrapper (no `shadow-*` was present anywhere in these files to remove). Left the `border-t` on the Projects section and `border-t` on the footer block untouched — those are internal separators between sidebar sections, not the sidebar's own right/outer border, so they're out of scope per "No border-right on sidebar" (not "no borders anywhere in the sidebar").
- Left the mobile hamburger bar's `border-b` untouched — that's a horizontal top-bar under/above content, not the sidebar's right border, and mobile bar restyling wasn't in scope of the brief's bullet list.
- Did not touch `font-medium` default state (removed `font-medium` from non-active nav item text since spec's active-only line says "Active nav item: ... font-medium", implying the base/non-active nav-item classes (`text-mini text-muted-foreground hover:bg-[#ffffff0d] rounded-[4px] px-2 py-1.5`) do not include font-medium.

## Out-of-scope work needed
- Feature spec file `missions/20260909-linear-ds/features/F011.md` contains only the literal text `[CLARIFIED-AUTO]` with no title, description, or assertions — appears to be a truncated/unwritten spec file. The orchestrator may want to verify this file was written correctly during the clarification phase; I proceeded using the fully-detailed task brief provided directly in the run message instead, per SUGGESTED FOLLOWUP priority order (clarified spec > brief), since the brief was the only substantive source of truth available.
- components/nav/app-header.tsx, components/docs/docs-sidebar.tsx, and components/portal/portal-sidebar.tsx were not touched — the task brief scoped only to "the main sidebar component(s) and nav item components" found via the given greps, which resolved to app-sidebar.tsx and project-nav-list.tsx. Those other sidebar variants (docs, portal) may need equivalent Linear-aesthetic passes in a separate feature if they're in scope of this mission.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Treated the missing/empty F011.md feature spec as non-blocking since the run message itself contained a complete, unambiguous implementation brief (exact classes, exact scope, exact commit message) — used that as the source of truth per the ambiguity-resolution priority order's fallback to "the clarified implementation answers in the feature spec" being effectively supplied inline in the task message.
AUTONOMOUS_DECISION: Extended the same Linear nav-item/section-header treatment to project-nav-list.tsx (not just app-sidebar.tsx) since it renders inside the same sidebar shell and the brief's aesthetic rules describe "nav items" and "section headers" as a general pattern, not file-specific.

## Notes for the next worker
No MCP tools used — pure CSS class changes, no external service or live schema involved. The pre-existing test failures (`app-sidebar-project-nav-list.test.tsx`'s two AS-509/AS-513 cases, `f038-as024-coverage.test.ts`, `sign-out-back-navigation.test.ts`) are all caused by a `next/navigation` mock missing a `useRouter` export in the shared test setup — confirmed via `git stash` that they fail identically on the pre-F011 baseline, so they are not a regression from this change and were not investigated/fixed here (out of scope for a visual-only feature).
