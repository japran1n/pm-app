// F002 (missions/20260903-portal): team-side read path for a project's
// phases (AS-008), plus a lightweight option list for the phase pickers
// wired into the task detail sheet / new-task dialog / bulk action bar
// (AS-013).
//
// Deliberately a NEW file, not an addition to lib/queries/portal.ts's
// existing `getProjectPhases` (F001): that function is scoped to the
// CLIENT-visible progress figure (AS-011/AS-012 — it filters
// `client_visible = true` on both the phase and its tasks, by design, per
// its own doc comment). A PM managing phases needs every phase in the
// project, visible or not, plus how many tasks currently sit in each one
// — a different contract, so a second, explicit function, matching this
// file's own "team query, not a client query" scope from the feature spec
// (Files (approximate): lib/queries/phases.ts).
//
// Request-scoped, RLS-respecting client (`createClient()`), same
// `project_phases_select_team` policy `getProjectColumns`
// (lib/queries/statuses.ts) already relies on for `project_statuses` —
// nothing new here.

import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/observability/logger";

export type ProjectPhaseState = "not_started" | "active" | "blocked" | "done";

export type TeamProjectPhase = {
  id: string;
  projectId: string;
  name: string;
  clientDescription: string | null;
  state: ProjectPhaseState;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  clientVisible: boolean;
  position: number;
  // Definition of done ("Deleting a phase that has tasks ... show how
  // many tasks will be unassigned"): counted once, here, in the same
  // round trip that loads the phase list, so the settings page's delete
  // confirmation never needs a second query.
  taskCount: number;
};

export async function getProjectPhasesForTeam(
  projectId: string,
): Promise<TeamProjectPhase[]> {
  const supabase = await createClient();

  const { data: phases, error: phasesError } = await supabase
    .from("project_phases")
    .select(
      "id, project_id, name, client_description, state, planned_start, planned_end, actual_start, actual_end, client_visible, position",
    )
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  if (phasesError) {
    logger.error("getProjectPhasesForTeam: failed to load phases", {
      error: phasesError,
    });
    return [];
  }
  if (!phases?.length) return [];

  const phaseIds = phases.map((phase) => phase.id);

  // One query for every task-count in the project's phases, never a
  // per-phase round trip — same "single query, reduce in JS" convention
  // getProjectPhases (lib/queries/portal.ts) already uses for its own
  // per-phase totals.
  const { data: tasks, error: tasksError } = await supabase
    .from("tasks")
    .select("phase_id")
    .in("phase_id", phaseIds)
    .is("deleted_at", null);

  if (tasksError) {
    logger.error("getProjectPhasesForTeam: failed to load task counts", {
      error: tasksError,
    });
  }

  const countByPhase = new Map<string, number>();
  for (const task of tasks ?? []) {
    if (!task.phase_id) continue;
    countByPhase.set(task.phase_id, (countByPhase.get(task.phase_id) ?? 0) + 1);
  }

  return phases.map((phase) => ({
    id: phase.id,
    projectId: phase.project_id,
    name: phase.name,
    clientDescription: phase.client_description,
    state: phase.state as ProjectPhaseState,
    plannedStart: phase.planned_start,
    plannedEnd: phase.planned_end,
    actualStart: phase.actual_start,
    actualEnd: phase.actual_end,
    clientVisible: phase.client_visible,
    position: phase.position,
    taskCount: countByPhase.get(phase.id) ?? 0,
  }));
}

// Lightweight option shape for the phase pickers (task detail sheet, new
// task dialog, bulk action bar) — id/name/state/position only, no task
// counts. A separate, narrower query (rather than reusing
// getProjectPhasesForTeam and discarding fields) so the Server Action that
// backs those Client Component pickers (lib/actions/phases.ts's
// `getProjectPhaseOptions`) does the smallest read that satisfies AS-013,
// matching this feature's "reuse before building, but don't over-fetch"
// convention.
export type ProjectPhaseOption = {
  id: string;
  name: string;
  state: ProjectPhaseState;
  position: number;
};

export async function getProjectPhaseOptionsForTeam(
  projectId: string,
): Promise<ProjectPhaseOption[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_phases")
    .select("id, name, state, position")
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  if (error) {
    logger.error("getProjectPhaseOptionsForTeam: failed to load phases", {
      error,
    });
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    state: row.state as ProjectPhaseState,
    position: row.position,
  }));
}
