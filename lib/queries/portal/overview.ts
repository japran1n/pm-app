import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRequestClient } from "@/lib/auth/current-user";
import { resolveClientBucket } from "@/components/portal/status-label";
import { buildStatusBucketMaps } from "@/lib/portal/status-bucket";
import type { PortalQueryResult, StatusCategory, StatusRowWithBucket } from "./shared";

// UX-22: the portal landing page used to be only "here is a progress bar
// per project" — it never answered the two questions a client actually
// opens the portal for: "is anything waiting on me?" and "what shipped
// recently?". This reuses the same RLS-scoped tasks/statuses read
// getPortalProjects already does (so a client still only ever sees rows
// their `client_visible` grant already allows) and derives two small
// lists from it instead of adding a second, parallel query path.
export type PortalOverviewTask = {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  dueDate: string | null;
  updatedAt: string;
};

export type PortalOverview = {
  waitingOnYou: PortalOverviewTask[];
  deliveredThisWeek: PortalOverviewTask[];
};

// F006f (missions/20260903-portal, AS-002): the Overview page's own
// "Waiting on you" tile and the task list rendered directly beneath it
// used to be two independently-computed numbers -- the tile read this
// project's `approvalsAwaiting` (getPortalBadgeCounts), the list read
// `getPortalOverview(workspace.id)`, EVERY portal-enabled project in the
// workspace, filtered by a second, different predicate. A client on two
// projects could see a tile that said "2" sitting directly above a list
// with five rows from a different project entirely -- the same fact,
// answered twice, disagreeing. "One question must have one query,
// project-scoped, used by both" (this feature's own scope): this
// function is that one query. It reads `tasks.pending_client_approval`,
// not `approval_requests` directly -- the migration that introduced
// `approval_requests` documents `pending_client_approval` as "a
// denormalised indicator [the approval RPCs] keep in sync... the board
// and the portal overview both still read it"
// (supabase/migrations/20260916010000_approval_requests.sql:14-16) --
// so a task-shaped list is the correct read for a widget whose rows
// link to a task detail page, not a workaround. (`approval_requests`
// itself is polymorphic -- doc/phase/artifact subjects with no task to
// link to -- which is exactly why it stays the right source for the
// dedicated Approvals view, and the wrong source for this task list.)
export async function getPortalWaitingOnYou(
  projectId: string,
  projectName: string,
): Promise<PortalQueryResult<PortalOverviewTask[]>> {
  const supabase = await getRequestClient();

  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, due_date, updated_at, project_id")
    .eq("project_id", projectId)
    .eq("pending_client_approval", true)
    // Belt-and-suspenders, matching this file's own stated convention
    // (e.g. getProjectPhases's identical filter above): RLS already
    // scopes a client's own `tasks` read to client_visible rows, this
    // just keeps the business rule readable at the call site and holds
    // for a team caller previewing the same widget.
    .eq("client_visible", true)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (error) {
    logger.error("getPortalWaitingOnYou: failed to load tasks awaiting approval", { error });
    return { ok: false, error: error.message };
  }

  const items: PortalOverviewTask[] = (data ?? []).map((task) => ({
    id: task.id,
    title: task.title,
    projectId: task.project_id,
    projectName,
    dueDate: task.due_date,
    updatedAt: task.updated_at,
  }));

  return { ok: true, data: items };
}

export async function getPortalOverview(
  workspaceId: string,
): Promise<PortalOverview> {
  const supabase = await getRequestClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  if (!projects?.length) {
    return { waitingOnYou: [], deliveredThisWeek: [] };
  }

  const projectIds = projects.map((p) => p.id);
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));

  const [{ data: tasks }, { data: statuses }] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        "id, title, status, status_id, due_date, project_id, updated_at, pending_client_approval",
      )
      .in("project_id", projectIds)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false }),
    supabase
      .from("project_statuses")
      .select("id, project_id, name, category, client_bucket")
      .in("project_id", projectIds),
  ]);

  // F006g (missions/20260903-portal, AS-015, AS-017): client_bucket
  // carried alongside category so this list's "waiting" predicate can
  // route through the exact same `resolveClientBucket` the Pages
  // distribution uses -- never a second, independent definition of
  // "waiting" the two screens could disagree on.
  const { categoryByStatusId, clientBucketByStatusId } = buildStatusBucketMaps(
    (statuses ?? []) as StatusRowWithBucket[],
  );

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const waitingOnYou: PortalOverviewTask[] = [];
  const deliveredThisWeek: PortalOverviewTask[] = [];

  for (const task of tasks ?? []) {
    const category = (task.status_id
      ? categoryByStatusId.get(task.status_id)
      : undefined) ?? "not_started";
    const clientBucket = task.status_id
      ? (clientBucketByStatusId.get(task.status_id) ?? null)
      : null;

    // "Waiting on you" — F1 (docs/client-dashboard-features-plan.md):
    // this used to be inferred from a regex on the status name
    // (`/review/i`), which only worked for a team whose status happened
    // to be named exactly "In Review". F006g folded the remaining
    // per-status source (an explicit `client_bucket = 'waiting'`) in
    // too, through the same `resolveClientBucket` the Pages view uses --
    // `not_started`'s own category fallback never resolves to "waiting"
    // by itself (that was the defect this feature fixes: a Backlog page
    // nobody had touched read as "blocked on the client"), only an
    // explicit override or `pending_client_approval` puts a row here.
    const bucket = resolveClientBucket(
      category,
      clientBucket,
      task.pending_client_approval === true,
    );

    const mapped: PortalOverviewTask = {
      id: task.id,
      title: task.title,
      projectId: task.project_id,
      projectName: projectNames.get(task.project_id) ?? "",
      dueDate: task.due_date,
      updatedAt: task.updated_at,
    };

    if (bucket === "waiting") {
      waitingOnYou.push(mapped);
    } else if (category === "done" && new Date(task.updated_at) >= sevenDaysAgo) {
      deliveredThisWeek.push(mapped);
    }
  }

  return { waitingOnYou, deliveredThisWeek };
}

