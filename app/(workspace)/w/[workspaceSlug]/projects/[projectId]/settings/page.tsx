import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  canChangeProjectVisibility,
  canManageProjectMembers,
  type ProjectRole,
  type WorkspaceRole,
} from "@/lib/auth/permissions";
import { logger } from "@/lib/observability/logger";
import {
  getAddableWorkspaceMembers,
  getProjectMembers,
  getVisibilityLossPreview,
} from "@/lib/queries/project-members";
import {
  AddProjectMemberForm,
  ProjectMembersList,
  ProjectVisibilityToggle,
} from "@/components/project/project-members";
// F002 (missions/20260903-portal): lets this page link to the sibling
// columns/phases settings routes — see that component's own doc comment.
import { ProjectSettingsNav } from "@/components/project/project-settings-nav";
import { Separator } from "@/components/ui/separator";
// F008 (missions/20260903-portal, section 4): "Who approves what" — and,
// per this feature's own "Files (approximate)" list naming "project
// settings route" (no separate "project approvals area" route exists or
// is planned by this milestone), the standalone artifact-approval entry
// point lives here too rather than a new page.
import { getDecisionOwners, getProjectClientMembers } from "@/lib/queries/approvals";
import { DecisionOwnersSection } from "@/components/approvals/decision-owners";
import { RequestApprovalDialog } from "@/components/approvals/request-approval-dialog";
import { canWrite } from "@/lib/auth/permissions";

