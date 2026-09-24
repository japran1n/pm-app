// F010 (AS-050, AS-051, AS-052, AS-053): the workspace home page's
// "My projects" grid — one card per project the caller is a member of
// (F004's `getMyProjectsProgress`), styled to match the projects page's
// ProjectCard (F002 of the dashboard-project-cards mission): icon tile +
// title + phase/description subtitle, a due-date + health-coloured
// progress panel, and a health badge + time-left badge footer.
//
// Pure Server Component: this card set has no client interactivity of its
// own (no clarified prop for it either — `projects` + `workspaceSlug`
// only), same convention as coming-up-card.tsx.
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProjectHealthBadge } from "@/components/projects/project-health-badge";
import { computeTimeLeft, resolveDueDate } from "@/lib/projects/time-left";
import {
  computeProjectHealth,
  PROJECT_HEALTH_BAR_CLASS,
  PROJECT_HEALTH_TEXT_CLASS,
  PROJECT_HEALTH_LABELS,
} from "@/lib/projects/compute-health";
import type { MyProjectProgress } from "@/lib/queries/projects";

export type MyProjectsGridProps = {
  projects: MyProjectProgress[];
  workspaceSlug: string;
};

export function MyProjectsGrid({ projects, workspaceSlug }: MyProjectsGridProps) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">My projects</h2>
        <Link
          href={`/w/${workspaceSlug}/projects`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          All projects →
        </Link>
      </div>

      {projects.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">
            You&apos;re not a member of any active project.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-1 md:grid-cols-2">
          {projects.map((project) => (
            <MyProjectCard key={project.projectId} project={project} workspaceSlug={workspaceSlug} />
          ))}
        </div>
      )}
    </section>
  );
}

function MyProjectCard({
  project,
  workspaceSlug,
}: {
  project: MyProjectProgress;
  workspaceSlug: string;
}) {
  const {
    projectId,
    projectName,
    icon,
    description,
    endDate,
    targetLaunchDate,
    currentPhase,
    doneCount,
    totalCount,
    overdueCount,
  } = project;

  const health = computeProjectHealth({
    overdueTaskCount: overdueCount,
    totalTaskCount: totalCount,
    currentPhase: currentPhase
      ? {
          state: currentPhase.state as "not_started" | "active" | "blocked" | "done",
          plannedStart: currentPhase.plannedStart,
          plannedEnd: currentPhase.plannedEnd,
        }
      : null,
  });

  const progressPercent =
    totalCount === 0 ? 0 : Math.min(100, Math.round((doneCount / totalCount) * 100));

  const dueDate = resolveDueDate({
    end_date: endDate,
    target_launch_date: targetLaunchDate ?? null,
  });

  const subtitle =
    currentPhase?.name?.trim() ||
    (description ?? "").split("\n").map((l) => l.trim()).find(Boolean) ||
    null;

  return (
    <Link href={`/w/${workspaceSlug}/projects/${projectId}`}>
      <Card className="group/card hover:border-border-control-hover flex h-full flex-col transition-colors">
        <CardHeader className="flex flex-row items-start gap-3 bg-muted/30">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-sm font-medium text-muted-foreground"
          >
            {icon || (
              <span className="text-xs uppercase text-muted-foreground">
                {projectName.charAt(0)}
              </span>
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <CardTitle className="line-clamp-1">{projectName}</CardTitle>
            {subtitle ? (
              <CardDescription className="line-clamp-1">{subtitle}</CardDescription>
            ) : null}
          </span>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col justify-end gap-3">
          <div className="flex flex-col gap-3 rounded-lg bg-secondary p-3">
            <p className="text-sm text-muted-foreground">
              {dueDate ? (
                <span className="font-mono">
                  {new Intl.DateTimeFormat("en-US", {
                    dateStyle: "medium",
                    timeZone: "UTC",
                  }).format(new Date(`${dueDate.slice(0, 10)}T00:00:00Z`))}
                </span>
              ) : (
                "No due date"
              )}
            </p>
            {totalCount === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks yet</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-mono">{progressPercent}%</span>
                </div>
                <div
                  role="progressbar"
                  aria-label={`${projectName} task completion`}
                  aria-valuenow={progressPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-1.5 w-full overflow-hidden rounded-full bg-border/60"
                >
                  <div
                    className={`h-full rounded-full ${PROJECT_HEALTH_BAR_CLASS[health]} transition-[width] duration-200`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <ProjectHealthBadge health={health} />
            <Badge className={`font-mono ${PROJECT_HEALTH_TEXT_CLASS[health]}`}>
              {computeTimeLeft(dueDate, new Date()) ?? PROJECT_HEALTH_LABELS[health]}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
