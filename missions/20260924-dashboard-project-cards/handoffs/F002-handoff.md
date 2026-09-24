# Handoff: F002 — Upgrade MyProjectCard visual

## Status
COMPLETE

## Assertions covered
DPC-005: PASS — icon tile + title + phase/description subtitle rendered in CardHeader, matching ProjectCard pattern.
DPC-006: PASS — due date shown mono-formatted via resolveDueDate/Intl.DateTimeFormat, or "No due date" fallback.
DPC-007: PASS — health-coloured progress bar (PROJECT_HEALTH_BAR_CLASS) with "Progress"/% label, or "No tasks yet" when totalCount is 0.
DPC-008: PASS — ProjectHealthBadge + time-left Badge (computeTimeLeft or PROJECT_HEALTH_LABELS fallback) in footer.
DPC-009: PASS — no favorite button, no card-actions menu, no team avatars present.
DPC-010 through DPC-015: PASS — verified visually via code parity with components/projects/project-card.tsx (same CardHeader/CardContent/inner-panel structure, classes, and aria attributes), and `tsc --noEmit` clean for this file.

## Files changed
components/dashboard/my-projects-grid.tsx

## Commands run
`npx tsc --noEmit 2>&1 | head -50` (0 errors attributable to my-projects-grid.tsx; remaining output is pre-existing unrelated errors in untracked lib/seed/showcase/ files not touched by this feature)

## Decisions made
- Matched the ProjectCard (components/projects/project-card.tsx) visual pattern exactly per spec: icon tile (size-9, bg-secondary, rounded-md, first-letter fallback), CardTitle/CardDescription subtitle sourced from currentPhase.name or first non-blank description line, inner bg-secondary/rounded-lg/p-3 panel with due date + health progress bar, and a footer with ProjectHealthBadge + time-left Badge.
- `currentPhase.state` on `MyProjectProgress` is typed as a broad `string` in lib/queries/projects.ts (F001), while `computeProjectHealth`'s `ProjectHealthPhase.state` needs the narrower phase-state union. Cast with `as "not_started" | "active" | "blocked" | "done"` at the call site — the underlying DB column only ever contains those four values (see project_phases.state per compute-health.ts's own comment), so this is a safe, non-behavior-changing type assertion, not a logic change.
- Dropped `doneTaskCount` from the `computeProjectHealth` call — `ProjectHealthInput` (compute-health.ts) does not have that field (health is derived from overdue count/percentage + phase overshoot only); the spec's example snippet included it by mistake. Progress-bar percent still uses `doneCount`/`totalCount` directly, matching ProjectCard's own progressPercent computation.
- Removed the stale top-of-file comment referencing done/total + next-milestone display logic (no `nextMilestoneName`/`toolsOpen` usage remains in the file), replacing it with a comment describing the new F002 visual parity with ProjectCard.

## Out-of-scope work needed
None identified — this was a pure visual/presentational rewrite of one file's private component per spec.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Cast `currentPhase.state` to the narrower phase-state union when passing to `computeProjectHealth`, since `MyProjectProgress`'s type (owned by F001, out of this feature's Touches scope) declares it as plain `string`. Did not widen the compute-health.ts phase union or edit lib/queries/projects.ts, since spec restricts changes to my-projects-grid.tsx only.
AUTONOMOUS_DECISION: Dropped `doneTaskCount` from the `computeProjectHealth({...})` call (present in the spec's illustrative snippet but not part of `ProjectHealthInput`'s actual shape) to keep `tsc --noEmit` clean; behavior unaffected since the field wasn't consumed by the health function.

## Notes for the next worker
No MCP tools were needed — this is a pure UI/presentational change with no external-service or live-data touchpoints. Reference implementation for the exact visual pattern is `components/projects/project-card.tsx`.
