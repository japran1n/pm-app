import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getPortalTaskDetail } from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";
import { PortalConversation } from "@/components/portal/conversation";

// C7: one shared task, with the conversation the client is part of.
export default async function PortalTaskPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; taskId: string }>;
}) {
  const { workspaceSlug, taskId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace || !user) notFound();

  const task = await getPortalTaskDetail(workspace.id, taskId, user.id);

  if (!task) notFound();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Link
          href={`/portal/${workspace.slug}/p/${task.projectId}`}
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {task.projectName}
        </Link>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {task.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            {task.status.replace(/_/g, " ")}
            {task.dueDate ? ` · due ${task.dueDate}` : ""}
          </p>
        </div>

        {task.description && (
          <p className="text-sm text-muted-foreground">{task.description}</p>
        )}
      </div>

      <PortalConversation
        taskId={task.id}
        comments={task.comments}
        teamName={workspace.name}
      />
    </div>
  );
}
