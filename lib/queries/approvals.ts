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
  decidedBy: string | null;
  round: number;
};

const APPROVAL_COLUMNS =
  "id, project_id, title, description, decision_type, subject_type, subject_id, artifact_url, state, requested_at, due_at, decided_at, decision_note, decided_by, round";

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
  decided_by: string | null;
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
    decidedBy: row.decided_by,
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

// AS-026: the decision history table (approved / changes_requested /
// withdrawn), most recently decided first, WITH who decided -- a bare
// `decided_by` uuid answers "I never approved that" no better than a
// blank cell, so this resolves the display name the same way
// `getOpenApprovalsForWorkspace` resolves `requestedByName` above.
export type ApprovalHistoryEntry = PortalApproval & {
  decidedByName: string | null;
};

export async function getApprovalHistory(
  projectId: string,
): Promise<ApprovalHistoryEntry[]> {
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
  if (!data?.length) return [];

  const deciderIds = [
    ...new Set(data.map((row) => row.decided_by).filter((id): id is string => !!id)),
  ];
  const people = deciderIds.length ? await resolvePeople(deciderIds) : new Map();

  return data.map((row) => ({
    ...mapApprovalRow(row),
    decidedByName: row.decided_by ? (people.get(row.decided_by)?.name ?? null) : null,
  }));
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

// F010: "who must decide" column — batched across every distinct
// (projectId, decisionType) pair present on the queue page in ONE query
// (never one per row), keyed `${projectId}:${decisionType}` for an O(1)
// lookup per row. Reads the same `project_decision_owners` table
// `getDecisionOwners` reads (RLS-scoped identically), just shaped for a
// multi-project caller instead of one project's settings grid.
export async function getDecisionOwnerNames(
  pairs: { projectId: string; decisionType: ApprovalDecisionType }[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (pairs.length === 0) return result;

  const projectIds = [...new Set(pairs.map((p) => p.projectId))];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_decision_owners")
    .select("project_id, decision_type, user_id")
    .in("project_id", projectIds);

  if (error) {
    logger.error("getDecisionOwnerNames: failed to load decision owners", { error });
    return result;
  }
  if (!data?.length) return result;

  const userIds = [...new Set(data.map((row) => row.user_id))];
  const people = await resolvePeople(userIds);

  for (const row of data) {
    result.set(`${row.project_id}:${row.decision_type}`, people.get(row.user_id)?.name ?? null);
  }
  return result;
}

export type WorkspaceApproval = PortalApproval & {
  projectName: string;
  requestedByName: string | null;
  // F010: "what it blocks" — derived, never PM-typed. Populated only for
  // subject_type = 'task' (name + the phase it currently sits in, when
  // it has one) and 'doc' (title only, docs have no phase). null for
  // 'artifact' (nothing in-app to name) and for a 'task'/'doc' whose
  // subject row itself has since been deleted (defensive: the FK is not
  // enforced at the DB level for this column, see F007's own migration).
  blocks: { label: string; phaseName: string | null } | null;
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
    // AS-027: ordered by how long each request has been waiting, oldest
    // first — the queue's own defining shape, not project or due date.
    .order("requested_at", { ascending: true });

  if (error) {
    logger.error("getOpenApprovalsForWorkspace: failed to load approval requests", { error });
    return [];
  }
  if (!data?.length) return [];

  const requesterIds = [...new Set(data.map((row) => row.requested_by))];
  const people = await resolvePeople(requesterIds);

  // "What it blocks": resolve task titles+phases and doc titles in two
  // batched queries (never one query per row), scoped to the exact
  // subject ids present in this page's rows.
  const taskSubjectIds = [
    ...new Set(
      data
        .filter((row) => row.subject_type === "task" && row.subject_id)
        .map((row) => row.subject_id as string),
    ),
  ];
  const docSubjectIds = [
    ...new Set(
      data
        .filter((row) => row.subject_type === "doc" && row.subject_id)
        .map((row) => row.subject_id as string),
    ),
  ];

  const taskById = new Map<string, { title: string; phaseId: string | null }>();
  if (taskSubjectIds.length) {
    const { data: taskRows, error: taskError } = await supabase
      .from("tasks")
      .select("id, title, phase_id")
      .in("id", taskSubjectIds);
    if (taskError) {
      logger.error("getOpenApprovalsForWorkspace: failed to load subject tasks", { error: taskError });
    } else {
      for (const row of taskRows ?? []) {
        taskById.set(row.id, { title: row.title, phaseId: row.phase_id });
      }
    }
  }

  const phaseIds = [
    ...new Set(
      [...taskById.values()].map((t) => t.phaseId).filter((id): id is string => !!id),
    ),
  ];
  const phaseNameById = new Map<string, string>();
  if (phaseIds.length) {
    const { data: phaseRows, error: phaseError } = await supabase
      .from("project_phases")
      .select("id, name")
      .in("id", phaseIds);
    if (phaseError) {
      logger.error("getOpenApprovalsForWorkspace: failed to load subject phases", { error: phaseError });
    } else {
      for (const row of phaseRows ?? []) {
        phaseNameById.set(row.id, row.name);
      }
    }
  }

  const docTitleById = new Map<string, string>();
  if (docSubjectIds.length) {
    const { data: docRows, error: docError } = await supabase
      .from("docs")
      .select("id, title")
      .in("id", docSubjectIds);
    if (docError) {
      logger.error("getOpenApprovalsForWorkspace: failed to load subject docs", { error: docError });
    } else {
      for (const row of docRows ?? []) {
        docTitleById.set(row.id, row.title);
      }
    }
  }

  return data.map((row) => {
    let blocks: WorkspaceApproval["blocks"] = null;
    if (row.subject_type === "task" && row.subject_id) {
      const task = taskById.get(row.subject_id);
      if (task) {
        blocks = {
          label: task.title,
          phaseName: task.phaseId ? (phaseNameById.get(task.phaseId) ?? null) : null,
        };
      }
    } else if (row.subject_type === "doc" && row.subject_id) {
      const title = docTitleById.get(row.subject_id);
      if (title) {
        blocks = { label: title, phaseName: null };
      }
    }

    return {
      ...mapApprovalRow(row),
      projectName: projectNames.get(row.project_id) ?? "",
      requestedByName: people.get(row.requested_by)?.name ?? null,
      blocks,
    };
  });
}

// --- Client member picker for F008's "Who approves what" settings UI --
//
// "a client member of the project" (spec's own words) resolves, per this
// migration's own is_project_client() shape, to any ACTIVE workspace
// member with role = 'client' — clients are workspace-scoped, not
// project_members-scoped (is_project_client only joins projects ->
// workspace_members, confirmed by 20260908010000_pin_pg_temp_on_client
// _visibility_predicates.sql). Reads through the ordinary RLS-respecting
// client: workspace_members_select_fellow_members (20260902020000) already
// lets a non-client caller see every row, client rows included.
export type ProjectClientMember = {
  userId: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};

export async function getProjectClientMembers(
  workspaceId: string,
): Promise<ProjectClientMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .eq("role", "client");

  if (error) {
    logger.error("getProjectClientMembers: failed to load client members", { error });
    return [];
  }
  if (!data?.length) return [];

  const userIds = [...new Set(data.map((row) => row.user_id))];
  const people = await resolvePeople(userIds);

  return userIds.map((userId) => ({
    userId,
    name: people.get(userId)?.name ?? null,
    email: people.get(userId)?.email ?? null,
    avatarUrl: people.get(userId)?.avatarUrl ?? null,
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
