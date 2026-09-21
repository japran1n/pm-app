# F010: my-projects-grid.tsx

**Milestone:** M3  **Time:** 25 min  **Depends on:** F004

## Assertions
AS-050, AS-051, AS-052, AS-053

## Clarified implementation
Create `components/dashboard/my-projects-grid.tsx` (Server Component).

```tsx
type MyProjectsGridProps = {
  projects: MyProjectProgress[];  // from lib/queries/projects.ts
  workspaceSlug: string;
};
```

Rendering:
- Section heading "My projects" + "All projects →" link
- CSS grid: 3 columns on wide, 2 on tablet, 1 on mobile
- Each project card (Card component from ui/card):
  - Project name (truncated) | done/total count (mono, muted)
  - Progress bar (filled width = doneCount/totalCount × 100%)
  - Bottom: next milestone or due info | overdue count (red mono when > 0)
- Empty state: "You're not a member of any active project."

Progress bar: empty bar background=`var(--secondary)`, fill=`var(--brand)`.

## Definition of done
- Grid renders with projects
- Empty state renders
- tsc clean
