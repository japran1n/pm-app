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

export type StatusCountDatum = {
  status: TaskCardTask["status"];
  label: string;
  count: number;
  color: string;
};

const PRIORITY_ORDER: PriorityCountDatum["priority"][] = [
  "urgent",
  "high",
  "medium",
  "low",
  "backlog",
  "none",
];

const STATUS_ORDER: StatusCountDatum["status"][] = [
  "todo",
  "in_progress",
  "in_review",
  "done",
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

  const countsByStatus = new Map<string, number>();
  for (const row of data ?? []) {
    countsByStatus.set(row.status, Number(row.count));
  }

  const result: StatusCountDatum[] = STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_LABELS[status],
    count: countsByStatus.get(status) ?? 0,
    color: STATUS_COLORS[status],
  }));

  return { data: result, error: null };
}
