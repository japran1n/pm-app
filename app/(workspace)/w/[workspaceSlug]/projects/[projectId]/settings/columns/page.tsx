import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  canManageColumns,
  type ProjectRole,
  type WorkspaceRole,
} from "@/lib/auth/permissions";
import { StatusManager, type ProjectColumn } from "@/components/project/status-manager";
import { Separator } from "@/components/ui/separator";

// F219: project settings "Board columns" page (AS-404, AS-405, AS-414).
//
// Server Component for data loading (Clarified implementation answer #1) —
// the column list is server-fetched and passed down as typed props; the
// only Client Component is components/project/status-manager.tsx.
//
// Access: same pattern as the sibling settings page
// (app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/page.tsx)
// — this page's own `projects` select goes through the request-scoped,
// RLS-respecting client, so reaching it at all already requires
// `is_project_visible_to` to hold. A caller who cannot see a private
// project gets the same not-found response as a nonexistent project.
export default async function ProjectColumnsSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  const supabase = await createClient();

  // Perf (W9): auth and the workspace-by-slug lookup are independent of
  // each other -- neither reads a value the other produces.
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

  const { data: project } = await supabase
    .from("projects")
    .select("id, workspace_id, name")
    .eq("id", projectId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  // Perf (W9): the caller's workspace role, project role, and the
  // project's own columns each depend only on ids already resolved above
  // (workspace.id, project.id, user.id) -- none depends on another's
  // result -- so all three run as one parallel batch instead of three
  // serial round-trips.
  const [
    { data: ownWorkspaceMembership },
    { data: ownProjectMembership },
    { data: columnsData, error: columnsError },
  ] = await Promise.all([
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
    // AS-404/AS-411 read path: the project's actual columns, in board
    // order. Performance budget (Clarified implementation #8): one query,
    // no per-column follow-up call.
    supabase
      .from("project_statuses")
      .select("id, name, color, category, position")
      .eq("project_id", project.id)
      .order("position", { ascending: true }),
  ]);

  const workspaceRole = (ownWorkspaceMembership?.role ?? "guest") as WorkspaceRole;
  const projectRole = (ownProjectMembership?.project_role ?? null) as ProjectRole;

  const canManage = canManageColumns({ role: workspaceRole, projectRole });

  const columns: ProjectColumn[] = (columnsData ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    category: row.category as ProjectColumn["category"],
    position: row.position,
  }));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Board columns</h1>
        <p className="text-sm text-muted-foreground">
          The columns tasks move through on {project.name}&apos;s board.
        </p>
      </div>

      <Separator />

      {columnsError ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p>Something went wrong loading this project&apos;s board columns. Please try again.</p>
          <a
            href={`/w/${workspaceSlug}/projects/${project.id}/settings/columns`}
            className="underline"
          >
            Retry
          </a>
        </div>
      ) : columns.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This project has no board columns yet.
          {canManage ? " Add one below to get started." : ""}
        </p>
      ) : null}

      {!columnsError && (
        <StatusManager
          projectId={project.id}
          initialColumns={columns}
          canManage={canManage}
        />
      )}
    </div>
  );
}
