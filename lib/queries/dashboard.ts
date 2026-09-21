// F073 (AS-135, and the AS-127 database-aggregation contract those RPCs
// were built under): thin data-layer wrappers around the `get_priority_counts`
// (F071) and `get_status_counts` (F072) RPCs, called from the workspace
// home Server Component (app/(workspace)/w/[workspaceSlug]/page.tsx).
//
// Neither RPC had an app-level wrapper yet (both handoffs called this the
// dashboard UI's job — see missions/<id>/handoffs/F071-handoff.md and
// F072-handoff.md "Out-of-scope work needed"), so this is the first
// caller. Both functions normalize the RPC's sparse rows (a value with
// zero matching tasks gets no row at all, per both handoffs' "Notes for
// the next worker") into a dense array covering every fixed status/
// priority value (plus a "none" bucket for null priority), each defaulted
// to count 0, so chart components never have to special-case a missing
// category.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
} from "@/lib/task-colors";
import type { TaskCardTask } from "@/components/task/task-card";
import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";

export type PriorityCountDatum = {
  priority: NonNullable<TaskCardTask["priority"]> | "none";
  label: string;
  count: number;
  color: string;
};

// F223 (AS-412): a workspace's status chart slice is now keyed by the
// project column's real NAME (see the migration's AUTONOMOUS_DECISION
// comment for "group by name, not category" — 20260825010000_status_
// counts_custom_columns.sql), not one of a fixed four values, so `status`
// (a `TaskCardTask["status"]` union) is replaced with a plain `name`
// string. `color`/`category` come straight from the RPC's own
// `project_statuses` join rather than a client-side STATUS_COLORS
// lookup, so a renamed/recolored column is reflected without a redeploy.
export type StatusCountDatum = {
  name: string;
  label: string;
  count: number;
  color: string;
  category: string | null;
};

const PRIORITY_ORDER: PriorityCountDatum["priority"][] = [
  "urgent",
  "high",
  "medium",
  "low",
  "backlog",
  "none",
];

export async function getPriorityCounts(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<{ data: PriorityCountDatum[] | null; error: string | null }> {
  const { data, error } = await supabase.rpc("get_priority_counts", {
    p_workspace_id: workspaceId,
  });

  if (error) {
    return { data: null, error: error.message };
  }

  const countsByPriority = new Map<string, number>();
  for (const row of data ?? []) {
    // `priority` can be NULL for a task with no priority set (F071
    // handoff note) — bucket it under "none" rather than dropping it.
    const key = row.priority ?? "none";
    countsByPriority.set(key, Number(row.count));
  }

  const result: PriorityCountDatum[] = PRIORITY_ORDER.map((priority) => ({
    priority,
    label: PRIORITY_LABELS[priority],
    count: countsByPriority.get(priority) ?? 0,
    color: PRIORITY_COLORS[priority],
  }));

  return { data: result, error: null };
}

// F075 (AS-131): thin data-layer wrapper around the `get_overdue_count`
// RPC (supabase/migrations/20260818080000_rpc_overdue_count.sql), mirroring
// getPriorityCounts/getStatusCounts's shape — `{ data, error }`, RPC call,
// no client-side task-list fetch. Returns a single number rather than an
// array since the RPC returns one scalar count per workspace.
//
// F124 (AS-207): `timezone` is forwarded as the RPC's `p_timezone`
// argument (supabase/migrations/20260818210000_rpc_overdue_count_timezone.sql)
// so the SQL-side "is this task overdue" definition uses the SAME
// caller-supplied IANA timezone as lib/tasks/is-overdue.ts's client-side
// definition, instead of the database server's own clock — this is the
// "how does the user's timezone reach the RPC" decision the dashboard
// overdue tile needed (see this feature's handoff Decisions Made).
//
// F275: REQUIRED, no longer defaulted to "UTC" here — M10 scrutiny called
// out this exact silent default (alongside the React prop chain's own
// optional `timezone?: string` sites) as the "major" finding that a
// future caller forgetting to pass it renders every task as if the
// caller were in UTC with no type error. The RPC itself still defaults
// `p_timezone` to `'UTC'` at the SQL layer (unchanged) so a raw
// PostgREST/`supabase.rpc` call that bypasses this wrapper entirely still
// works — only this TypeScript wrapper's own silent default is removed.
// Every real caller (app/(workspace)/w/[workspaceSlug]/page.tsx) already
// passes the resolved timezone; tests that only verify workspace-scoping
// (tests/integration/dashboard-workspace-switch-refresh.test.ts) now pass
// "UTC" explicitly.
export async function getOverdueCount(
  supabase: SupabaseClient,
  workspaceId: string,
  timezone: string,
): Promise<{ data: number | null; error: string | null }> {
  const { data, error } = await supabase.rpc("get_overdue_count", {
    p_workspace_id: workspaceId,
    p_timezone: timezone,
  });

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: Number(data ?? 0), error: null };
}

