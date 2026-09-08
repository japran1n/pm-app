import { redirect } from "next/navigation";
import { Archive } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getArchivedWorkspaceProjects } from "@/lib/queries/projects";
import { RestoreProjectButton } from "@/components/project/restore-project-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { logger } from "@/lib/observability/logger";

// F142 (AS-250, AS-251, AS-256): the workspace archive view — every
// archived project (`projects.deleted_at IS NOT NULL`) in the active
// workspace, with when it was archived and by whom.
//
// Access: reachable by any active, non-guest member — same gate the
// sidebar entry itself uses (`components/nav/app-sidebar.tsx`'s
// `isGuest` prop, already computed once in the workspace layout, F135).
// A guest hitting this URL directly is redirected before the archived
// project query runs, mirroring the members page's `canViewMembersList`
// pattern (F134) rather than inventing a new gate. Guests are scoped to
// specific projects they've been added to (F134's AS-223), and the
// archive is a workspace-wide admin-adjacent view of every project
// (active or not) in the workspace, which is exactly the kind of
// workspace-broad visibility a guest should not get.
//
// Server Component: data loads here and is passed down as props; there is
// no interactive/mutating control on this page (archived projects are
// read-only history, no "unarchive" action exists yet — out of scope, see
// this feature's handoff).
export default async function ArchivePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  // Defensive fallback only — the layout guard above already redirects
  // away when the workspace can't be resolved for this caller.
  if (!workspace) {
    redirect("/onboarding");
  }

  const { data: ownMembership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  const role = ownMembership?.role ?? "guest";

  // AS-256/access: page-level gate for guests, evaluated before the
  // archived-projects query runs — same "redirect away, not just hide UI"
  // convention as the audit log page (app/(workspace)/w/[workspaceSlug]/
  // settings/audit/page.tsx, F141).
  if (role === "guest") {
    redirect(`/w/${workspaceSlug}`);
  }

  // F143 (AS-253): the restore control is only rendered for admin/owner —
  // same role gate `requireWorkspaceAdmin` enforces server-side in
  // `restoreProject` (lib/actions/projects.ts). A plain member/viewer can
  // still view the archive (per F142's page-level gate above) but sees no
  // restore affordance; the server-side re-check remains the real
  // enforcement boundary if this action were ever called directly.
  const canRestore = role === "owner" || role === "admin";

  let archivedProjects: Awaited<
    ReturnType<typeof getArchivedWorkspaceProjects>
  > | null = null;
  let loadError = false;

  try {
    archivedProjects = await getArchivedWorkspaceProjects(workspace.id);
  } catch (error) {
    logger.error("ArchivePage: failed to load archived projects", { error: error });
    loadError = true;
  }

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  });

  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="title-1 font-semibold">Archive</h1>
        <p className="text-mini text-muted-foreground">
          Projects archived from {workspace.name}. Archiving hides a project
          from the active list without deleting its data.
        </p>
      </div>

      {loadError && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-mini text-destructive"
        >
          <p>Something went wrong loading the archive. Please try again.</p>
          <a href={`/w/${workspaceSlug}/archive`} className="underline">
            Retry
          </a>
        </div>
      )}

      {/* AS-256: purposeful empty state, same structural pattern this
          codebase's other per-view empty states already use (e.g.
          components/board/board-empty-state.tsx) — what this view is for,
          no dead-end blank area or bare "No data" string. No primary
          action is offered here: there is nothing a user can *do* from an
          empty archive (projects land here only via the Archive action on
          the projects list, not from this page), so the empty state is
          explanatory only, matching this view's read-only nature. */}
      {archivedProjects && archivedProjects.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-16 text-center">
          <div
            aria-hidden="true"
            className="flex size-12 items-center justify-center rounded-full bg-muted"
          >
            <Archive className="size-6 text-muted-foreground" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-mini font-medium">No archived projects</p>
            <p className="text-mini text-muted-foreground">
              Projects you archive from the project list will show up here,
              along with when they were archived and by whom.
            </p>
          </div>
        </div>
      )}

      {archivedProjects && archivedProjects.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {archivedProjects.map((project) => (
            <Card key={project.id}>
              <CardHeader>
                <CardTitle className="line-clamp-1">{project.name}</CardTitle>
                <CardDescription className="line-clamp-2">
                  {project.description || "No description."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Badge variant="secondary">
                  {project.taskCount} task{project.taskCount === 1 ? "" : "s"}
                </Badge>
                {/* AS-251: when archived and by whom. `archivedByName` is
                    null when the archiver couldn't be resolved (e.g. the
                    F142 `archived_by` migration not yet applied to the
                    live project — see lib/queries/projects.ts's
                    `getArchivedWorkspaceProjects` doc comment — or a user
                    account that's since been deleted), in which case only
                    the date is shown rather than a fabricated name. */}
                <p className="text-micro text-muted-foreground">
                  Archived {dateFormatter.format(new Date(project.archivedAt))}
                  {project.archivedByName
                    ? ` by ${project.archivedByName}`
                    : ""}
                </p>
                {/* F143 (AS-252, AS-253): restore control, admin/owner
                    only. */}
                {canRestore && (
                  <div className="pt-1">
                    <RestoreProjectButton
                      workspaceId={workspace.id}
                      project={{ id: project.id, name: project.name }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
