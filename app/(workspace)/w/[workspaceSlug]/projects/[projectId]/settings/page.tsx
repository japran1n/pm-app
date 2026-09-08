import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
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
import {
  getDecisionOwners,
  getProjectClientMembers,
  getProjectDecisionTypes,
  type PortalDecisionOwner,
  type ProjectDecisionType,
} from "@/lib/queries/approvals";
import { DecisionOwnersSection } from "@/components/approvals/decision-owners";
import { RequestApprovalDialog } from "@/components/approvals/request-approval-dialog";
import { canWrite } from "@/lib/auth/permissions";
// F112 (missions/20260903-portal, six-star review Part 0/D): "Team" —
// project roles (PM, team lead, design lead, Webflow lead, designer,
// developer) editor, placed beside "Who approves what" per this
// feature's own spec.
import {
  getProjectRoles,
  getProjectTeamCandidates,
  type ProjectRoleRow,
} from "@/lib/queries/project-roles";
import { ProjectRolesSection } from "@/components/project/project-roles";

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
  let decisionOwners: PortalDecisionOwner[] = [];
  let decisionTypes: ProjectDecisionType[] = [];
  let clientMembers: Awaited<ReturnType<typeof getProjectClientMembers>> = [];
  let projectRoles: ProjectRoleRow[] = [];
  let teamCandidates: Awaited<ReturnType<typeof getProjectTeamCandidates>> = [];
  let loadError = false;

  try {
    // Perf (W9): none of these depend on each other's result --
    // `addable`/`lossPreview` are conditionally fetched (per
    // canManage/canToggleVisibility, both already known), but whenever
    // fetched they run alongside `members` instead of after it.
    let decisionOwnersResult: Awaited<ReturnType<typeof getDecisionOwners>>;
    let decisionTypesResult: Awaited<ReturnType<typeof getProjectDecisionTypes>>;
    let projectRolesResult: Awaited<ReturnType<typeof getProjectRoles>>;
    [
      members,
      addable,
      lossPreview,
      decisionOwnersResult,
      decisionTypesResult,
      clientMembers,
      projectRolesResult,
      teamCandidates,
    ] = await Promise.all([
      getProjectMembers(project.id),
      canManage
        ? getAddableWorkspaceMembers(workspace.id, project.id)
        : Promise.resolve(addable),
      canToggleVisibility
        ? getVisibilityLossPreview(workspace.id, project.id)
        : Promise.resolve(lossPreview),
      getDecisionOwners(project.id),
      getProjectDecisionTypes(project.id),
      getProjectClientMembers(workspace.id),
      getProjectRoles(project.id),
      getProjectTeamCandidates(workspace.id, project.id),
    ]);
    // F079 (missions/20260903-portal audit, defect 1): `getDecisionOwners`
    // now reports a failed read as `{ ok: false }` rather than silently
    // coalescing it to `[]` (see that function's own header comment) --
    // folded into this page's existing `loadError` state, the same
    // "couldn't load" fallback every other read on this page already
    // shares on a thrown error, rather than a fourth, differently-shaped
    // failure state just for this one field.
    if (!decisionOwnersResult.ok) {
      throw new Error(decisionOwnersResult.error);
    }
    decisionOwners = decisionOwnersResult.data;
    if (!decisionTypesResult.ok) {
      throw new Error(decisionTypesResult.error);
    }
    decisionTypes = decisionTypesResult.data;
    if (!projectRolesResult.ok) {
      throw new Error(projectRolesResult.error);
    }
    projectRoles = projectRolesResult.data;
  } catch (error) {
    logger.error("ProjectSettingsPage: failed to load member data", { error: error });
    loadError = true;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="title-1 font-semibold">Project settings</h1>
          <p className="text-mini text-muted-foreground">
            Members and visibility for {project.name}.
          </p>
        </div>
        {/* Internal-meeting print/export snapshot — NOT a client invoicing
            artifact (this feature's own spec). Opens the print-optimized
            /print route in a new tab; the browser's own "Print to PDF"
            (Cmd+P) is how the user saves it, so this is a plain link, no
            server-side PDF generation. */}
        <Link
          href={`/w/${workspaceSlug}/projects/${project.id}/print`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Print/Export summary
        </Link>
      </div>

      <ProjectSettingsNav workspaceSlug={workspaceSlug} projectId={project.id} />

      {loadError && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-mini text-destructive"
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
            <h2 className="text-mini font-semibold">Visibility</h2>
            {canToggleVisibility ? (
              <ProjectVisibilityToggle
                projectId={project.id}
                visibility={visibility}
                lossPreview={lossPreview}
              />
            ) : (
              <p className="text-mini text-muted-foreground">
                This project is{" "}
                {visibility === "private" ? "private" : "visible to the whole workspace"}
                . Only a workspace owner or admin can change this.
              </p>
            )}
          </section>

          <Separator />

          <section className="flex flex-col gap-3">
            <h2 className="text-mini font-semibold">Project members</h2>
            <p className="text-mini text-muted-foreground">
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
              <h2 className="text-mini font-semibold">Add a member</h2>
              <p className="text-mini text-muted-foreground">
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
                <h2 className="text-mini font-semibold">Who approves what</h2>
                <p className="text-mini text-muted-foreground">
                  Which client decides each kind of approval for this
                  project. Add or remove decision types below, and set who
                  decides each one — a request raised for a decision type
                  with no owner set here is blocked before it can be sent.
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
                    className="text-mini underline underline-offset-2 hover:text-foreground"
                  >
                    Request approval for a link
                  </button>
                }
              />
            </div>
            <DecisionOwnersSection
              projectId={project.id}
              owners={decisionOwners}
              decisionTypes={decisionTypes}
              clientMembers={clientMembers}
              canManage={canManageDecisionOwners}
            />
          </section>

          <Separator />

          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-mini font-semibold">Team</h2>
              <p className="text-mini text-muted-foreground">
                Who does what on this project — PM, team lead, design lead,
                Webflow lead, designer, developer. Shown to the client on
                the portal&apos;s Your team card, team lead first.
              </p>
            </div>
            <ProjectRolesSection
              projectId={project.id}
              roles={projectRoles}
              candidates={teamCandidates}
              canManage={canManageDecisionOwners}
            />
          </section>
        </>
      )}
    </div>
  );
}