// UX-20: the dashboard's KPI row used to be a single Overdue tile sitting
// in a 3-column grid with two empty slots. These three fill the row out
// to four small, meaningful counts (see the migration's own header
// comment for what each RPC actually counts).
export async function getDueSoonCount(
  supabase: SupabaseClient,
  workspaceId: string,
  timezone: string,
): Promise<{ data: number | null; error: string | null }> {
  const { data, error } = await supabase.rpc("get_due_soon_count", {
    p_workspace_id: workspaceId,
    p_timezone: timezone,
  });
  if (error) return { data: null, error: error.message };
  return { data: Number(data ?? 0), error: null };
}

export async function getBlockedCount(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<{ data: number | null; error: string | null }> {
  const { data, error } = await supabase.rpc("get_blocked_count", {
    p_workspace_id: workspaceId,
  });
  if (error) return { data: null, error: error.message };
  return { data: Number(data ?? 0), error: null };
}

export async function getCompletedCount(
  supabase: SupabaseClient,
  workspaceId: string,
  timezone: string,
): Promise<{ data: number | null; error: string | null }> {
  const { data, error } = await supabase.rpc("get_completed_count", {
    p_workspace_id: workspaceId,
    p_timezone: timezone,
  });
  if (error) return { data: null, error: error.message };
  return { data: Number(data ?? 0), error: null };
}

export async function getStatusCounts(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<{ data: StatusCountDatum[] | null; error: string | null }> {
  const { data, error } = await supabase.rpc("get_status_counts", {
    p_workspace_id: workspaceId,
  });

  if (error) {
    return { data: null, error: error.message };
  }

  // F223 (AS-412): the RPC now returns exactly one row per distinct
  // column NAME present in this workspace's tasks (custom/renamed
  // columns included), each already carrying its own colour/category —
  // no fixed dense array to backfill zero-count buckets into, since
  // "every possible status" is no longer a closed, known-in-advance set.
  // A workspace-appropriate `STATUS_LABELS` fallback (title-casing the
  // raw name) is used only for the pre-F218 default four, whose stored
  // names ("todo", "in_progress", ...) aren't already human-readable;
  // any custom column name is used verbatim as its own label.
  const result: StatusCountDatum[] = (data ?? []).map((row: {
    name: string;
    color: string | null;
    category: string | null;
    count: number;
  }) => {
    const name = row.name;
    const label =
      STATUS_LABELS[name as keyof typeof STATUS_LABELS] ?? name;
    const color =
      row.color ??
      STATUS_COLORS[name as keyof typeof STATUS_COLORS] ??
      "#94a3b8";
    return {
      name,
      label,
      count: Number(row.count),
      color,
      category: row.category ?? null,
    };
  });

  return { data: result, error: null };
}

// F002 (missions/20260921-184313, AS-073/074/075): the new Home dashboard's
// "Needs you"/"Team health" KPI tiles need two plain counts that no
// existing RPC provides. tech-decisions.md ("No database migrations —
// AS-005") is explicit that these are answered with a query-builder call
// against `tasks`/`projects`/`project_statuses` from this file, not a new
// RPC — unlike every other function above, which wraps an RPC. Both
// create their own request-scoped, RLS-respecting client internally
// (`createClient()` from lib/supabase/server) rather than taking one as a
// parameter, matching this mission's declared signatures
// (`getUnassignedCount(workspaceId)` / `getKpiDelta(workspaceId, kind,
// daysBack)` — no `supabase` argument) and the same "fails open to 0 on a
// query error" convention as lib/queries/chat.ts's
// getWorkspaceChatUnreadTotal.
//
// Both resolve "which project's tasks count" as a first step — active
// (non-archived) projects in this workspace — then fetch tasks scoped to
// those project ids and filter on `project_statuses.category` client-side
// (a plain `.select("id, project_statuses(category)")` join), the same
// "join project_statuses for category" shape getOverdueCount/
// getStatusCounts use, kept as two round trips rather than one
// PostgREST embedded-resource filter so the mocked-client unit tests below
// only need the same `.eq/.is/.in/.lt/.gte` chain shape already
// established by tests/unit/calendar-blocks-active-members.test.ts, not a
// harder-to-mock cross-table filter expression.
//
// `project_statuses.category` is one of `not_started` | `in_progress` |
// `done` (supabase/migrations/20260824010000_project_statuses.sql's check
// constraint) — there is no `cancelled` category in this schema today.
// The spec's "AND status category ≠ 'cancelled'" guard is kept anyway
// (harmless no-op against the current constraint, forward-compatible if a
// `cancelled` category is ever added) rather than silently dropped.
type TaskStatusCategoryRow = {
  id: string;
  project_statuses: { category: string | null } | { category: string | null }[] | null;
};

function taskStatusCategory(row: TaskStatusCategoryRow): string | null {
  const joined = row.project_statuses;
  if (joined === null) return null;
  return Array.isArray(joined) ? (joined[0]?.category ?? null) : joined.category;
}

function isDoneOrCancelledCategory(category: string | null): boolean {
  return category === "done" || category === "cancelled";
}

async function getActiveProjectIds(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<string[] | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  if (error) {
    logger.error("getActiveProjectIds: query failed", { error, workspaceId });
    return null;
  }

  return (data ?? []).map((row: { id: string }) => row.id);
}

// AS-073/074: "the dashboard shows a count of incomplete, unassigned
// tasks across the workspace's active projects."
export async function getUnassignedCount(workspaceId: string): Promise<number> {
  const supabase = await createClient();

  const projectIds = await getActiveProjectIds(supabase, workspaceId);
  if (projectIds === null) return 0;
  if (projectIds.length === 0) return 0;

  const { data, error } = await supabase
    .from("tasks")
    .select("id, project_statuses(category)")
    .in("project_id", projectIds)
    .is("assignee_id", null)
    .is("deleted_at", null);

  if (error) {
    logger.error("getUnassignedCount: query failed", { error, workspaceId });
    return 0;
  }

  const rows = (data ?? []) as TaskStatusCategoryRow[];
  return rows.filter((row) => !isDoneOrCancelledCategory(taskStatusCategory(row))).length;
}

// AS-075: "the dashboard KPI tiles show a delta count (overdue or
// completed) for a configurable lookback window."
export async function getKpiDelta(
  workspaceId: string,
  kind: "overdue" | "completed",
  daysBack: number,
): Promise<number> {
  const supabase = await createClient();

  const projectIds = await getActiveProjectIds(supabase, workspaceId);
  if (projectIds === null) return 0;
  if (projectIds.length === 0) return 0;

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - daysBack);

  if (kind === "overdue") {
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("tasks")
      .select("id, project_statuses(category)")
      .in("project_id", projectIds)
      .is("deleted_at", null)
      .lt("due_date", cutoffDate);

    if (error) {
      logger.error("getKpiDelta: overdue query failed", { error, workspaceId });
      return 0;
    }

    const rows = (data ?? []) as TaskStatusCategoryRow[];
    return rows.filter((row) => !isDoneOrCancelledCategory(taskStatusCategory(row))).length;
  }

  // 'completed': there is no `completed_at` column on `tasks` (same gap
  // 20260902050000_dashboard_kpi_rpcs.sql's get_completed_count documents
  // for its own RPC), so "entered a done-category status within
  // daysBack days" is approximated via `updated_at` on rows currently in
  // a done-category column — a task reopened and redone within the
  // window double-counts once, not per transition, the same accepted
  // approximation that RPC's own comment calls out.
  const cutoffIso = cutoff.toISOString();

  const { data, error } = await supabase
    .from("tasks")
    .select("id, updated_at, project_statuses(category)")
    .in("project_id", projectIds)
    .is("deleted_at", null)
    .gte("updated_at", cutoffIso);

  if (error) {
    logger.error("getKpiDelta: completed query failed", { error, workspaceId });
    return 0;
  }

  const rows = (data ?? []) as (TaskStatusCategoryRow & { updated_at: string })[];
  return rows.filter((row) => taskStatusCategory(row) === "done").length;
}
