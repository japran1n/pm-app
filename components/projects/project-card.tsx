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
import { computeProjectHealth } from "@/lib/projects/compute-health";
import type {
  ProjectHealthQueryInput,
  ProjectListItem,
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
}: {
  project: ProjectListItem;
  workspaceId: string;
  workspaceSlug: string;
  canArchive: boolean;
  canSaveTemplate: boolean;
  isFavorite: boolean;
  healthInput: ProjectHealthQueryInput;
}) {
  const totalTasks = Math.max(0, healthInput.totalTaskCount);
  const doneTasks = Math.min(
    totalTasks,
    Math.max(0, healthInput.doneTaskCount),
  );
  const progressPercent =
    totalTasks === 0
      ? 0
      : Math.min(100, Math.max(0, Math.round((doneTasks / totalTasks) * 100)));

  return (
    <Card
      key={project.id}
      className="group/card hover-lift flex h-full flex-col"
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2">
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
            <CardDescription className="line-clamp-2 flex-1">
              {project.description || "No description."}
            </CardDescription>
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
        {/* Ad-hoc "Projects page card redesign": the one new
              metric — a done/total progress bar, derived from
              `getProjectHealthInputs`'s own `taskRows` (single
              consistent definition of "done", never mixed with
              `openTaskCount`'s RPC-based definition below). */}
        {totalTasks === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks yet</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div
              role="progressbar"
              aria-label={`${project.name} task completion`}
              aria-valuenow={progressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">
                {doneTasks}/{totalTasks}
              </span>{" "}
              done
            </p>
          </div>
        )}
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
