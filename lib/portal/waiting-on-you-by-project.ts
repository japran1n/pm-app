// Multi-project portal chooser redesign (docs/handoff conversation,
// 2026-09-06/07): the workspace-level "Your projects" page used to render
// a full "Waiting on you" / "Delivered this week" list (workspace-wide,
// via PortalOverviewLive) BELOW the project cards, duplicating exactly
// the same task-level detail that page.tsx's per-project card grid also
// wants to hint at as a single count badge. Once each card carries "N
// waiting on you", the full aggregate list underneath the cards is the
// same fact told twice at different resolutions -- so the chooser page
// only ever needs a project -> count grouping to badge each card, never
// the task-level list itself (that full list still lives in the single
// project page, `p/[projectId]/page.tsx`, scoped to just that project).
//
// Pure and framework-free so this new aggregation logic is testable
// without a Supabase client or a rendered page.
export function countWaitingOnYouByProject(
  tasks: readonly { projectId: string }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    counts.set(task.projectId, (counts.get(task.projectId) ?? 0) + 1);
  }
  return counts;
}