// F133: project settings panel — explicit member list (AS-236), an
// add-member picker scoped to existing workspace members, a remove
// control gated by F127's permission predicates, and a workspace/private
// visibility toggle with a loss-of-access warning (AS-225 end-to-end
// through this action/UI path).
//
// Server Component for data loading (clarified spec) — every list here is
// server-fetched and passed down as typed props; the only Client
// Components are the specific interactive controls in
// components/project/project-members.tsx.
//
// Access: this page does its own RLS-respecting visibility check (the
// `projects` select below goes through the request-scoped client, not the
// admin client the parent layout uses to always resolve archived/private
// projects) — reaching this page requires the caller to actually be able
// to see the project per `is_project_visible_to` (F132), same "page needs
// its own gate beyond bare workspace membership" pattern the workspace
// members page already established for guests (AS-222). A caller who
// cannot see a private project gets the same not-found response as a
// nonexistent project, mirroring the project layout's own AS-039/AS-040
// "don't distinguish doesn't-exist from no-access" rationale.
export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  const supabase = await createClient();

  // Perf (W9): auth and the workspace-by-slug lookup are independent of
  // each other.
  const [
    {
      data: { user },
    },
    { data: workspace },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("workspaces").select("id, name").eq("slug", workspaceSlug).maybeSingle(),
  ]);

  if (!user) {
    redirect("/sign-in");
  }

  if (!workspace) {
    redirect("/onboarding");
  }

  // RLS-scoped (`projects_select_active_members` -> `is_project_visible_to`):
  // a null result here means either the project doesn't exist, belongs to a
  // different workspace, or the caller cannot see it (private project,
  // caller not an explicit member and not owner/admin) — collapsed into
  // one notFound() the same way the parent layout collapses AS-039/AS-040.
  const { data: project } = await supabase
    .from("projects")
    .select("id, workspace_id, name, visibility")
    .eq("id", projectId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const visibility = (project.visibility === "private" ? "private" : "workspace") as
    | "workspace"
    | "private";

  // Perf (W9): both depend only on ids already known (workspace.id,
  // project.id, user.id), not on each other's result.
  const [{ data: ownWorkspaceMembership }, { data: ownProjectMembership }] =
    await Promise.all([
      supabase
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", workspace.id)
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle(),
      supabase
        .from("project_members")
        .select("project_role")
        .eq("project_id", project.id)
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

  const workspaceRole = (ownWorkspaceMembership?.role ?? "guest") as WorkspaceRole;
  const projectRole = (ownProjectMembership?.project_role ?? null) as ProjectRole;

  const canManage = canManageProjectMembers({
    role: workspaceRole,
    projectRole,
  });
  const canToggleVisibility = canChangeProjectVisibility({ role: workspaceRole });
  // F008: setDecisionOwner/requestApproval (lib/actions/approvals.ts) both
  // gate on withAuthz's default `canWrite` — this mirrors that exact
  // predicate for the UI, not a new one, per AS-230's "one permission
  // helper backs both" convention.
  const canManageDecisionOwners = canWrite({ role: workspaceRole });

  let members: Awaited<ReturnType<typeof getProjectMembers>> = [];
  let addable: Awaited<ReturnType<typeof getAddableWorkspaceMembers>> = [];
  let lossPreview: Awaited<ReturnType<typeof getVisibilityLossPreview>> = [];
  let decisionOwners: Awaited<ReturnType<typeof getDecisionOwners>> = [];
  let clientMembers: Awaited<ReturnType<typeof getProjectClientMembers>> = [];
  let loadError = false;

  try {
    // Perf (W9): none of these depend on each other's result --
    // `addable`/`lossPreview` are conditionally fetched (per
    // canManage/canToggleVisibility, both already known), but whenever
    // fetched they run alongside `members` instead of after it.
    [members, addable, lossPreview, decisionOwners, clientMembers] = await Promise.all([
      getProjectMembers(project.id),
      canManage
        ? getAddableWorkspaceMembers(workspace.id, project.id)
        : Promise.resolve(addable),
      canToggleVisibility
        ? getVisibilityLossPreview(workspace.id, project.id)
        : Promise.resolve(lossPreview),
      getDecisionOwners(project.id),
      getProjectClientMembers(workspace.id),
    ]);
  } catch (error) {
    logger.error("ProjectSettingsPage: failed to load member data", { error: error });
    loadError = true;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Project settings</h1>
        <p className="text-sm text-muted-foreground">
          Members and visibility for {project.name}.
        </p>
      </div>

      <ProjectSettingsNav workspaceSlug={workspaceSlug} projectId={project.id} />

      {loadError && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p>Something went wrong loading this project&apos;s settings. Please try again.</p>
          <a
            href={`/w/${workspaceSlug}/projects/${project.id}/settings`}
            className="underline"
          >
            Retry
          </a>
        </div>
      )}

      {!loadError && (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">Visibility</h2>
            {canToggleVisibility ? (
              <ProjectVisibilityToggle
                projectId={project.id}
                visibility={visibility}
                lossPreview={lossPreview}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                This project is{" "}
                {visibility === "private" ? "private" : "visible to the whole workspace"}
                . Only a workspace owner or admin can change this.
              </p>
            )}
          </section>

          <Separator />

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">Project members</h2>
            <p className="text-sm text-muted-foreground">
              People explicitly scoped to this project, with their project
              role and who added them.
            </p>
            <ProjectMembersList
              projectId={project.id}
              members={members}
              canManage={canManage}
              currentUserId={user.id}
              callerCanAdministerProject={canManage}
            />
          </section>

          {canManage && (
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold">Add a member</h2>
              <p className="text-sm text-muted-foreground">
                Only people who are already workspace members can be added —
                inviting someone new to the workspace happens from the
                workspace members page.
              </p>
              <AddProjectMemberForm projectId={project.id} addable={addable} />
            </section>
          )}

          <Separator />

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-sm font-semibold">Who approves what</h2>
                <p className="text-sm text-muted-foreground">
                  Which client decides content, brand, technical, and
                  commercial approvals for this project. A request raised
                  for a decision type with no owner set here is blocked
                  before it can be sent.
                </p>
              </div>
              {/* F008 section 1: the standalone entry point for an
                  external artifact URL — this feature's own "Files
                  (approximate)" list names "project settings route" and no
                  separate approvals-area route, so it lives here. */}
              <RequestApprovalDialog
                projectId={project.id}
                subject={{ subjectType: "artifact" }}
                trigger={
                  <button
                    type="button"
                    className="text-sm underline underline-offset-2 hover:text-foreground"
                  >
                    Request approval for a link
                  </button>
                }
              />
            </div>
            <DecisionOwnersSection
              projectId={project.id}
              owners={decisionOwners}
              clientMembers={clientMembers}
              canManage={canManageDecisionOwners}
            />
          </section>
        </>
      )}
    </div>
  );
}
