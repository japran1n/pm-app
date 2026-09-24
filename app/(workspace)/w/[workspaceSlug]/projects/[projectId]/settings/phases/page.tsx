import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/queries/workspaces";
import { canTeamWrite } from "@/lib/auth/permissions";
import { getProjectPhasesForTeam } from "@/lib/queries/phases";
import { PhaseList } from "@/components/project/phase-list";
// F002 (missions/20260903-portal): lets this page link to the sibling
// members/columns settings routes — see that component's own doc comment.
import { Separator } from "@/components/ui/separator";

// F002 (missions/20260903-portal): project settings "Phases" page
// (AS-008). Mirrors the sibling settings/columns/page.tsx (F219) exactly
// in structure and chrome, per this feature's own Notes ("Read
// settings/columns/page.tsx ... this feature is deliberately the same
// shape one level over").
//
// Server Component for data loading — the phase list is server-fetched
// (getProjectPhasesForTeam, lib/queries/phases.ts) and passed down as
// typed props; the only Client Component is components/project/
// phase-list.tsx.
//
// Access: same pattern as settings/columns/page.tsx — this page's own
// `projects` select goes through the request-scoped, RLS-respecting
// client, so reaching it at all already requires `is_project_visible_to`
// to hold. A caller who cannot see a private project gets the same
// not-found response as a nonexistent project.
//
// `canManage` uses `withAuthz`'s DEFAULT write predicate, `canTeamWrite`
// (owner/admin/member), rather than `canManageColumns` — this mirrors
// lib/actions/phases.ts's own choice (see that file's header comment):
// every mutation action here is gated by `withAuthz`'s default
// `canTeamWrite`, so the UI's enabled/disabled state must agree with what the
// server actually allows, not with a stricter sibling predicate that
// would silently disable controls the server would have accepted.
export default async function ProjectPhasesSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  const supabase = await createClient();

  // ARCH-001: caller identity, the workspace-by-slug lookup, and the
  // caller's own membership role all come from the shared cached helper
  // (lib/queries/workspaces.ts) instead of three per-page queries.
  const ctx = await getWorkspaceContext(workspaceSlug);

  if (!ctx.user) {
    redirect("/sign-in");
  }

  if (!ctx.workspace) {
    redirect("/onboarding");
  }

  const { workspace, role: workspaceRole } = ctx;

  const { data: project } = await supabase
    .from("projects")
    .select("id, workspace_id, name, baseline_frozen_at")
    .eq("id", projectId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const phases = await getProjectPhasesForTeam(project.id);

  const canManage = canTeamWrite({ role: workspaceRole });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Phases</h1>
        <p className="text-sm text-muted-foreground">
          The ordered phases {project.name} moves through, and what the
          client sees for each one.
        </p>
      </div>


      <Separator />

      <PhaseList
        projectId={project.id}
        initialPhases={phases}
        canManage={canManage}
        baselineFrozen={project.baseline_frozen_at !== null}
      />
    </div>
  );
}
