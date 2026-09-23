import Link from "next/link";

import { ProjectHealthBadge } from "@/components/projects/project-health-badge";
import { ProjectCardActions } from "@/components/projects/project-card-actions";
import { ProjectFavoriteButton } from "@/components/project-favorite-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UserAvatarGroup } from "@/components/user-avatar-group";
import { computeTimeLeft, resolveDueDate } from "@/lib/projects/time-left";
import {
  computeProjectHealth,
  PROJECT_HEALTH_BAR_CLASS,
  PROJECT_HEALTH_TEXT_CLASS,
  PROJECT_HEALTH_LABELS,
} from "@/lib/projects/compute-health";
import type {
  ProjectHealthQueryInput,
  ProjectListItem,
  ProjectTeamPreview,
} from "@/lib/queries/projects";

// F004: extracted verbatim from the projects page; rendered output is unchanged.
export function ProjectCard({
  project,
  workspaceId,
  workspaceSlug,
  canArchive,
  canSaveTemplate,
  isFavorite,
  healthInput,
  teamPreview,
}: {
  project: ProjectListItem;
  workspaceId: string;
  workspaceSlug: string;
  canArchive: boolean;
  canSaveTemplate: boolean;
  isFavorite: boolean;
  healthInput: ProjectHealthQueryInput;
  teamPreview?: ProjectTeamPreview;
}) {
  const health = computeProjectHealth(healthInput);
  const healthLabel = PROJECT_HEALTH_LABELS[health];
  const reasons: string[] = [];
  if (healthInput.overdueTaskCount > 0)
    reasons.push(`${healthInput.overdueTaskCount} overdue task${healthInput.overdueTaskCount === 1 ? "" : "s"}`);
  if (healthInput.currentPhase?.name) reasons.push(`current phase: ${healthInput.currentPhase.name}`);
  const healthTitle = reasons.length
    ? `${healthLabel} - ${reasons.join(", ")}`
    : `${healthLabel} - no overdue tasks or phase risk detected`;
  const totalTasks = Math.max(0, healthInput.totalTaskCount);
  const doneTasks = Math.min(
    totalTasks,
    Math.max(0, healthInput.doneTaskCount),
  );
  const progressPercent =
    totalTasks === 0
      ? 0
      : Math.min(100, Math.max(0, Math.round((doneTasks / totalTasks) * 100)));

  const subtitle =
    healthInput.currentPhase?.name?.trim() ||
    (project.description ?? "").split("\n").map((l) => l.trim()).find(Boolean) ||
    null;
  const dueDate = resolveDueDate({
    end_date: project.endDate,
    target_launch_date: project.targetLaunchDate ?? null,
  });

  return (
    <Card
      key={project.id}
      className="group/card hover:border-border-control-hover flex h-full flex-col"
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2 bg-muted/30">
        <Link
          href={`/w/${workspaceSlug}/projects/${project.id}/list`}
          className="flex flex-1 items-start gap-3"
        >
          {/* Ad-hoc "Projects page card redesign": the icon is
                a fixed-size tile a step up in elevation
                (`bg-secondary`, per CLAUDE.md's "reach for the
                next surface step, not a new colour"), rendered to
                the LEFT of the title column instead of inline
                inside the title text — it must never again read
                as part of the title string (e.g. "G Good Guys"). */}
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-sm font-medium text-muted-foreground"
          >
            {project.icon || (
              <span className="text-xs uppercase text-muted-foreground">
                {project.name.charAt(0)}
              </span>
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <CardTitle className="line-clamp-1">{project.name}</CardTitle>
            {subtitle ? (
              <CardDescription className="line-clamp-1">
                {subtitle}
              </CardDescription>
            ) : null}
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-1">
          {/* The favourite star stays mounted and keyboard
                reachable at all times; it's only visually
                present (via opacity, never display:none/
                conditional mounting) when it's not already a
                favourite. */}
          <ProjectFavoriteButton
            projectId={project.id}
            projectName={project.name}
            isFavorite={isFavorite}
            className={
              isFavorite
                ? undefined
                : "opacity-0 transition-opacity duration-200 focus-visible:opacity-100 group-hover/card:opacity-100 group-focus-within/card:opacity-100"
            }
          />
          <div className="opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover/card:opacity-100 group-focus-within/card:opacity-100 [&:has([data-popup-open])]:opacity-100">
            <ProjectCardActions
              workspaceId={workspaceId}
              canArchive={canArchive}
              canSaveTemplate={canSaveTemplate}
              project={{
                id: project.id,
                name: project.name,
                description: project.description,
                startDate: project.startDate,
                endDate: project.endDate,
                icon: project.icon,
              }}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-end gap-3">
        <div className="flex flex-col gap-3 rounded-lg bg-card p-3">
          <p className="text-sm text-muted-foreground">
            {dueDate ? (
              <span data-testid="due-date" className="font-mono">
                {new Intl.DateTimeFormat("en-US", {
                  dateStyle: "medium",
                  timeZone: "UTC",
                }).format(new Date(`${dueDate.slice(0, 10)}T00:00:00Z`))}
              </span>
            ) : (
              "No due date"
            )}
          </p>
          {totalTasks === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks yet</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-mono">{progressPercent}%</span>
              </div>
              <div
                role="progressbar"
                aria-label={`${project.name} task completion`}
                aria-valuenow={progressPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
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
          <div data-testid="card-team">
            {teamPreview && teamPreview.people.length > 0 ? (
              <UserAvatarGroup people={teamPreview.people} limit={4} />
            ) : null}
          </div>
          <Badge
            title={healthTitle}
            data-testid="time-pill"
            className={`font-mono ${PROJECT_HEALTH_TEXT_CLASS[health]}`}
          >
            {computeTimeLeft(dueDate, new Date()) ?? healthLabel}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* AS-034: open (not "done"-category) task count,
                batched in getWorkspaceProjects. `null` only if
                that count query itself failed — an explicit
                "pending" badge rather than a misleading fake 0 in
                that case. */}
          {project.openTaskCount === null ? (
            <Badge
              variant="outline"
              title="Couldn't load the task count — try refreshing"
            >
              Open tasks: pending
            </Badge>
          ) : (
            <Badge variant="secondary">
              <span className="font-mono">{project.openTaskCount}</span> open
              task
              {project.openTaskCount === 1 ? "" : "s"}
            </Badge>
          )}
          {/* Feature request "Project health badge": automatic
                on_track/at_risk/overdue rollup, computed from the
                batched inputs fetched above. */}
          <ProjectHealthBadge health={computeProjectHealth(healthInput)} />
        </div>
      </CardContent>
    </Card>
  );
}
