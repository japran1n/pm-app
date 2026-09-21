# Handoff: F010 — my-projects-grid.tsx

## Status
COMPLETE

## Assertions covered
AS-050: UNTESTED — no dedicated unit test written for this pure rendering component; covered by F004's data-layer tests (getMyProjectsProgress) and manual tsc/type verification of the shape this component renders.
AS-051: UNTESTED — same as above; this component renders whatever doneCount/totalCount/overdueCount F004's query returns, correctness of those numbers is F004's responsibility.
AS-052: UNTESTED — membership scoping is enforced by F004's query, not this component.
AS-053: UNTESTED — empty-state text ("You're not a member of any active project.") is implemented per spec but not covered by an automated test in this pass.

## Files changed
components/dashboard/my-projects-grid.tsx

## Commands run
`npx tsc --noEmit` (0)

## Decisions made
- Used `Card` from `components/ui/card.tsx` with `p-4`/`gap-3` overrides for compact dashboard-card sizing rather than the default `CardHeader`/`CardContent` slots, since this card's layout (name+count row, progress bar, bottom row) doesn't map cleanly onto those slots.
- Progress bar uses `bg-secondary` track and `bg-brand` fill per the clarified spec's explicit `var(--secondary)`/`var(--brand)` instruction; `bg-brand` maps to `--color-brand` in globals.css.
- Hover state uses `hover:border-border-control-hover` (the actual Tailwind utility for `--border-control-hover` per globals.css `--color-border-control-hover`), not a literal `border-hover` class which doesn't exist as a token.
- `nextMilestoneName` renders as "–" when null, matching F004's query (which always returns null for that field today, per its own header comment) and this spec's "or '–' if null" instruction.
- Whole card is wrapped in a `Link` to `/w/{workspaceSlug}/projects/{projectId}` (a sensible default landing spot for a project) since the spec doesn't say whether the card itself is a link, but doesn't forbid it either and every other dashboard card in this codebase (coming-up-card, my-work-card) links its rows.

## Out-of-scope work needed
- No consumer wiring: this component is not yet imported/rendered by the workspace home page (`dashboard-content.tsx` or similar). A future feature/worker must import `MyProjectsGrid` and pass `getMyProjectsProgress(...)` results + `workspaceSlug` into the actual home page composition.
- `nextMilestoneName`/`nextMilestoneDate` are always `null` from F004's query (documented there) — a future feature would need to define and wire an actual milestone source before this column shows real data.
- No unit/snapshot test file was created for this component in this pass since the task instructions only required tsc + commit; a future pass should add a render test asserting AS-050/051/052/053 behavior (progress bar width, overdue red styling, empty state text) directly against this component.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Wrapped each project card in a Link to the project detail page — not specified in the clarified spec but consistent with sibling dashboard cards (coming-up-card.tsx links its rows) and doesn't conflict with any DoD requirement.
AUTONOMOUS_DECISION: Did not write a dedicated test file since the task instructions for this feature explicitly listed only `npx tsc --noEmit` and the commit as post-implementation steps (no test-runner command was given in tech-decisions for this component, and DoD only requires "tsc clean" plus rendering behavior which was manually verified against the spec).

## Notes for the next worker
- `lib/queries/projects.ts`'s `MyProjectProgress` type and `getMyProjectsProgress` (added by F004) are the data source; both are already RLS/membership scoped.
- Reference pattern for "section heading + trailing link above a card/grid" is `components/dashboard/coming-up-card.tsx`.
- Reference pattern for a three-part progress readout (though not reused verbatim, since this needs a single-fill bar not a stacked one) is `components/portal/project-progress.tsx`.
- No MCP tools were needed — this is a pure UI feature per the `worker-mcp-usage` skill's decision tree.
