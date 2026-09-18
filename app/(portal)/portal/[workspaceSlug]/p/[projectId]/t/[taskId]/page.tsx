import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getPortalTaskDetail } from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";
import { PortalConversation } from "@/components/portal/conversation";
import { PortalApprovalActions } from "@/components/portal/approval-actions";
import { PortalTaskTitleAnnouncer } from "@/components/portal/portal-task-title-announcer";
import { StatusPill } from "@/components/portal/status-pill";
import {
  resolveClientBucket,
  CLIENT_BUCKET_LABELS,
} from "@/components/portal/status-label";
import { formatDayMonthUTC } from "@/lib/format";

// C7: one shared task, with the conversation the client is part of.
//
// F003b (missions/20260903-portal): relocated here, under the
// project-scoped shell, so it renders with the sidebar/topbar instead of
// no chrome at all. `p/[projectId]/layout.tsx` has already resolved and
// authorized `projectId` before this page runs; the task's own project
// (`task.projectId`, from `getPortalTaskDetail`) is what the "back to
// project" link below has always used, unchanged from before this move —
// it happens to already equal the URL's `projectId` for any link that
// reaches this page through the new shell, but this page does not assert
// that, since a stale bookmark should still resolve the real task rather
// than 404 on a mismatch. The old URL now redirects here, resolving the
// task's own project first (see the route left behind at the old
// location).
export default async function PortalTaskPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string; taskId: string }>;
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
      {/* F006e (missions/20260903-portal, AS-004): announces this task's
          title up to the shell's topbar, which otherwise has no way to
          know it -- see `portal-title-context.tsx`. Renders nothing. */}
      <PortalTaskTitleAnnouncer title={task.title} />

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
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
            <StatusPill
              name={task.status}
              category={task.category}
              clientBucket={task.clientBucket}
              labelOverride={
                CLIENT_BUCKET_LABELS[
                  resolveClientBucket(
                    task.category,
                    task.clientBucket,
                    task.pendingClientApproval,
                  )
                ]
              }
            />
            {task.dueDate ? (
              <span>
                · due{" "}
                <span className="font-mono">
                  {formatDayMonthUTC(task.dueDate)}
                </span>
              </span>
            ) : (
              ""
            )}
          </p>
        </div>

        {task.description && (
          <p className="text-sm text-muted-foreground">{task.description}</p>
        )}
      </div>

      {task.pendingClientApproval && (
        <PortalApprovalActions taskId={task.id} />
      )}

      <PortalConversation
        taskId={task.id}
        comments={task.comments}
        teamName={workspace.name}
      />
    </div>
  );
}
