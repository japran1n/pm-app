// F010 (AS-050, AS-051, AS-052, AS-053): the workspace home page's
// "My projects" grid — one card per project the caller is a member of
// (F004's `getMyProjectsProgress`), each showing done/total progress,
// next milestone, and overdue count.
//
// Pure Server Component: this card set has no client interactivity of its
// own (no clarified prop for it either — `projects` + `workspaceSlug`
// only), same convention as coming-up-card.tsx.
//
// `nextMilestoneName`/`nextMilestoneDate` are always `null` per F004's own
// query today (documented in lib/queries/projects.ts) — rendered as "–"
// per this feature's clarified "Bottom row" spec until a milestone source
// is wired up (see that file's "Out-of-scope work needed" note).
import Link from "next/link";

import { Card } from "@/components/ui/card";
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
  const { projectId, projectName, doneCount, totalCount, overdueCount, nextMilestoneName } = project;
  const percent = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;

  return (
    <Link href={`/w/${workspaceSlug}/projects/${projectId}`}>
      <Card className="gap-3 p-4 transition-colors hover:border-border-control-hover">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{projectName}</span>
          <span className="font-mono text-sm text-muted-foreground">
            {doneCount}/{totalCount}
          </span>
        </div>

        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-brand"
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate text-muted-foreground">
            {nextMilestoneName ?? "–"}
          </span>
          <span
            className={
              overdueCount > 0
                ? "font-mono text-destructive"
                : "font-mono text-muted-foreground"
            }
          >
            {overdueCount}
          </span>
        </div>
      </Card>
    </Link>
  );
}
