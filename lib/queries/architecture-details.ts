// Mission 20260918-architecture-enrichment, F08: lazy-loaded details for the
// architecture board (discipline estimates + copy brief metadata). This module
// is team-only and is NEVER imported by any portal file. The isolation is a
// stronger guarantee than a runtime check -- there is nothing to misconfigure.
//
// Three-layer protection against commercial data leaking to portal clients:
//   1. task_discipline_estimates has no client SELECT RLS policy.
//   2. This module is not imported by lib/queries/portal.ts, client-board.tsx,
//      or any file under app/(portal)/**.
//   3. ClientArchitectureBoard type does not carry estimate or meta fields.
//
// Called lazily only when the "Details" toggle is enabled -- the default board
// view issues the same 2 queries as before this mission (getArchitectureBoard).
// No N+1: two parallel queries, both filtered by project_id, merged in memory.

import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import type { PortalQueryResult } from "@/lib/queries/portal";
import type { ArchitectureNodeDetails, DisciplineEstimate, NodeMeta } from "@/lib/architecture/types";

export type { ArchitectureNodeDetails };

export async function getArchitectureNodeDetails(
  projectId: string,
): Promise<PortalQueryResult<ArchitectureNodeDetails>> {
  const supabase = await createClient();

  const [estimatesResult, metaResult] = await Promise.all([
    supabase
      .from("task_discipline_estimates")
      .select("task_id, discipline, minutes, note, estimated_by")
      .eq("project_id", projectId)
      // F073 (AS-080/081): cleared disciplines are now upserted with
      // minutes: null instead of being deleted (single atomic upsert covers
      // both "set" and "clear"). Null-minutes rows are the "cleared" state
      // and must never surface as a real (zero-length) estimate to readers.
      .not("minutes", "is", null),
    supabase
      .from("architecture_node_meta")
      .select("task_id, intent, audience, primary_cta, tone, keywords, copy_status, client_visible, updated_by")
      .eq("project_id", projectId),
  ]);

  if (estimatesResult.error) {
    logger.error("getArchitectureNodeDetails: failed to load estimates", {
      error: estimatesResult.error,
    });
    return { ok: false, error: estimatesResult.error.message };
  }

  if (metaResult.error) {
    logger.error("getArchitectureNodeDetails: failed to load meta", {
      error: metaResult.error,
    });
    return { ok: false, error: metaResult.error.message };
  }

  const estimatesByTask = new Map<string, DisciplineEstimate[]>();
  for (const row of estimatesResult.data ?? []) {
    const existing = estimatesByTask.get(row.task_id) ?? [];
    existing.push({
      discipline: row.discipline as DisciplineEstimate["discipline"],
      minutes: row.minutes,
      note: row.note ?? null,
      estimatedBy: row.estimated_by ?? null,
    });
    estimatesByTask.set(row.task_id, existing);
  }

  const metaByTask = new Map<string, NodeMeta>();
  for (const row of metaResult.data ?? []) {
    metaByTask.set(row.task_id, {
      intent: row.intent ?? null,
      audience: row.audience ?? null,
      primaryCta: row.primary_cta ?? null,
      tone: row.tone ?? null,
      keywords: (row.keywords as string[]) ?? [],
      copyStatus: row.copy_status as NodeMeta["copyStatus"],
      clientVisible: row.client_visible ?? false,
      updatedBy: row.updated_by ?? null,
    });
  }

  const details: ArchitectureNodeDetails = new Map();
  const allTaskIds = new Set([...estimatesByTask.keys(), ...metaByTask.keys()]);
  for (const taskId of allTaskIds) {
    details.set(taskId, {
      estimates: estimatesByTask.get(taskId) ?? [],
      meta: metaByTask.get(taskId) ?? null,
    });
  }

  return { ok: true, data: details };
}
