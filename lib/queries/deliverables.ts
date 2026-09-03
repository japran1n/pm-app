// Read-side for F012's `client_deliverables` (missions/20260903-portal,
// M3 — Your list, scope, decisions). Same posture as `lib/queries/portal.ts`
// itself (see that file's header comment): this uses the ordinary
// RLS-respecting server client, never the admin client, so the query is
// written as if nothing were hidden and the database does the hiding —
// `client_deliverables_select_client` (20260926010000) already restricts a
// client caller to portal-enabled projects they are a member of.

import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import type { PortalQueryResult } from "@/lib/queries/portal";

export type DeliverableKind = "copy" | "image" | "access" | "decision" | "data" | "other";
export type DeliverableState = "not_started" | "in_progress" | "delivered" | "accepted" | "waived";

export type ClientDeliverable = {
  id: string;
  projectId: string;
  phaseId: string | null;
  taskId: string | null;
  title: string;
  description: string | null;
  kind: DeliverableKind;
  ownerName: string;
  dueAt: string | null;
  blocking: boolean;
  state: DeliverableState;
  deliveredAt: string | null;
  acceptedAt: string | null;
  acceptedBy: string | null;
  reviewNote: string | null;
  position: number;
};

const DELIVERABLE_COLUMNS =
  "id, project_id, phase_id, task_id, title, description, kind, owner_name, due_at, blocking, state, delivered_at, accepted_at, accepted_by, review_note, position";

function mapDeliverable(row: {
  id: string;
  project_id: string;
  phase_id: string | null;
  task_id: string | null;
  title: string;
  description: string | null;
  kind: string;
  owner_name: string;
  due_at: string | null;
  blocking: boolean;
  state: string;
  delivered_at: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  review_note: string | null;
  position: number;
}): ClientDeliverable {
  return {
    id: row.id,
    projectId: row.project_id,
    phaseId: row.phase_id,
    taskId: row.task_id,
    title: row.title,
    description: row.description,
    kind: row.kind as DeliverableKind,
    ownerName: row.owner_name,
    dueAt: row.due_at,
    blocking: row.blocking,
    state: row.state as DeliverableState,
    deliveredAt: row.delivered_at,
    acceptedAt: row.accepted_at,
    acceptedBy: row.accepted_by,
    reviewNote: row.review_note,
    position: row.position,
  };
}

// AS-028: every deliverable on this project, in display order. RLS decides
// which rows a given caller gets back (a client only ever sees deliverables
// of a portal-enabled project they belong to; there is no per-row
// `client_visible` on this table — see the migration's header comment for
// why).
export async function getClientDeliverables(
  projectId: string,
): Promise<PortalQueryResult<ClientDeliverable[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("client_deliverables")
    .select(DELIVERABLE_COLUMNS)
    .eq("project_id", projectId)
    .order("position");

  if (error) {
    logger.error("getClientDeliverables: failed to load deliverables", { error });
    return { ok: false, error: error.message };
  }

  return { ok: true, data: (data ?? []).map(mapDeliverable) };
}

// The count `getPortalBadgeCounts` (lib/queries/portal.ts) folds into
// `deliverablesPastDue`: blocking deliverables that are overdue and not
// yet delivered/accepted/waived, on this one project. Shares the shape of
// `client_deliverables_project_id_blocking_due_idx` (20260926010000) so
// the filter here matches the index exactly, not merely approximates it.
export async function getOverdueBlockingDeliverableCount(
  projectId: string,
): Promise<PortalQueryResult<number>> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { count, error } = await supabase
    .from("client_deliverables")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("blocking", true)
    .not("state", "in", "(accepted,waived)")
    .not("due_at", "is", null)
    .lt("due_at", today);

  if (error) {
    logger.error("getOverdueBlockingDeliverableCount: failed to load count", { error });
    return { ok: false, error: error.message };
  }

  return { ok: true, data: count ?? 0 };
}
