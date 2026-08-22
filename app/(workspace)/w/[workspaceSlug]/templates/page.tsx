import { redirect } from "next/navigation";
import { LayoutTemplate } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceTaskTemplates } from "@/lib/queries/templates";
import { TemplateList } from "@/components/templates/template-list";

// F183 (AS-328/AS-330 UI half): `/w/[workspaceSlug]/templates` — every
// `kind='task'` template saved in this workspace, with name, creator,
// created date, a payload preview, and rename/delete controls.
//
// Access: same "reachable by any active, non-guest member" gate F142's
// archive page and F141's audit page both use — a guest hitting this URL
// directly is redirected before the templates query runs, mirroring that
// exact convention rather than inventing a new one (F181's RLS on
// `task_templates` independently enforces the same non-guest scoping at
// the database layer; this is the page-level "redirect away, not just
// hide UI" half).
//
// Server Component: data loads here and is passed down as typed props;
// TemplateList (Client Component) only owns the rename/delete
// interaction, per this feature's clarified implementation pattern.
export default async function TemplatesPage({
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

  if (role === "guest") {
    redirect(`/w/${workspaceSlug}`);
  }

  const templates = await getWorkspaceTaskTemplates(workspace.id);

  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Templates</h1>
        <p className="text-sm text-muted-foreground">
          Task templates saved from {workspace.name}. Save any task as a
          template from its detail view, then create new tasks from it
          anywhere you create tasks.
        </p>
      </div>

      {/* AS-330 UI/empty state: same structural pattern this codebase's
          other per-view empty states already use (icon in a muted circle,
          heading, one-line explanation — see
          components/board/board-empty-state.tsx and the archive page's
          own empty state, F142). No primary action here: a template can
          only be created from an existing task's "Save as template"
          control (task-detail-sheet.tsx), not from this page. */}
      {templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-16 text-center">
          <div
            aria-hidden="true"
            className="flex size-12 items-center justify-center rounded-full bg-muted"
          >
            <LayoutTemplate className="size-6 text-muted-foreground" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">No templates yet</p>
            <p className="text-sm text-muted-foreground">
              Save a task as a template from its detail view to reuse its
              title, description, checklist, and other fields the next time
              you create a similar task.
            </p>
          </div>
        </div>
      ) : (
        <TemplateList
          templates={templates}
          currentUserId={user.id}
          currentUserRole={role}
        />
      )}
    </div>
  );
}
