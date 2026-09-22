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
  // F016: triage/quote fields.
  scopeVerdict: "in_scope" | "change_request" | "warranty" | null;
  severity: "blocker" | "major" | "minor" | null;
  quotedHours: number | null;
  quotedAmount: number | null;
  quoteCurrency: string | null;
  quoteNote: string | null;
  quoteValidUntil: string | null;
  clientDecision: "pending" | "approved" | "rejected";
  track: "design_change" | "dev_change" | "content_seo" | null;
  trackOverridden: boolean;
};

// F083: count of client requests still waiting on the team — "submitted"
// (not yet triaged) or "in_review" (triaged, awaiting a decision) — for
// the sidebar's "Client requests" badge. Mirrors
// `getOpenApprovalsForWorkspace`'s "count only the still-open state, fail
// open to 0 rather than break the layout" convention (lib/queries/approvals.ts).
//
// F054 (FU-M4-7, SB-054): mirrors getNotificationsForWorkspace's own typed
// `{ count, error }` return shape (lib/queries/notifications.ts) instead
// of collapsing a real `client_requests` count failure to a bare `0` —
// `error` is set only when that count query itself fails, so a caller
// (InboxBadgeFigure) can distinguish "genuinely zero open requests" from
// "we couldn't find out." The upstream `projects` lookup returning zero
// ids stays `{ count: 0 }` with no `error` — that is this function's
// legitimate "nothing to show" path, not a reconcile failure.
export async function getOpenClientRequestCountForWorkspace(
  workspaceId: string,
): Promise<{ count: number; error?: string }> {
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  const projectIds = (projects ?? []).map((p) => p.id as string);
  if (projectIds.length === 0) return { count: 0 };

  const { count, error } = await supabase
    .from("client_requests")
    .select("id", { count: "exact", head: true })
    .in("project_id", projectIds)
    .in("status", ["submitted", "in_review"]);

  if (error) {
    logger.error("getOpenClientRequestCountForWorkspace failed", { error });
    return { count: 0, error: "Couldn't load client request count." };
  }

  return { count: count ?? 0 };
}

// F050 (FU-M4-3): "list" plus an optional typed `error`, mirroring
// getNotificationsForWorkspace's own "typed error, caller decides how to
// surface it" convention (lib/queries/notifications.ts) — a real DB/network
// failure here used to collapse to an empty array indistinguishable from
// "no requests exist", which made the Inbox's "Requests"/"All" tabs render
// "Your inbox is empty" on a total backend failure. `error` is set only
// for the `client_requests` query itself; the upstream `projects` lookup
// failing produces zero project ids, which is already this function's
// legitimate "nothing to show" path (same convention as
// getOpenApprovalsForWorkspace).
export async function getWorkspaceClientRequests(
  workspaceId: string,
): Promise<{ list: TeamClientRequest[]; error?: string }> {
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  const projectNames = new Map(
    (projects ?? []).map((p) => [p.id as string, p.name as string]),
  );
  if (projectNames.size === 0) return { list: [] };

  const { data, error } = await supabase
    .from("client_requests")
    .select(
      "id, project_id, title, body, desired_by, status, decline_reason, converted_task_id, created_at, created_by, scope_verdict, severity, quoted_hours, quoted_amount, quote_currency, quote_note, quote_valid_until, client_decision, track, track_overridden",
    )
    .in("project_id", [...projectNames.keys()])
    // Untriaged first, then newest — the inbox exists to answer "what is
    // waiting on us", so a decided request should never sit above one that
    // still needs a decision.
    .order("status")
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("getWorkspaceClientRequests failed", { error: error });
    return { list: [], error: "Couldn't load client requests." };
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

  const list = rows
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
        scopeVerdict: row.scope_verdict as TeamClientRequest["scopeVerdict"],
        severity: row.severity as TeamClientRequest["severity"],
        quotedHours: row.quoted_hours,
        quotedAmount: row.quoted_amount,
        quoteCurrency: row.quote_currency,
        quoteNote: row.quote_note,
        quoteValidUntil: row.quote_valid_until,
        clientDecision: row.client_decision as TeamClientRequest["clientDecision"],
        track: row.track as TeamClientRequest["track"],
        trackOverridden: row.track_overridden,
      };
    })
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        b.createdAt.localeCompare(a.createdAt),
    );

  return { list };
}
