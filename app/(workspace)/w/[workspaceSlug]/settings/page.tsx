import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import {
  canManageProject,
  canDeleteWorkspace,
  type WorkspaceRole,
} from "@/lib/auth/permissions";
import { WorkspaceGeneralForm } from "@/components/workspace/workspace-general-form";
import { DeleteWorkspaceDialog } from "@/components/workspace/delete-workspace-dialog";

// F136 (AS-239, AS-240, AS-244): the workspace settings page — general
// section (name, slug, logo placeholder) plus a danger zone with the
// owner-gated delete-workspace control, and links out to the members
// settings tab. Server Component for data loading, Client Component only
// for interaction (rename form, delete dialog), per the clarified spec's
// default pattern.
//
// AS-239: reachable from the sidebar for owners AND admins (see
// components/nav/app-sidebar.tsx's "Settings" nav item, gated via this
// same `canManageProject` predicate) — a plain member/viewer/guest is
// not shown that nav link, but this page itself only denies "guest"
// below (matching the members settings page's own gate), so a member who
// types the URL directly still sees the page in a read-only state rather
// than being bounced — there is no assertion requiring a member-level
// deny here, and AS-239 only speaks to the nav item's own visibility.
//
// Access: relies on the workspace-membership layout guard above this
// route (F010/F023) for "is an active member of this workspace" — this
// page adds its own `canManageProject`/`canDeleteWorkspace` checks only
// to decide what's rendered *interactive*, matching AS-230's "single
// permission helper backs both UI gating and the server-side re-check"
// convention (the actual enforcement lives in `renameWorkspace` and
// `deleteWorkspace` themselves).
export default async function WorkspaceSettingsPage({
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
    .select("id, name, slug, logo_url")
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

  const role = (ownMembership?.role ?? "guest") as WorkspaceRole;

  // F134 (AS-222) convention: a guest cannot reach workspace settings at
  // all, matching the members settings page's own gate — deny, not
  // merely hide, so direct navigation is also rejected.
  if (role === "guest") {
    redirect(`/w/${workspaceSlug}`);
  }

  const canManage = canManageProject({ role });
  const canDelete = canDeleteWorkspace({ role });

  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          General settings for {workspace.name}.
        </p>
      </div>

      <nav className="flex gap-4 border-b text-sm font-medium">
        <span className="border-b-2 border-primary px-1 pb-2">General</span>
        <Link
          href={`/w/${workspaceSlug}/settings/members`}
          className="px-1 pb-2 text-muted-foreground hover:text-foreground"
        >
          Members
        </Link>
        <Link
          href={`/w/${workspaceSlug}/settings/status-templates`}
          className="px-1 pb-2 text-muted-foreground hover:text-foreground"
        >
          Status templates
        </Link>
        <Link
          href={`/w/${workspaceSlug}/settings/task-types`}
          className="px-1 pb-2 text-muted-foreground hover:text-foreground"
        >
          Task types
        </Link>
      </nav>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">General</h2>
        <WorkspaceGeneralForm
          workspaceId={workspace.id}
          name={workspace.name}
          slug={workspace.slug}
          logoUrl={workspace.logo_url}
          canManage={canManage}
        />
      </section>

      {canDelete && (
        <section className="flex flex-col gap-4 rounded-lg border border-destructive/50 p-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-destructive">
              Danger zone
            </h2>
            <p className="text-sm text-muted-foreground">
              Deleting this workspace removes it for every member. This
              cannot be undone from the UI.
            </p>
          </div>
          <div>
            <DeleteWorkspaceDialog
              workspaceId={workspace.id}
              workspaceName={workspace.name}
            />
          </div>
        </section>
      )}
    </div>
  );
}
