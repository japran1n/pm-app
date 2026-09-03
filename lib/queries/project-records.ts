// Read-side for F012's `project_scope_items`, `project_decisions`, and
// `project_assumptions` (missions/20260903-portal, M3 — Your list, scope,
// decisions). One file because the Scope view (F015) always reads all
// three together, per the feature spec's own "Read side" section.
//
// Same posture as `lib/queries/portal.ts` and `lib/queries/deliverables.ts`:
// the RLS-respecting server client, never the admin client. RLS
// (20260926010000) already restricts a client caller to portal-enabled
// projects they belong to, and — for decisions/assumptions only —
// `client_visible = true` rows (AS-044, AS-045).

import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import type { PortalQueryResult } from "@/lib/queries/portal";

export type ScopeItemSource = "proposal" | "change_request";

export type ProjectScopeItem = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  included: boolean;
  source: ScopeItemSource;
  changeRequestId: string | null;
  position: number;
};

export type DecisionType = "content" | "brand" | "technical" | "commercial";

export type ProjectDecision = {
  id: string;
  projectId: string;
  phaseId: string | null;
  title: string;
  rationale: string | null;
  decisionType: DecisionType;
  decidedOn: string;
  decidedByName: string | null;
  clientVisible: boolean;
  createdBy: string;
};

export type AssumptionState = "assumed" | "confirmed" | "invalidated";

export type ProjectAssumption = {
  id: string;
  projectId: string;
  text: string;
  state: AssumptionState;
  confirmedOn: string | null;
  confirmedByName: string | null;
  clientVisible: boolean;
  flaggedByClientAt: string | null;
  flaggedNote: string | null;
};

// AS-043: every scope item on this project — included and excluded —
// each carrying its source. No `client_visible` column on this table
// (see the migration's header comment): every scope item is, by
// definition, a client-facing artefact.
export async function getProjectScopeItems(
  projectId: string,
): Promise<PortalQueryResult<ProjectScopeItem[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_scope_items")
    .select("id, project_id, title, description, included, source, change_request_id, position")
    .eq("project_id", projectId)
    .order("position");

  if (error) {
    logger.error("getProjectScopeItems: failed to load scope items", { error });
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      included: row.included,
      source: row.source as ScopeItemSource,
      changeRequestId: row.change_request_id,
      position: row.position,
    })),
  };
}

// AS-044/AS-045: every decision this caller may see. For a client, RLS
// already excludes `client_visible = false` rows entirely (they are never
// even fetched, not merely filtered client-side) — see
// `project_decisions_select_client` (20260926010000).
export async function getProjectDecisions(
  projectId: string,
): Promise<PortalQueryResult<ProjectDecision[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_decisions")
    .select(
      "id, project_id, phase_id, title, rationale, decision_type, decided_on, decided_by_name, client_visible, created_by",
    )
    .eq("project_id", projectId)
    .order("decided_on", { ascending: false });

  if (error) {
    logger.error("getProjectDecisions: failed to load decisions", { error });
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      phaseId: row.phase_id,
      title: row.title,
      rationale: row.rationale,
      decisionType: row.decision_type as DecisionType,
      decidedOn: row.decided_on,
      decidedByName: row.decided_by_name,
      clientVisible: row.client_visible,
      createdBy: row.created_by,
    })),
  };
}

// AS-046: every assumption this caller may see, with its confirmation
// state. Same client_visible RLS gate as decisions.
export async function getProjectAssumptions(
  projectId: string,
): Promise<PortalQueryResult<ProjectAssumption[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_assumptions")
    .select(
      "id, project_id, text, state, confirmed_on, confirmed_by_name, client_visible, flagged_by_client_at, flagged_note",
    )
    .eq("project_id", projectId)
    .order("created_at");

  if (error) {
    logger.error("getProjectAssumptions: failed to load assumptions", { error });
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      text: row.text,
      state: row.state as AssumptionState,
      confirmedOn: row.confirmed_on,
      confirmedByName: row.confirmed_by_name,
      clientVisible: row.client_visible,
      flaggedByClientAt: row.flagged_by_client_at,
      flaggedNote: row.flagged_note,
    })),
  };
}