// --- Activity feed (F2, docs/client-dashboard-features-plan.md) -----------
//
// "What happened since you were last here" for a client who opens the
// portal infrequently. Deliberately NOT built on `audit_log`: that table's
// RLS (20260821211226) is owner/admin read-only by design, on the explicit
// reasoning that it is a sensitive internal history — extending it to the
// client role would be a real widening of a boundary stated elsewhere to
// be load-bearing, for a feature that doesn't need it. Everything this
// feed shows is derivable from `tasks` and `comments`, which are already
// the exact RLS-scoped reads this file's other queries use.

export type PortalActivitySummary = {
  /** Null the first time a client ever opens the portal — the UI shows no
   * "since" framing in that case, only the two lists below. */
  since: string | null;
  completed: PortalOverviewTask[];
  added: PortalOverviewTask[];
  commentCount: number;
};

export async function getPortalActivitySummary(
  workspaceId: string,
  userId: string,
): Promise<PortalActivitySummary> {
  // Bookkeeping only (the "when did this member last look" timestamp),
  // not task/comment data — reading and writing it via the admin client is
  // the deliberate exception to this file's own RLS-only convention (see
  // top-of-file comment), because workspace_members carries no RLS policy
  // for a client to update their own row, and the value written back here
  // is never influenced by anything the caller supplied.
  const admin = createAdminClient();
  const { data: memberRow } = await admin
    .from("workspace_members")
    .select("id, portal_last_seen_at")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("role", "client")
    .maybeSingle();

  const since = memberRow?.portal_last_seen_at ?? null;

  const supabase = await getRequestClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  const projectIds = (projects ?? []).map((p) => p.id);
  const projectNames = new Map((projects ?? []).map((p) => [p.id, p.name]));

  const completed: PortalOverviewTask[] = [];
  const added: PortalOverviewTask[] = [];
  let commentCount = 0;

  if (projectIds.length > 0) {
    const sinceFloor = since ?? "1970-01-01T00:00:00.000Z";

    const [{ data: tasks }, { data: statuses }, { data: sharedTasks }] =
      await Promise.all([
        supabase
          .from("tasks")
          .select(
            "id, title, status_id, due_date, project_id, created_at, updated_at",
          )
          .in("project_id", projectIds)
          .is("deleted_at", null)
          .gt("updated_at", sinceFloor),
        supabase
          .from("project_statuses")
          .select("id, project_id, category")
          .in("project_id", projectIds),
        // Comments live under client_visible tasks only — fetch that id
        // set first so the comment count query below doesn't have to
        // reason about visibility itself (RLS already restricts it, this
        // is only for the `internal` filter, same belt-and-suspenders
        // reasoning as elsewhere in this file).
        supabase
          .from("tasks")
          .select("id")
          .in("project_id", projectIds)
          .eq("client_visible", true)
          .is("deleted_at", null),
      ]);

    const sharedTaskIds = (sharedTasks ?? []).map((t) => t.id);

    const { count } = sharedTaskIds.length
      ? await supabase
          .from("comments")
          .select("id", { count: "exact", head: true })
          .in("task_id", sharedTaskIds)
          .eq("internal", false)
          .is("deleted_at", null)
          .gt("created_at", sinceFloor)
      : { count: 0 };

    commentCount = count ?? 0;

    const categoryByStatusId = new Map<string, StatusCategory>();
    for (const status of statuses ?? []) {
      categoryByStatusId.set(status.id, status.category as StatusCategory);
    }

    for (const task of tasks ?? []) {
      const category = task.status_id
        ? categoryByStatusId.get(task.status_id)
        : undefined;
      const mapped: PortalOverviewTask = {
        id: task.id,
        title: task.title,
        projectId: task.project_id,
        projectName: projectNames.get(task.project_id) ?? "",
        dueDate: task.due_date,
        updatedAt: task.updated_at,
      };

      if (category === "done") {
        completed.push(mapped);
      } else if (task.created_at > sinceFloor) {
        added.push(mapped);
      }
    }
  }

  // Written back last, after every read above already ran, so this visit
  // itself is reflected on the client's *next* visit, not this one.
  if (memberRow) {
    await admin
      .from("workspace_members")
      .update({ portal_last_seen_at: new Date().toISOString() })
      .eq("id", memberRow.id);
  }

  return { since, completed, added, commentCount };
}
