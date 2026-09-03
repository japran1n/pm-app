import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePeople } from "@/lib/queries/people";

// Data-fetching for F007's `approval_requests` / `project_decision_owners`
// (missions/20260903-portal, M2 — Approvals).
//
// Same convention as lib/queries/portal.ts's top-of-file comment: every
// query here uses the ordinary RLS-respecting server client unless a
// comment explains why a given read needs the admin client (resolving a
// DISPLAY value for a row the caller already reached through their own
// RLS-scoped read — never widening which rows are visible). RLS
// (`approval_requests_select_client` / `approval_requests_select_team`,
// this feature's own migration) is the actual access-control boundary;
// nothing here re-implements it.

export type ApprovalDecisionType = "content" | "brand" | "technical" | "commercial";
export type ApprovalSubjectType = "task" | "doc" | "phase" | "artifact";
export type ApprovalState = "pending" | "approved" | "changes_requested" | "withdrawn";

export type PortalApproval = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  decisionType: ApprovalDecisionType;
  subjectType: ApprovalSubjectType;
  subjectId: string | null;
  artifactUrl: string | null;
  state: ApprovalState;
  requestedAt: string;
  dueAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  round: number;
};

const APPROVAL_COLUMNS =
  "id, project_id, title, description, decision_type, subject_type, subject_id, artifact_url, state, requested_at, due_at, decided_at, decision_note, round";

function mapApprovalRow(row: {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  decision_type: string;
  subject_type: string;
  subject_id: string | null;
  artifact_url: string | null;
  state: string;
  requested_at: string;
  due_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
  round: number;
}): PortalApproval {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    decisionType: row.decision_type as ApprovalDecisionType,
    subjectType: row.subject_type as ApprovalSubjectType,
    subjectId: row.subject_id,
    artifactUrl: row.artifact_url,
    state: row.state as ApprovalState,
    requestedAt: row.requested_at,
    dueAt: row.due_at,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    round: row.round,
  };
}

// AS-021/AS-023: the open cards a client sees for one project. RLS
// (`approval_requests_select_client`) already scopes this to a
// portal-enabled project the caller is a client of, and — for a
// task-subject request — one whose subject task is itself
// client_visible, so nothing is re-filtered here.
export async function getOpenApprovalsForClient(
  projectId: string,
): Promise<PortalApproval[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("approval_requests")
    .select(APPROVAL_COLUMNS)
    .eq("project_id", projectId)
    .eq("state", "pending")
    .order("requested_at", { ascending: true });

  if (error) {
    logger.error("getOpenApprovalsForClient: failed to load approval requests", { error });
    return [];
  }
  return (data ?? []).map(mapApprovalRow);
}

// The decision history table (approved / changes_requested / withdrawn),
// most recently decided first.
export async function getApprovalHistory(projectId: string): Promise<PortalApproval[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("approval_requests")
    .select(APPROVAL_COLUMNS)
    .eq("project_id", projectId)
    .neq("state", "pending")
    .order("decided_at", { ascending: false, nullsFirst: false });

  if (error) {
    logger.error("getApprovalHistory: failed to load approval history", { error });
    return [];
  }
  return (data ?? []).map(mapApprovalRow);
}

export type PortalDecisionOwner = {
  decisionType: ApprovalDecisionType;
  userId: string;
  name: string | null;
  avatarUrl: string | null;
};

// The "who approves what" grid. RLS (`project_decision_owners_select_*`)
// scopes the rows; resolvePeople resolves the display name/avatar for an
// id the caller already reached through that scoped read, matching every
// other person-resolution call in this codebase.
export async function getDecisionOwners(projectId: string): Promise<PortalDecisionOwner[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_decision_owners")
    .select("decision_type, user_id")
    .eq("project_id", projectId);

  if (error) {
    logger.error("getDecisionOwners: failed to load decision owners", { error });
    return [];
  }
  if (!data?.length) return [];

  const userIds = [...new Set(data.map((row) => row.user_id))];
  const people = await resolvePeople(userIds);

  return data.map((row) => ({
    decisionType: row.decision_type as ApprovalDecisionType,
    userId: row.user_id,
    name: people.get(row.user_id)?.name ?? null,
    avatarUrl: people.get(row.user_id)?.avatarUrl ?? null,
  }));
}

export type WorkspaceApproval = PortalApproval & {
  projectName: string;
  requestedByName: string | null;
};

// F010's cross-project team queue: every pending approval across every
// project of this workspace, oldest first (the queue is sorted by wait
// time). Reads through the ordinary RLS-respecting client —
// `approval_requests_select_team` already scopes this to projects
// visible to the caller's own (non-client) membership, so a team member
// only ever sees their own workspace's queue, never another workspace's.
export async function getOpenApprovalsForWorkspace(
  workspaceId: string,
): Promise<WorkspaceApproval[]> {
  const supabase = await createClient();

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  if (projectsError) {
    logger.error("getOpenApprovalsForWorkspace: failed to load projects", { error: projectsError });
    return [];
  }
  const projectIds = (projects ?? []).map((p) => p.id);
  if (projectIds.length === 0) return [];
  const projectNames = new Map((projects ?? []).map((p) => [p.id, p.name]));

  const { data, error } = await supabase
    .from("approval_requests")
    .select(`${APPROVAL_COLUMNS}, requested_by`)
    .in("project_id", projectIds)
    .eq("state", "pending")
    .order("requested_at", { ascending: true });

  if (error) {
    logger.error("getOpenApprovalsForWorkspace: failed to load approval requests", { error });
    return [];
  }
  if (!data?.length) return [];

  const requesterIds = [...new Set(data.map((row) => row.requested_by))];
  const people = await resolvePeople(requesterIds);

  return data.map((row) => ({
    ...mapApprovalRow(row),
    projectName: projectNames.get(row.project_id) ?? "",
    requestedByName: people.get(row.requested_by)?.name ?? null,
  }));
}

// --- Task-subject visibility check for F008's "raise an approval" -----
//
// AS-020: creating an approval request against a task that is not
// client-visible is rejected at creation time with an explicit error.
// Reads through the admin client because the caller here is a team
// member checking a fact about a task they already manage (via their
// own RLS-scoped access to the task elsewhere), not widening what a
// client can see.
export async function isTaskClientVisible(taskId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tasks")
    .select("client_visible")
    .eq("id", taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    logger.error("isTaskClientVisible: failed to load task", { error });
    return false;
  }
  return data?.client_visible === true;
}
