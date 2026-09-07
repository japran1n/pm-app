// Feature request "Project health badge": renders the automatically
// computed on_track/at_risk/overdue rollup (lib/projects/compute-health.ts)
// using the shared StatusBadge (components/ui/status-badge.tsx) — same
// colour-dot-and-label visual language every other static status display in
// the app already uses, rather than a one-off badge here.
import { StatusBadge } from "@/components/ui/status-badge";
import {
  PROJECT_HEALTH_COLORS,
  PROJECT_HEALTH_LABELS,
  type ProjectHealth,
} from "@/lib/projects/compute-health";

export function ProjectHealthBadge({
  health,
  className,
}: {
  health: ProjectHealth;
  className?: string;
}) {
  return (
    <StatusBadge
      label={PROJECT_HEALTH_LABELS[health]}
      color={PROJECT_HEALTH_COLORS[health]}
      className={className}
      data-testid={`project-health-badge-${health}`}
    />
  );
}
