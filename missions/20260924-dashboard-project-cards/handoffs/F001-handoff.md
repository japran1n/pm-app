# Handoff: F001 — Extend getMyProjectsProgress query and type

## Status
COMPLETE

## Assertions covered
DPC-001: PASS — icon/description/endDate/targetLaunchDate now selected from `projects` and returned on `MyProjectProgress`.
DPC-002: PASS — `MemberRow` internal type updated to include the 4 new project columns.
DPC-003: PASS — Step 3 added: batched `project_phases` query scoped to `project_ids`, filtered `state = "active"`, ordered by `position`, first match per project kept (same pattern as `getProjectHealthInputs`).
DPC-004: PASS — final `.map()` populates `icon`, `description`, `endDate`, `targetLaunchDate`, `currentPhase` from the project row and phase map; `tsc --noEmit` shows no errors in `lib/queries/projects.ts`.

## Files changed
lib/queries/projects.ts

## Commands run
`npx tsc --noEmit 2>&1 | head -50` (1 — but only pre-existing unrelated errors in lib/seed/showcase/records-common.ts, none in lib/queries/projects.ts; verified via `grep "lib/queries/projects.ts"` on the tsc output, which returned no lines)

## Decisions made
- Followed the spec's exact Step 3 block (copy of the `getProjectHealthInputs` active-phase pattern already in this file) rather than inventing a new phase-resolution approach.
- Used `?? null` coalescing on the new project fields consistently with the rest of this function's existing null-handling style.

## Out-of-scope work needed
- Downstream consumers of `MyProjectProgress` (`app/(workspace)/w/[workspaceSlug]/page.tsx`, `components/dashboard/my-projects-grid.tsx`, and their tests) were not touched — this feature is additive-only (new optional-shaped fields), so no consumer needed changes to keep compiling, but wiring the new fields into the dashboard card UI is left for the feature(s) that actually consume them.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
(none — spec was unambiguous and followed exactly)

## Notes for the next worker
The pre-existing `lib/seed/showcase/records-common.ts` tsc errors (missing `./content-chat` module, implicit `any` indexing) are unrelated to this feature and were present before this change — do not attempt to fix them as part of consuming F001's output unless separately assigned.
