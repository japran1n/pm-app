# F012: home-skeleton.tsx

**Milestone:** M4  **Time:** 15 min  **Depends on:** F001

## Assertions
AS-110 (partial — skeleton existence)

## Clarified implementation
Create `components/dashboard/home-skeleton.tsx` (Server Component):
- Mirrors the two-column layout of the real page
- Left: pulse skeleton block for greeting (~48px), full-width card for needs-you (~200px), full-width card for my-work (~280px), grid for projects
- Right: card for timer (~140px), card for todos (~160px), card for coming-up (~120px)
- Uses `animate-pulse` Tailwind class on div blocks with `bg-[var(--secondary)]` fill
- No real data needed

This becomes the `loading.tsx` in `app/(workspace)/w/[workspaceSlug]/` OR is used inside a Suspense boundary — worker decides which is cleaner for the route structure.

## Definition of done
- Component exists and renders without props
- tsc clean
