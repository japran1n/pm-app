# Handoff: F012 — home-skeleton.tsx

## Status
COMPLETE

## Assertions covered
AS-110: PASS — Skeleton component exists, renders without props, tsc clean; wired as loading.tsx for the workspace home route.

## Files changed
components/dashboard/home-skeleton.tsx
app/(workspace)/w/[workspaceSlug]/loading.tsx

## Commands run
`npx tsc --noEmit` (0)
`git commit` (0)

## Decisions made
- Kept HomeSkeleton as a Server Component (no "use client", no hooks/state needed) per spec, unlike the existing client-based DashboardSkeleton.
- Used `bg-[var(--secondary)]` with `animate-pulse` and `rounded-md` per the clarified implementation instead of the `Skeleton` UI component used elsewhere, since spec explicitly calls out this token/class combination.
- Chose to replace loading.tsx directly with HomeSkeleton (rather than a Suspense boundary) since it's the simpler, standard Next.js route-level loading pattern and the spec left the choice to the worker.
- Block sizes: greeting ~48px (h-12), needs-you ~180px, my-work ~260px, projects ~140px on the left; timer ~140px, todos ~160px, coming-up ~120px on the right, per spec measurements.
- Used `lg:grid-cols-[1fr_340px]` two-column grid matching the real page's intended layout.

## Out-of-scope work needed
None. This is a pure presentational skeleton with no data dependencies.

## Blockers
None.

## Autonomous decisions
AUTONOMOUS_DECISION: Replaced the existing generic loading.tsx (KPI-tile/chart skeleton) entirely with HomeSkeleton since the spec says "if loading.tsx already exists there, replace its content with HomeSkeleton."

## Notes for the next worker
The real home page component (whatever renders at app/(workspace)/w/[workspaceSlug]/page.tsx) should eventually match this two-column `lg:grid-cols-[1fr_340px]` layout and roughly these block heights so the skeleton-to-content transition doesn't jump. No MCP tools were needed for this UI-only feature.
