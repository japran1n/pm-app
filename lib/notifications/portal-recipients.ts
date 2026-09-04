// F084 (missions/20260903-portal): recipients for a portal-originated
// notification -- a client action (task-page approve/request-changes,
// filing a client request, delivering a file) that the team currently has
// no way to discover except by remembering to open a queue.
//
// None of `lib/actions/portal-approval.ts`, `lib/actions/client-requests.ts`
// or `lib/actions/portal-deliverables.ts` fits F207's `FanoutEvent` shape
// (lib/notifications/fanout.ts) -- that module's four event types are all
// keyed on a task's own watchers/assignees/mentions, and a client filing a
// request has no task at all yet. This is a separate, narrower recipient
// rule instead of a fifth FanoutEvent variant: every current decision
// owner on the project (`project_decision_owners`, any `decision_type` --
// the same "owns at least one decision type" reading
// `is_project_decision_owner(..., null, ...)` (20260925010000_f009b)
// already established as this schema's closest analogue of "the team's
// point of contact" for a project with no task-specific context) plus the
// subject task's own assignee, when there is one and the event has a
// task.
//
// Deduplicated, and never includes `excludeUserId` -- the client whose own
// action triggered the event, who must never notify themselves even if
// they somehow also hold a decision-owner row.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export async function getPortalEventRecipients(
  admin: SupabaseClient<Database>,
  params: { projectId: string; taskId?: string | null; excludeUserId: string },
): Promise<string[]> {
  const ids = new Set<string>();

  const { data: owners } = await admin
    .from("project_decision_owners")
    .select("user_id")
    .eq("project_id", params.projectId);

  for (const row of owners ?? []) {
    if (row.user_id && row.user_id !== params.excludeUserId) {
      ids.add(row.user_id);
    }
  }

  if (params.taskId) {
    const { data: task } = await admin
      .from("tasks")
      .select("assignee_id")
      .eq("id", params.taskId)
      .maybeSingle();

    if (task?.assignee_id && task.assignee_id !== params.excludeUserId) {
      ids.add(task.assignee_id);
    }
  }

  return Array.from(ids);
}
