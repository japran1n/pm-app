import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  canManageColumns,
  type ProjectRole,
  type WorkspaceRole,
} from "@/lib/auth/permissions";
import {
  CustomFieldsManager,
  type ProjectCustomFieldRow,
} from "@/components/project/custom-fields-manager";
import { ProjectSettingsNav } from "@/components/project/project-settings-nav";
import { Separator } from "@/components/ui/separator";

// Project settings "Custom fields" page — flexible, project-scoped extra
// fields on tasks (e.g. "Client number", "Figma frame link"). Server
// Component for data loading, mirrors the sibling "Board columns" page
// (settings/columns/page.tsx) exactly: the field list is server-fetched
// and passed down as typed props, the only Client Component is
// components/project/custom-fields-manager.tsx.
//
// Access: reaching this page at all already requires
// `is_project_visible_to` to hold (this page's own `projects` select goes
// through the request-scoped, RLS-respecting client) — a caller who
// cannot see a private project gets the same not-found response as a
// nonexistent project, same convention as every sibling settings page.
export default async function ProjectCustomFieldsSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  const supabase = await createClient();

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

  const [
    { data: ownWorkspaceMembership },
    { data: ownProjectMembership },
    { data: fieldsData, error: fieldsError },
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
    supabase
      .from("project_custom_fields")
      .select("id, name, field_type, position")
      .eq("project_id", project.id)
      .order("position", { ascending: true }),
  ]);

  const workspaceRole = (ownWorkspaceMembership?.role ?? "guest") as WorkspaceRole;
  const projectRole = (ownProjectMembership?.project_role ?? null) as ProjectRole;

  const canManage = canManageColumns({ role: workspaceRole, projectRole });

  const fields: ProjectCustomFieldRow[] = (fieldsData ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    fieldType: row.field_type as ProjectCustomFieldRow["fieldType"],
    position: row.position,
  }));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Custom fields</h1>
        <p className="text-sm text-muted-foreground">
          Extra fields tasks in {project.name} can carry, beyond status/priority/type/phase.
        </p>
      </div>

      <ProjectSettingsNav workspaceSlug={workspaceSlug} projectId={project.id} />

      <Separator />

      {fieldsError ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p>Something went wrong loading this project&apos;s custom fields. Please try again.</p>
          <a
            href={`/w/${workspaceSlug}/projects/${project.id}/settings/custom-fields`}
            className="underline"
          >
            Retry
          </a>
        </div>
      ) : fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This project has no custom fields yet.
          {canManage ? " Add one below to get started." : ""}
        </p>
      ) : null}

      {!fieldsError && (
        <CustomFieldsManager
          projectId={project.id}
          initialFields={fields}
          canManage={canManage}
        />
      )}
    </div>
  );
}
