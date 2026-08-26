// UX-24: internal status vocabulary (`in_review`, `backlog`, `todo`, the
// word "task" itself) is written for the team, not for a client — and
// "backlog" in particular reads as *behind*, when it means the opposite
// (planned, not yet started). This is the one place the portal translates
// a raw status/category into words a client actually reads correctly.
import type { StatusCategory } from "@/lib/queries/portal";

export function clientStatusLabel(
  category: StatusCategory,
  rawStatus: string,
): string {
  if (/review/i.test(rawStatus)) return "Waiting on your review";
  if (category === "done") return "Delivered";
  if (category === "in_progress") return "In progress";
  return "Planned";
}

export function projectHealthLabel(project: {
  overdueCount: number;
  percentComplete: number | null;
}): { label: string; tone: "ok" | "warn" | "crit" } {
  if (project.overdueCount > 0) {
    return { label: "Needs attention", tone: "crit" };
  }
  if (project.percentComplete !== null && project.percentComplete >= 100) {
    return { label: "Complete", tone: "ok" };
  }
  return { label: "On track", tone: "ok" };
}
