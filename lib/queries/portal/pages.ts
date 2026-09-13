import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRequestClient } from "@/lib/auth/current-user";
import { resolvePeople } from "@/lib/queries/people";
import { resolveClientBucket, type ClientBucket } from "@/components/portal/status-label";
import type { StatusCategory } from "./shared";

// --- Pages (F005, missions/20260903-portal) --------------------------------
//
// The portal Pages view: every client-visible task of the workspace's
// "page" task type on this project, in the team's own manual order
// (AS-014).
//
// F005b (missions/20260903-portal): the "page" type is matched by the
// stable `task_types.system_key` column
// (20260912010000_task_type_system_key.sql), not by name. `task_types`
// (20260903040000_task_types.sql) is an entirely workspace-owned
// taxonomy, so F005's original implementation matched the type row by
// its human-editable NAME, case-insensitively — but that meant a
// workspace naming the type "Sida" or "Stranica" got a silently empty
// Pages view, and renaming the type later silently emptied a client's
// view. `create_workspace_with_owner`
// (20260817234323_workspace_create_rpc.sql, amended by
// 20260912010000) now seeds a `system_key = 'page'` row on every new
// workspace, and the migration backfills `system_key = 'page'` onto any
// existing row already named "page". A workspace with no keyed page
// type simply has an empty Pages view — an honest "nobody tagged one
// yet" rather than an accident of naming.
export type PortalPageStatus = {
  // F006g (missions/20260903-portal): `id`/`name` are `null` for a task
  // with no `status_id` at all (defensive -- `tasks.status` defaults
  // `'todo'` and a trigger keeps `status_id` in sync, but nothing in the
  // schema forbids the row being null). `StatusPill` renders that as a
  // neutral "No status" pill rather than a coloured pill with an empty
  // label -- category/clientBucket still carry a value (the
  // `not_started` fallback) but are not read when `name` is null.
  id: string | null;
  name: string | null;
  category: StatusCategory;
  clientBucket: ClientBucket;
  clientDescription: string | null;
};

export type PortalPageAssignee = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
  // The only "role" concept this schema has for a team member is their
  // WORKSPACE role (owner/admin/member/viewer/guest) — there is no
  // per-person job title (e.g. "Designer") anywhere in this schema
  // (grepped profiles' own migration, 20260818200946_create_profiles.sql,
  // for a title/role column and found none). Rendered muted beneath the
  // name, per this feature's spec's "avatar + name + role" cell.
  roleLabel: string | null;
};

export type PortalPage = {
  id: string;
  title: string;
  slug: string | null;
  order: number | null;
  status: PortalPageStatus;
  assignee: PortalPageAssignee | null;
  updatedAt: string;
};

const WORKSPACE_ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
  guest: "Guest",
  client: "Client",
};

export async function getPortalPages(projectId: string): Promise<PortalPage[]> {
  const supabase = await getRequestClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, workspace_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return [];

  // F005b (missions/20260903-portal): matched by the stable
  // `system_key` column (20260912010000_task_type_system_key.sql), not
  // by a case-insensitive match on the type's own name. F005's original
  // version meant a workspace that named its type "Sida" or "Stranica"
  // got a silently empty Pages view, and renaming the type later
  // silently emptied a client's view — the same string-matching failure
  // mode F004 was forbidden to use for statuses. A workspace with no
  // `system_key = 'page'` row simply has an empty Pages view (AS-014's
  // own "lists every client-visible task of type page" is vacuously
  // true), which is now an honest "nobody tagged a page type yet" rather
  // than an accident of naming.
  const { data: pageType } = await supabase
    .from("task_types")
    .select("id")
    .eq("workspace_id", project.workspace_id)
    .eq("system_key", "page")
    .maybeSingle();
  if (!pageType) return [];

  const { data: tasks, error } = await supabase
    .from("tasks")
    .select(
      "id, title, page_slug, page_order, updated_at, assignee_id, pending_client_approval, project_statuses(id, name, category, client_bucket, client_description)",
    )
    .eq("project_id", projectId)
    .eq("task_type_id", pageType.id)
    // AS-014's own contract ("every CLIENT-VISIBLE task of type page") is
    // a business-logic definition, not only an access-control boundary —
    // the same explicit, documented exception to this file's own "don't
    // duplicate RLS filtering" convention that getProjectPhases's
    // client_visible task filter above already makes, so this function's
    // output means the same thing regardless of who calls it.
    .eq("client_visible", true)
    .is("deleted_at", null)
    // AS-014: ordered by the team's own page_order, nulls last, then
    // title — never created_at.
    .order("page_order", { ascending: true, nullsFirst: false })
    .order("title", { ascending: true });

  if (error) {
    logger.error("getPortalPages: failed to load tasks", { error });
    return [];
  }
  if (!tasks?.length) return [];

  const assigneeIds = [
    ...new Set(
      tasks
        .map((task) => task.assignee_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  // One batched resolvePeople call (name/avatar) plus one batched
  // workspace_members role lookup — never a per-row query. Matches this
  // feature's own explicit "no N+1" instruction and the convention
  // lib/queries/templates.ts documents. The admin client is required for
  // the role lookup specifically: a client caller cannot read
  // workspace_members rows other than their own
  // (workspace_members_select_*, 20260902020000), but this is resolving a
  // DISPLAY value for an already-permitted row (the assignee id came from
  // a task this same client can already see), not widening which rows are
  // visible — the identical justification resolvePeople's own doc comment
  // gives for using the admin client to resolve `profiles`.
  const [people, roleRows] = await Promise.all([
    resolvePeople(assigneeIds),
    assigneeIds.length > 0
      ? createAdminClient()
          .from("workspace_members")
          .select("user_id, role")
          .eq("workspace_id", project.workspace_id)
          .in("user_id", assigneeIds)
      : Promise.resolve({ data: [] as { user_id: string; role: string }[] }),
  ]);

  const roleByUserId = new Map(
    (roleRows.data ?? []).map((row) => [row.user_id, row.role]),
  );

  return tasks.map((task) => {
    const statusRow = Array.isArray(task.project_statuses)
      ? task.project_statuses[0]
      : task.project_statuses;

    const category = (statusRow?.category ?? "not_started") as StatusCategory;
    // F006g (AS-015, AS-017): `pending_client_approval` folded in here so
    // this row's bucket agrees with the Overview's "Waiting on you" list
    // by construction -- both now resolve "is this row waiting on the
    // client" through the exact same function and the exact same two
    // signals, rather than the Overview reading only the flag and this
    // view reading only the status's own bucket.
    const clientBucket = resolveClientBucket(
      category,
      statusRow?.client_bucket ?? null,
      task.pending_client_approval === true,
    );

    const assignee = task.assignee_id
      ? {
          id: task.assignee_id,
          name: people.get(task.assignee_id)?.name ?? null,
          avatarUrl: people.get(task.assignee_id)?.avatarUrl ?? null,
          roleLabel:
            WORKSPACE_ROLE_LABELS[
              roleByUserId.get(task.assignee_id) ?? ""
            ] ?? null,
        }
      : null;

    return {
      id: task.id,
      title: task.title,
      slug: task.page_slug,
      order: task.page_order,
      status: {
        id: statusRow?.id ?? null,
        name: statusRow?.name ?? null,
        category,
        clientBucket,
        clientDescription: statusRow?.client_description ?? null,
      },
      assignee,
      updatedAt: task.updated_at,
    };
  });
}
