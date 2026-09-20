export type PlannerLayout = "week-grid" | "stacked";

/**
 * Derives the Planner layout purely from the number of selected people.
 * There is deliberately no "view" input: the layout is derived, never requested.
 */
export function resolvePlannerLayout(selectionCount: number): PlannerLayout {
  return selectionCount <= 1 ? "week-grid" : "stacked";
}
