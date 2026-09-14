import { logger } from "@/lib/observability/logger";
import { getRequestClient } from "@/lib/auth/current-user";
import type { PortalQueryResult, StatusCategory, StatusRow } from "./shared";

// --- Phases (F001, missions/20260903-portal) --------------------------

export type PortalPhaseState = "not_started" | "active" | "blocked" | "done";

export type PortalPhase = {
  id: string;
  name: string;
  clientDescription: string | null;
  state: PortalPhaseState;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  position: number;
  // AS-011: counts only client-visible tasks, regardless of which role
  // called this function — see the note above the task query below for
  // why that filter is applied explicitly here rather than left to RLS.
  totalClientVisibleTasks: number;
  doneClientVisibleTasks: number;
  // Null (never 0) when there is nothing shared in this phase yet — same
  // "don't claim 0% when the true answer is 'nothing to measure'"
  // reasoning as `PortalProject.percentComplete` above, except the UI's
  // clarified spec for phases is explicit: zero tasks renders as 0 and
  // says so, rather than omitting the figure, so this is 0 rather than
  // null.
  progressPercent: number;
  // docs/portal-timeline-review-and-demo-readiness.md 2.7: the title of
  // the client-visible task currently `in_progress` in this phase, so an
  // `active` row can say what is actually being worked on rather than
  // just "Active". Null when the phase has no in-progress client-visible
  // task (including every non-active phase). When several tasks are
  // in_progress at once, the one with the lowest `position` (the task
  // furthest left/top on the board) wins -- an arbitrary but stable and
  // deterministic pick, not invented data.
  inFlightTaskTitle: string | null;
  // F109 (docs/client-portal-visual-plan.md Part 4.1): the free-text
  // reason a `blocked` phase is blocked (project_phases.blocked_reason,
  // edited in components/project/phase-list.tsx). Null when nothing has
  // been recorded, or the phase isn't blocked -- components/portal/
  // phase-timeline.tsx never invents one for either case.
  blockedReason: string | null;
};

// Client-visible phases for one project, with a progress percentage. RLS
// (project_phases_select_client / project_phases_select_team,
// 20260909010000) already decides which PHASE rows a given caller gets
// back — client_visible + the project's portal_enabled for a client,
// every phase for the team. What RLS canNOT express is AS-011's
// business rule that the PROGRESS FIGURE itself counts only
// client-visible tasks even when the caller is a team member previewing
// these same numbers — so that filter is applied explicitly below, not
// left to RLS, matching this file's stated exception for business logic
// that happens to coincide with (rather than duplicate) an access-control
// boundary.
//
// F006f (missions/20260903-portal, AS-011): a failed `tasks` or
// `project_statuses` read used to be logged and then silently treated
// as "zero rows" — every task fell to the `"not_started"` category
// fallback, so every phase reported a correct-looking 0% instead of an
// unknown one. A fully delivered phase read as not started. This
// function now fails LOUDLY on either read: it returns `{ ok: false }`
// rather than computing a percentage from a map it knows is incomplete.
// A failed `project_phases` read fails the same way, for the same
// reason. An empty result (a project that genuinely has zero phases, or
// zero tasks in a phase) is not a failure and still returns `{ ok: true,
// data: [] }` / a phase with `progressPercent: 0` — the distinction this
// type exists to make is "we don't know" vs. "we know, and it's zero".
export async function getProjectPhases(
  projectId: string,
): Promise<PortalQueryResult<PortalPhase[]>> {
  const supabase = await getRequestClient();

  const { data: phases, error: phasesError } = await supabase
    .from("project_phases")
    .select(
      "id, name, client_description, state, planned_start, planned_end, actual_start, actual_end, position, blocked_reason",
    )
    .eq("project_id", projectId)
    // AS-012: a phase with client_visible = false is never part of this
    // function's output, whoever calls it — this is the function's own
    // contract ("client-visible phases"), applied explicitly rather than
    // left entirely to RLS so it holds even for a team caller previewing
    // the portal's numbers.
    .eq("client_visible", true)
    .order("position");

  if (phasesError) {
    logger.error("getProjectPhases: failed to load phases", { error: phasesError });
    return { ok: false, error: phasesError.message };
  }
  if (!phases?.length) return { ok: true, data: [] };

  const phaseIds = phases.map((p) => p.id);

  const [{ data: tasks, error: tasksError }, { data: statuses, error: statusesError }] =
    await Promise.all([
      supabase
        .from("tasks")
        .select("id, phase_id, status_id, status, title, position")
        .in("phase_id", phaseIds)
        // AS-011/AS-012: only a client-visible task counts toward a
        // phase's progress figure, whoever is asking.
        .eq("client_visible", true)
        .is("deleted_at", null),
      supabase
        .from("project_statuses")
        .select("id, project_id, name, category")
        .eq("project_id", projectId),
    ]);

  // AS-011: either read failing means the category map below would be
  // incomplete or wrong — computing a progress figure from it would be
  // exactly the defect this feature exists to remove, so both are fatal
  // to this call, not just logged and carried on from.
  if (tasksError) {
    logger.error("getProjectPhases: failed to load tasks", { error: tasksError });
    return { ok: false, error: tasksError.message };
  }
  if (statusesError) {
    logger.error("getProjectPhases: failed to load statuses", { error: statusesError });
    return { ok: false, error: statusesError.message };
  }

  const categoryByStatusId = new Map<string, StatusCategory>();
  const categoryByName = new Map<string, StatusCategory>();
  for (const status of (statuses ?? []) as StatusRow[]) {
    categoryByStatusId.set(status.id, status.category);
    categoryByName.set(status.name, status.category);
  }

  const totalsByPhase = new Map<string, { total: number; done: number }>();
  // docs/portal-timeline-review-and-demo-readiness.md 2.7: the
  // lowest-`position` in-progress task per phase, so the "Now:" line has
  // one deterministic answer rather than an arbitrary array-order pick.
  const inFlightByPhase = new Map<string, { title: string; position: number }>();
  for (const task of tasks ?? []) {
    if (!task.phase_id) continue;
    const category =
      (task.status_id ? categoryByStatusId.get(task.status_id) : undefined) ??
      categoryByName.get(task.status) ??
      "not_started";
    const entry = totalsByPhase.get(task.phase_id) ?? { total: 0, done: 0 };
    entry.total += 1;
    if (category === "done") entry.done += 1;
    totalsByPhase.set(task.phase_id, entry);

    if (category === "in_progress" && task.title) {
      const current = inFlightByPhase.get(task.phase_id);
      if (!current || task.position < current.position) {
        inFlightByPhase.set(task.phase_id, { title: task.title, position: task.position });
      }
    }
  }

  const data = phases.map((phase) => {
    const totals = totalsByPhase.get(phase.id) ?? { total: 0, done: 0 };
    return {
      id: phase.id,
      name: phase.name,
      clientDescription: phase.client_description,
      state: phase.state as PortalPhaseState,
      plannedStart: phase.planned_start,
      plannedEnd: phase.planned_end,
      actualStart: phase.actual_start,
      actualEnd: phase.actual_end,
      position: phase.position,
      totalClientVisibleTasks: totals.total,
      doneClientVisibleTasks: totals.done,
      // Never divide by zero: zero shared tasks in a phase is 0%, stated
      // as such by the UI, not a fraction that would throw or render NaN.
      progressPercent: totals.total === 0 ? 0 : Math.round((totals.done / totals.total) * 100),
      inFlightTaskTitle: inFlightByPhase.get(phase.id)?.title ?? null,
      blockedReason: phase.blocked_reason,
    };
  });

  return { ok: true, data };
}
