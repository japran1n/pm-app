"use client";

import Link from "next/link";

import { ProjectHealthBadge } from "@/components/projects/project-health-badge";
import { ProjectCardActions } from "@/components/projects/project-card-actions";
import { ProjectFavoriteButton } from "@/components/project-favorite-button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserAvatarGroup } from "@/components/user-avatar-group";
import { computeTimeLeft, resolveDueDate } from "@/lib/projects/time-left";
import {
  computeProjectHealth,
  PROJECT_HEALTH_TEXT_CLASS,
  PROJECT_HEALTH_LABELS,
} from "@/lib/projects/compute-health";
import type { ProjectsViewItem } from "@/components/projects/projects-view";

// F013 (PL-043, PL-044): the list-view counterpart to `ProjectCard`
// (components/projects/project-card.tsx) — same per-project view model
// (`ProjectsViewItem`, resolved server-side by F011/PL-041's
// `ProjectsGridSection`), same feature parity (favourite star, actions
// menu, health badge, open task count), just laid out as table rows
// instead of cards. Columns per PL-043: Name+phase, Due, Progress, Team,
// Time left, Health, actions — plus the open task count folded into the
// Name+phase cell (clarified "badge or column" answer: kept as an inline
// badge under the name, mirroring the card's own placement, rather than a
// seventh column competing for width on narrow viewports).
export function ProjectListTable({
  items,
  workspaceId,
  workspaceSlug,
  canArchive,
  canSaveTemplate,
}: {
  items: ProjectsViewItem[];
  workspaceId: string;
  workspaceSlug: string;
  canArchive: boolean;
  canSaveTemplate: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Due</TableHead>
          <TableHead>Progress</TableHead>
          <TableHead>Team</TableHead>
          <TableHead>Time left</TableHead>
          <TableHead>Health</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map(({ project, healthInput, isFavorite, teamPreview }) => {
          const health = computeProjectHealth(healthInput);
          const healthLabel = PROJECT_HEALTH_LABELS[health];
          const totalTasks = Math.max(0, healthInput.totalTaskCount);
          const doneTasks = Math.min(
            totalTasks,
            Math.max(0, healthInput.doneTaskCount),
          );
          const progressPercent =
            totalTasks === 0
              ? 0
              : Math.min(
                  100,
                  Math.max(0, Math.round((doneTasks / totalTasks) * 100)),
                );
          const phaseName = healthInput.currentPhase?.name?.trim() || null;
          const dueDate = resolveDueDate({
            end_date: project.endDate,
            target_launch_date: project.targetLaunchDate ?? null,
          });

          return (
            <TableRow key={project.id} className="group/row">
              <TableCell>
                <Link
                  href={`/w/${workspaceSlug}/projects/${project.id}/list`}
                  className="flex min-w-0 flex-col gap-0.5 whitespace-normal"
                >
                  <span className="line-clamp-1 font-medium text-foreground">
                    {project.name}
                  </span>
                  {phaseName ? (
                    <span className="line-clamp-1 text-xs text-muted-foreground">
                      {phaseName}
                    </span>
                  ) : null}
                </Link>
                {/* Clarified: open task count shown alongside the
                    Name+phase cell, same "pending" fallback the card uses
                    when the batched count query itself failed. */}
                <div className="mt-1">
                  {project.openTaskCount === null ? (
                    <Badge
                      variant="outline"
                      title="Couldn't load the task count — try refreshing"
                    >
                      Open tasks: pending
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      <span className="font-mono">{project.openTaskCount}</span>{" "}
                      open task
                      {project.openTaskCount === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="font-mono text-muted-foreground">
                {dueDate ? (
                  <span data-testid="due-date">
                    {new Intl.DateTimeFormat("en-US", {
                      dateStyle: "medium",
                      timeZone: "UTC",
                    }).format(new Date(`${dueDate.slice(0, 10)}T00:00:00Z`))}
                  </span>
                ) : (
                  <span className="font-sans">No due date</span>
                )}
              </TableCell>
              <TableCell>
                {totalTasks === 0 ? (
                  <span className="text-muted-foreground">No tasks yet</span>
                ) : (
                  <div
                    role="progressbar"
                    aria-label={`${project.name} task completion`}
                    aria-valuenow={progressPercent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="flex min-w-[6rem] items-center gap-2"
                  >
                    <span className="font-mono">{progressPercent}%</span>
                  </div>
                )}
              </TableCell>
              <TableCell data-testid="row-team">
                {teamPreview && teamPreview.people.length > 0 ? (
                  <UserAvatarGroup people={teamPreview.people} limit={4} />
                ) : null}
              </TableCell>
              <TableCell
                className={`font-mono ${PROJECT_HEALTH_TEXT_CLASS[health]}`}
              >
                {computeTimeLeft(dueDate, new Date()) ?? healthLabel}
              </TableCell>
              <TableCell>
                <ProjectHealthBadge health={health} />
              </TableCell>
              <TableCell>
                <div className="flex shrink-0 items-center justify-end gap-1">
                  <ProjectFavoriteButton
                    projectId={project.id}
                    projectName={project.name}
                    isFavorite={isFavorite}
                    className={
                      isFavorite
                        ? undefined
                        : "opacity-0 transition-opacity duration-200 focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
                    }
                  />
                  <div className="opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 [&:has([data-popup-open])]:opacity-100">
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
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
