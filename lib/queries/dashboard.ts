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
