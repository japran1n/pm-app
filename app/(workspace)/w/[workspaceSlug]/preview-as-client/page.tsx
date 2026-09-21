import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireWorkspaceAdmin } from "@/lib/auth/require-membership";
import { getPreviewableClients } from "@/lib/queries/portal-preview";
import { getPortalProjects } from "@/lib/queries/portal";
import { Users } from "lucide-react";

import { ClientPreviewForm } from "@/components/portal/client-preview-form";
import { EmptyState } from "@/components/empty-state";

// F024 (missions/20260903-portal, AS-052): the standalone route --
// "pick a client member of a project, then render the real portal". The
// one-click shortcut (task detail sheet / doc header "View as client")
// forwards here with `?projectId=` and, for a task, `?taskId=` already
// filled in; this page is also the fallback for a cold start.
//
// Owner/admin only (this feature's spec, section 3), enforced here with a
// hard redirect -- not merely a hidden nav item -- because the
// clarified definition of done's failure test (a) requires a `member`
// role to be unable to REACH this route, not just see fewer controls on
// it (unlike WorkspaceSettingsPage's own "member sees a read-only page"
// convention, which does not apply here: this page's entire purpose is
// to mint a session for another identity, so there is nothing safe to
// render for a non-admin at all).
export const dynamic = "force-dynamic";

export default async function PreviewAsClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ projectId?: string; taskId?: string }>;
}) {
  const { workspaceSlug } = await params;
  const { projectId, taskId } = await searchParams;

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) {
    notFound();
  }

  const admin = createAdminClient();
  const membership = await requireWorkspaceAdmin(admin, workspace.id, user.id);

  if (!membership.ok) {
    redirect(`/w/${workspace.slug}`);
  }

  const [clients, projects] = await Promise.all([
    getPreviewableClients(workspace.id),
    getPortalProjects(workspace.id),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-[0.07em] text-muted-foreground">
          Client Preview
        </p>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              View the portal as a client
            </h1>
            <p className="text-sm text-muted-foreground">
              Pick a client to see exactly what they see, produced through
              their own account and permissions.
            </p>
          </div>
          <span className="mt-1 flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
            <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
            Logged to audit
          </span>
        </div>
      </div>

      {clients.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No clients yet"
          description="Invite a client to this workspace before previewing the portal as them."
        />
      ) : (
        <ClientPreviewForm
          workspaceId={workspace.id}
          workspaceSlug={workspace.slug}
          clients={clients}
          projects={projects.map((project) => ({
            id: project.id,
            name: project.name,
          }))}
          initialProjectId={projectId}
          initialTaskId={taskId}
        />
      )}
    </div>
  );
}
