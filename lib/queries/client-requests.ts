import { logger } from "@/lib/observability/logger";

// C5 team side: the request inbox.
//
// Read through the caller's own session, so
// `client_requests_select_author_or_team` decides what comes back: every
// request on a project the caller can see, and nothing from a project they
// cannot. Clients never reach this query — the policy's team branch
// excludes them, and the page it feeds lives under /w/*, which the
// workspace layout redirects them out of.

import { createClient } from "@/lib/supabase/server";
import { resolvePeople } from "@/lib/queries/people";

export type TeamClientRequest = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  body: string | null;
  desiredBy: string | null;
  status: "submitted" | "in_review" | "accepted" | "declined";
  declineReason: string | null;
  convertedTaskId: string | null;
  createdAt: string;
  requesterId: string;
  requesterName: string | null;
  requesterEmail: string | null;
};

export async function getWorkspaceClientRequests(
  workspaceId: string,
): Promise<TeamClientRequest[]> {
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  const projectNames = new Map(
    (projects ?? []).map((p) => [p.id as string, p.name as string]),
  );
  if (projectNames.size === 0) return [];

  const { data, error } = await supabase
    .from("client_requests")
    .select(
      "id, project_id, title, body, desired_by, status, decline_reason, converted_task_id, created_at, created_by",
    )
    .in("project_id", [...projectNames.keys()])
    // Untriaged first, then newest — the inbox exists to answer "what is
    // waiting on us", so a decided request should never sit above one that
    // still needs a decision.
    .order("status")
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("getWorkspaceClientRequests failed", { error: error });
    return [];
  }

  const rows = data ?? [];

  // Requesters are clients, and a client's profile is not readable by
  // anyone but themselves after 20260902020000 — so resolve names through
  // the same admin-backed helper the members list already uses rather than
  // joining `profiles` here and silently rendering blanks.
  const people = await resolvePeople(rows.map((r) => r.created_by));

  const STATUS_ORDER: Record<TeamClientRequest["status"], number> = {
    submitted: 0,
    in_review: 1,
    declined: 2,
    accepted: 3,
  };

  return rows
    .map((row) => {
      const person = people.get(row.created_by);
      return {
        id: row.id,
        projectId: row.project_id,
        projectName: projectNames.get(row.project_id) ?? "",
        title: row.title,
        body: row.body,
        desiredBy: row.desired_by,
        status: row.status as TeamClientRequest["status"],
        declineReason: row.decline_reason,
        convertedTaskId: row.converted_task_id,
        createdAt: row.created_at,
        requesterId: row.created_by,
        requesterName: person?.name ?? null,
        requesterEmail: person?.email ?? null,
      };
    })
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        b.createdAt.localeCompare(a.createdAt),
    );
}
