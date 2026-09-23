import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RestoreProjectButton } from "@/components/project/restore-project-button";

// F008 (PL-030): archived cards share the same frame as the active
// ProjectCard (components/projects/project-card.tsx) -- same Card shell,
// same icon tile + title/description CardHeader zone, same rounded inner
// panel in CardContent -- per the clarified spec's "share styling rather
// than duplicating" instruction. Body content differs: archived date/by
// (mono date, per CLAUDE.md "data is mono") replaces progress/team, and
// Restore (admin/owner only) replaces the actions menu.
export type ArchivedProjectCardProject = {
  id: string;
  name: string;
  description: string | null;
  taskCount: number;
  archivedAt: string;
  archivedByName: string | null;
};

export function ArchivedProjectCard({
  project,
  workspaceId,
  canRestore,
}: {
  project: ArchivedProjectCardProject;
  workspaceId: string;
  canRestore: boolean;
}) {
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  });

  return (
    <Card className="group/card hover:border-border-control-hover flex h-full flex-col">
      <CardHeader className="flex flex-row items-start justify-between gap-2 bg-muted/30">
        <div className="flex flex-1 items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-sm font-medium text-muted-foreground"
          >
            <span className="text-xs uppercase text-muted-foreground">
              {project.name.charAt(0)}
            </span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <CardTitle className="line-clamp-1">{project.name}</CardTitle>
            <CardDescription className="line-clamp-1">
              {project.description || "No description."}
            </CardDescription>
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-end gap-3">
        <div className="flex flex-col gap-3 rounded-lg bg-card p-3">
          <Badge variant="secondary">
            <span className="font-mono">{project.taskCount}</span> task
            {project.taskCount === 1 ? "" : "s"}
          </Badge>
          <p className="text-sm text-muted-foreground">
            Archived{" "}
            <span data-testid="archived-date" className="font-mono">
              {dateFormatter.format(new Date(project.archivedAt))}
            </span>
            {project.archivedByName ? ` by ${project.archivedByName}` : ""}
          </p>
        </div>
        {canRestore && (
          <div className="flex items-center justify-end">
            <RestoreProjectButton
              workspaceId={workspaceId}
              project={{ id: project.id, name: project.name }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
