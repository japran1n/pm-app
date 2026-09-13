import { logger } from "@/lib/observability/logger";

// Data-fetching for the client portal (C3/C4, docs/client-portal-plan.md).
//
// Every query here uses the ordinary RLS-respecting server client, never
// the admin client. That is deliberate and load-bearing: the whole point of
// migrations 20260902010000/20260902020000 is that a client session already
// sees exactly — and only — their projects and the tasks marked
// `client_visible`. Re-implementing that filter in TypeScript here would
// create a second copy of the visibility rule that could drift from the
// policies, which is the failure this feature already hit once (see the
// duplicated `is_project_visible_to_row` predicate). So these queries are
// written as if nothing were hidden, and the database does the hiding.
//
// The one consequence worth stating: if a policy were ever dropped, this
// code would happily render internal data. That is the correct trade — a
// missing policy is a bug that must be loud, not one quietly compensated
// for in a query builder.

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, getRequestClient } from "@/lib/auth/current-user";
import {
  getDeliverablesPastDueCount,
  getWorstOverdueBlockingDeliverableRisk,
} from "@/lib/queries/deliverables";
import { resolvePeople } from "@/lib/queries/people";
import { resolveClientBucket, type ClientBucket } from "@/components/portal/status-label";
import { computeWeeklyDeliverySeries, type WeeklyDeliveryWeek } from "@/lib/portal/weekly-delivery";
import {
  PROJECT_ROLE_LABELS,
  PROJECT_ROLE_ORDER,
  type ProjectRoleValue,
} from "@/lib/queries/project-roles";

export type StatusCategory = "not_started" | "in_progress" | "done";

// F001 (missions/20260903-portal, `projects.launch_confidence` check
// constraint) — the three values a PM can set; `null` means "not set
// yet", rendered as an honest placeholder by the portal shell (F003)
// rather than a fake default.
export type PortalLaunchConfidence = "on_track" | "at_risk" | "slipped";

// Paket B (client-portal redesign, `projects.billing_model` /
// 20261105010000_project_billing_model.sql): governs whether the
// PORTAL's Hours nav item and `/hours` route are shown to this client at
// all. Internal (non-portal) time tracking never reads this field --
// the team keeps logging hours on every project regardless of how it's
// billed; this only gates what the client sees.
export type PortalBillingModel = "hourly" | "fixed_price";

export type PortalTask = {
  id: string;
  title: string;
  status: string;
  statusId: string | null;
  dueDate: string | null;
  // The category of the board column this task sits in. Carried on the task
  // itself (not just aggregated into the counts below) because the UI needs
  // it per row: a finished task with a past due date is not late, and
  // rendering it in the overdue style would tell the client something false
  // about work that was actually delivered.
  category: StatusCategory;
  // F006g (missions/20260903-portal, AS-015): the status's own
  // `client_bucket` override (raw, unresolved -- same shape as
  // `project_statuses.client_bucket`), carried alongside `category` so
  // `clientStatusLabel` can resolve this task's group heading through
  // `resolveClientBucket` instead of matching the status's name.
  clientBucket: string | null;
};

export type PortalProject = {
  id: string;
  name: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  // F003 (missions/20260903-portal, AS-005): the portal topbar's launch
  // chips. `null` on any of these three is a real, common state (a PM
  // hasn't set them yet) -- rendered as "-" by the shell, never a fake
  // date or a default confidence.
  targetLaunchDate: string | null;
  launchConfidence: PortalLaunchConfidence | null;
  launchNote: string | null;
  // Paket B: 'fixed_price' (the DB default) hides Hours in the portal;
  // 'hourly' shows it. Never null -- the column itself is `not null
  // default 'fixed_price'`.
  billingModel: PortalBillingModel;
  tasks: PortalTask[];
  // Counts by the *category* of the task's board column, not by the column
  // name: a team can rename or add columns freely (F218 project_statuses),
  // and the portal must keep reporting sensible progress when they do.
  notStarted: number;
  inProgress: number;
  done: number;
  total: number;
  // Percentage complete, rounded. `null` when there is nothing shared yet —
  // rendering "0%" for a project with no shared tasks would read as "no
  // work has been done", which is a different and wrong claim.
  percentComplete: number | null;
  nextDue: PortalTask | null;
  overdueCount: number;
  // The project's board columns (status name + category + client_bucket),
  // independent of which columns currently hold a shared task. Carried
  // down so the client list can resolve the category AND client bucket
  // for a status it receives over Realtime (e.g. a task moved into a Done
  // column that had zero shared tasks at render time) without a second
  // round trip -- `tasks.status`/`status_id` never carry `category` or
  // `client_bucket` themselves; only `project_statuses` does.
  statuses: { id: string; name: string; category: StatusCategory; clientBucket: string | null }[];
};

type StatusRow = {
  id: string;
  project_id: string;
  name: string;
  category: StatusCategory;
};

// F006g (missions/20260903-portal, AS-015, AS-017): a few callers also
// need the status's own `client_bucket` override (`getPortalProjects` to
// resolve `PortalTaskList`'s group headings without name-matching;
// `getPortalOverview` to agree with the Pages distribution's bucket by
// construction) -- `getProjectPhases` does not, so `StatusRow` itself
// stays minimal rather than every caller carrying a column it never
// reads.
type StatusRowWithBucket = StatusRow & { client_bucket: string | null };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getPortalProjects(
  workspaceId: string,
): Promise<PortalProject[]> {
  const supabase = await getRequestClient();

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select(
      "id, name, description, start_date, end_date, target_launch_date, launch_confidence, launch_note, billing_model",
    )
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    // F001 (missions/20260903-portal, AS-007): a project's portal is off
    // by default. RLS still lets a client read the `projects` row itself
    // (portal_enabled has no bearing on ordinary project visibility), so
    // this filter is the actual gate for the portal's own project list —
    // the same "the database hides rows, this file filters what's left
    // over from a business-logic requirement, not a security boundary"
    // reasoning as `getProjectPhases`'s client_visible task filter below.
    .eq("portal_enabled", true)
    .order("name");

  if (projectsError) {
    logger.error("getPortalProjects: failed to load projects", { error: projectsError });
    return [];
  }
  if (!projects?.length) return [];

  const projectIds = projects.map((p) => p.id);

  const [{ data: tasks, error: tasksError }, { data: statuses, error: statusesError }] =
    await Promise.all([
      supabase
        .from("tasks")
        .select("id, title, status, status_id, due_date, project_id")
        .in("project_id", projectIds)
        .is("deleted_at", null)
        .order("position"),
      supabase
        .from("project_statuses")
        .select("id, project_id, name, category, client_bucket")
        .in("project_id", projectIds),
    ]);

  if (tasksError) {
    logger.error("getPortalProjects: failed to load tasks", { error: tasksError });
  }
  if (statusesError) {
    logger.error("getPortalProjects: failed to load statuses", { error: statusesError });
  }

  const categoryByStatusId = new Map<string, StatusCategory>();
  const categoryByProjectAndName = new Map<string, StatusCategory>();
  // F006g (missions/20260903-portal, AS-015): carried the same way as
  // category, so `PortalTaskList`'s group headings can resolve a bucket
  // (via `resolveClientBucket`) instead of matching the status's name.
  const clientBucketByStatusId = new Map<string, string | null>();
  const clientBucketByProjectAndName = new Map<string, string | null>();
  for (const status of (statuses ?? []) as StatusRowWithBucket[]) {
    categoryByStatusId.set(status.id, status.category);
    categoryByProjectAndName.set(`${status.project_id}:${status.name}`, status.category);
    clientBucketByStatusId.set(status.id, status.client_bucket ?? null);
    clientBucketByProjectAndName.set(`${status.project_id}:${status.name}`, status.client_bucket ?? null);
  }

  const today = todayIso();

  return projects.map((project) => {
    const projectTasks = (tasks ?? []).filter((t) => t.project_id === project.id);

    let notStarted = 0;
    let inProgress = 0;
    let done = 0;
    let overdueCount = 0;
    let nextDue: PortalTask | null = null;

    const mapped: PortalTask[] = projectTasks.map((task) => {
      // `status_id` is kept in sync with `status` by a DB trigger, but fall
      // back to matching on the column name so a row written before that
      // trigger existed still lands in the right bucket rather than
      // silently counting as "not started".
      const category =
        (task.status_id ? categoryByStatusId.get(task.status_id) : undefined) ??
        categoryByProjectAndName.get(`${project.id}:${task.status}`) ??
        "not_started";
      const clientBucket =
        (task.status_id ? clientBucketByStatusId.get(task.status_id) : undefined) ??
        clientBucketByProjectAndName.get(`${project.id}:${task.status}`) ??
        null;

      if (category === "done") done += 1;
      else if (category === "in_progress") inProgress += 1;
      else notStarted += 1;

      const mappedTask: PortalTask = {
        id: task.id,
        title: task.title,
        status: task.status,
        statusId: task.status_id,
        dueDate: task.due_date,
        category,
        clientBucket,
      };

      if (category !== "done" && task.due_date) {
        if (task.due_date < today) overdueCount += 1;
        if (!nextDue || (nextDue.dueDate ?? "") > task.due_date) {
          nextDue = mappedTask;
        }
      }

      return mappedTask;
    });

    const total = mapped.length;

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      startDate: project.start_date,
      endDate: project.end_date,
      targetLaunchDate: project.target_launch_date,
      launchConfidence: project.launch_confidence as PortalLaunchConfidence | null,
      launchNote: project.launch_note,
      billingModel: (project.billing_model as PortalBillingModel | null) ?? "fixed_price",
      tasks: mapped,
      notStarted,
      inProgress,
      done,
      total,
      percentComplete: total === 0 ? null : Math.round((done / total) * 100),
      nextDue,
      overdueCount,
      statuses: ((statuses ?? []) as StatusRowWithBucket[])
        .filter((s) => s.project_id === project.id)
        .map((s) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          clientBucket: s.client_bucket ?? null,
        })),
    };
  });
}

// F006f (missions/20260903-portal, AS-002, AS-011): the shared shape for
// every portal read that can genuinely fail against a live database —
// `{ ok: false }` is a DIFFERENT value from "the true answer is zero/
// empty", which a coalesced fallback (`count ?? 0`, an empty map a
// percentage gets computed from) could never express. A caller that
// pattern-matches on `.ok` cannot accidentally render a dropped
// connection as data; the type system will not let it reach `.data`
// without checking. Same `{ ok: true/false }` discriminant this codebase
// already uses for Server Action results (e.g. `ColumnActionResult`,
// lib/actions/statuses.ts:188-201) — reused here for query reads, not
// invented fresh.
export type PortalQueryResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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

// The caller's role in this workspace, used by the portal layout to decide
// whether this person belongs here at all. Reads through RLS: after
// 20260902020000 a client can see only their own `workspace_members` row,
// which is precisely the row this needs.
export async function getWorkspaceRoleForCurrentUser(
  workspaceId: string,
  userId: string,
): Promise<string | null> {
  const supabase = await getRequestClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    logger.error("getWorkspaceRoleForCurrentUser failed", { error: error });
    return null;
  }
  return data?.role ?? null;
}

// The signed-in client's own display name/avatar, for the portal
// sidebar's footer identity row (F003, missions/20260903-portal). Reads
// through the ordinary RLS-respecting client (`profiles_select_self_or_
// shared_workspace`, 20260902020000) allows `id = auth.uid()`
// unconditionally, so a client can always read their own row even though
// they cannot read the team's.
export async function getPortalCurrentUserProfile(
  userId: string,
): Promise<{ displayName: string | null; avatarUrl: string | null } | null> {
  const supabase = await getRequestClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name, avatar_url")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    logger.error("getPortalCurrentUserProfile failed", { error });
    return null;
  }
  if (!data) return null;
  return { displayName: data.display_name, avatarUrl: data.avatar_url };
}

// F003 (missions/20260903-portal, AS-002, AS-003): the sidebar's two
// badge counts -- approvals awaiting this client's decision, and the
// client's own deliverables past their due date. F003 shipped this as a
// zero-returning stub ("so F007/F012 only ever need to change THIS
// function's body, never any of its callers") -- F007 is that first
// body change.
//
// AS-002 (approvalsAwaiting): F007's dedicated `approval_requests` table
// now exists. This counts `state = 'pending'` rows through the ordinary
// RLS-respecting client, exactly like every other query in this file --
// `approval_requests_select_client` (this feature's migration) already
// scopes the result to a portal-enabled project the caller is a client
// of, folding in the task-subject `client_visible` check where it
// applies, so no filter is repeated here. This is the same table
// `getOpenApprovalsForClient` (lib/queries/approvals.ts) reads, so the
// sidebar badge and the approvals list it links to can never disagree
// the way the M1 scrutiny report's AS-002 finding described.
//
// F006f (missions/20260903-portal, AS-002): a failed count used to be
// logged and then coalesced to `count ?? 0` -- a dropped connection told
// the client "nothing is waiting on you", the exact wrong-confident-
// number defect this feature exists to remove. `approvalsAwaiting` is
// now a `PortalQueryResult<number>`: the caller (the sidebar nav item)
// renders no badge at all on a failed read, never a `0` it cannot tell
// apart from a real zero.
//
// AS-003 (deliverablesPastDue): `project can hold a list of items the
// client owes` (AS-028) is a wholly new entity F012 introduces in M3 --
// there is no existing table or column anywhere in this schema that
// means "a thing the client owes," so there is nothing to count yet.
// Zero is the honest, vacuously-true answer (a project with zero
// deliverables has zero overdue ones), the same reasoning F001's and
// F005's own handoffs already used for a not-yet-built entity, not a
// placeholder standing in for a real number. It never reads a fallible
// source, so it stays a plain `number`, not a `PortalQueryResult`.
export type PortalBadgeCounts = {
  approvalsAwaiting: PortalQueryResult<number>;
  deliverablesPastDue: number;
};

// F009 (missions/20260903-portal, AS-002, third-scrutiny finding): this
// used to count every `state = 'pending'` row on the project, full stop --
// with no `project_decision_owners` filter, a client who owns only
// `brand` decisions saw a badge that also counted `commercial` requests
// they would get a `42501` on from `decide_approval_atomic` the moment
// they tried to act on one. AS-002's own text is "awaiting THIS CLIENT's
// decision" -- so this now first resolves which decision types the
// calling client actually owns on this project (their own
// `project_decision_owners` rows), and only counts pending requests of
// those types. A client who owns no decision type on this project sees
// 0, honestly (there is nothing they can decide), not the full pending
// count.
export async function getPortalBadgeCounts(projectId: string): Promise<PortalBadgeCounts> {
  const { supabase, user } = await getCurrentUser();

  if (!user) {
    // No session -- the layout that calls this already redirects an
    // unauthenticated caller before this ever runs (see that layout's
    // own defensive re-check), so this is unreachable in practice. An
    // honest failure, never a fabricated zero, if it ever is reached.
    return {
      approvalsAwaiting: { ok: false, error: "Not signed in." },
      deliverablesPastDue: 0,
    };
  }

  // F012/F016e (missions/20260903-portal, M3): the real past-due
  // deliverables count -- no `blocking` qualifier, matching AS-003's own
  // wording and the Your list view's "blocked" bucket count (see
  // `getDeliverablesPastDueCount`'s doc comment). A failed read degrades
  // to 0 here (unlike
  // `approvalsAwaiting` above) because this badge count's own type is a
  // plain `number`, not a `PortalQueryResult` -- the spec for this field
  // is "no placeholder that pretends to be data" for the number itself,
  // not for its failure mode, and a badge silently showing 0 on a
  // logged, transient read failure is the same posture the rest of this
  // file takes for degrade-gracefully counts (see `overdueCount` below).
  const overdueResult = await getDeliverablesPastDueCount(projectId);
  const deliverablesPastDue = overdueResult.ok ? overdueResult.data : 0;
  if (!overdueResult.ok) {
    logger.error("getPortalBadgeCounts: failed to load overdue deliverables count", {
      error: overdueResult.error,
    });
  }

  const { data: ownerRows, error: ownerError } = await supabase
    .from("project_decision_owners")
    .select("decision_type")
    .eq("project_id", projectId)
    .eq("user_id", user.id);

  if (ownerError) {
    logger.error("getPortalBadgeCounts: failed to load decision owners", { error: ownerError });
    return {
      approvalsAwaiting: { ok: false, error: ownerError.message },
      deliverablesPastDue,
    };
  }

  const decisionTypes = [...new Set((ownerRows ?? []).map((row) => row.decision_type))];

  // Owns nothing on this project -- there is nothing pending this client
  // could ever decide, so the honest count is 0 without a second round
  // trip.
  if (decisionTypes.length === 0) {
    return { approvalsAwaiting: { ok: true, data: 0 }, deliverablesPastDue };
  }

  const { count, error } = await supabase
    .from("approval_requests")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("state", "pending")
    .in("decision_type", decisionTypes);

  if (error) {
    logger.error("getPortalBadgeCounts: failed to load approvals count", { error });
    return {
      approvalsAwaiting: { ok: false, error: error.message },
      deliverablesPastDue,
    };
  }

  return {
    // A successful head-count query never actually returns a null
    // count (it returns 0 for no rows) -- this `?? 0` guards the SDK's
    // nullable type, not a failure; it is only ever reached once `error`
    // above is known false.
    approvalsAwaiting: { ok: true, data: count ?? 0 },
    deliverablesPastDue,
  };
}

// F085 (missions/20260903-portal audit, defect 2): the Overview tile's
// honest "what's waiting on you" count. Before this fix, the Overview
// tile read only `getPortalWaitingOnYou` (task-shaped,
// `pending_client_approval` rows) while the sidebar's Approvals badge
// (`getPortalBadgeCounts` above) read `approval_requests` directly for
// the client's owned decision types — a doc- or phase-subject approval
// exists in the badge and not in the tile, and past-due deliverables
// were in neither. This is the one function that unions all three, so
// the tile and the badge can never disagree about whether there is
// SOMETHING waiting on the client, only (by design, per each surface's
// own scope) about which view is the right place to act on it.
//
// Dedup: a task-subject approval request keeps `tasks.pending_client_approval`
// true for exactly as long as it is open (20260916010000's own header) —
// so a task-subject open approval and its `pending_client_approval` task
// row are the SAME obligation counted twice unless collapsed onto one
// key (`task:<id>`). A non-task-subject (doc/phase/artifact) approval has
// no task row to collide with, so it gets its own key (`approval:<id>`).
// Past-due deliverables live in a separate table with no task/approval
// row of their own, so that count is added on top, never deduped against
// the other two.
export async function getPortalWaitingOnYouCount(
  projectId: string,
): Promise<PortalQueryResult<number>> {
  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "Not signed in." };
  }

  const overdueResult = await getDeliverablesPastDueCount(projectId);
  if (!overdueResult.ok) {
    logger.error("getPortalWaitingOnYouCount: failed to load overdue deliverables count", {
      error: overdueResult.error,
    });
    return { ok: false, error: overdueResult.error };
  }

  const { data: taskRows, error: taskError } = await supabase
    .from("tasks")
    .select("id")
    .eq("project_id", projectId)
    .eq("pending_client_approval", true)
    .eq("client_visible", true)
    .is("deleted_at", null)
    // Same terminal shape as `getPortalWaitingOnYou`'s identical filter
    // set above -- ordering has no bearing on a count, this just keeps
    // one query shape for "pending-approval tasks" rather than a second,
    // subtly different one.
    .order("updated_at", { ascending: false });

  if (taskError) {
    logger.error("getPortalWaitingOnYouCount: failed to load pending-approval tasks", {
      error: taskError,
    });
    return { ok: false, error: taskError.message };
  }

  const { data: ownerRows, error: ownerError } = await supabase
    .from("project_decision_owners")
    .select("decision_type")
    .eq("project_id", projectId)
    .eq("user_id", user.id);

  if (ownerError) {
    logger.error("getPortalWaitingOnYouCount: failed to load decision owners", {
      error: ownerError,
    });
    return { ok: false, error: ownerError.message };
  }

  const decisionTypes = [...new Set((ownerRows ?? []).map((row) => row.decision_type))];

  const keys = new Set<string>();
  for (const task of taskRows ?? []) {
    keys.add(`task:${task.id}`);
  }

  if (decisionTypes.length > 0) {
    const { data: approvalRows, error: approvalError } = await supabase
      .from("approval_requests")
      .select("id, subject_type, subject_id")
      .eq("project_id", projectId)
      .eq("state", "pending")
      .in("decision_type", decisionTypes);

    if (approvalError) {
      logger.error("getPortalWaitingOnYouCount: failed to load approvals", {
        error: approvalError,
      });
      return { ok: false, error: approvalError.message };
    }

    for (const approval of approvalRows ?? []) {
      keys.add(
        approval.subject_type === "task" && approval.subject_id
          ? `task:${approval.subject_id}`
          : `approval:${approval.id}`,
      );
    }
  }

  // F-Package-C: accounts the client owns but has not provisioned yet are
  // their own obligation, distinct from tasks/approvals/deliverables --
  // same "waiting on you" bucket, counted here so the tile and the
  // `buildWaitingOnYouItems` list (which applies the identical
  // `owner === "client" && status === "pending"` predicate) can never
  // disagree.
  const { data: accountRows, error: accountError } = await supabase
    .from("project_accounts")
    .select("id")
    .eq("project_id", projectId)
    .eq("owner", "client")
    .eq("status", "pending")
    .eq("client_visible", true);

  if (accountError) {
    logger.error("getPortalWaitingOnYouCount: failed to load pending client accounts", {
      error: accountError,
    });
    return { ok: false, error: accountError.message };
  }

  return { ok: true, data: keys.size + overdueResult.data + (accountRows ?? []).length };
}

// F006f (missions/20260903-portal, AS-002): the Overview page's own
// "Waiting on you" tile and the task list rendered directly beneath it
// used to be two independently-computed numbers -- the tile read this
// project's `approvalsAwaiting` (above), the list read
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

// --- Risk banner (F006, missions/20260903-portal, AS-031) -----------------

export type PortalRisk = {
  id: string;
  message: string;
  // F085 (missions/20260903-portal audit, defect 5): carried straight
  // through from `DeliverableRisk` (lib/queries/deliverables.ts) -- the
  // banner names the item and its due date, and links the row to Your
  // list (where the client actually acts on it), rather than a bare
  // sentence with nothing to click.
  itemName: string;
  dueAt: string;
};

// F014 (missions/20260903-portal, AS-031): "a blocking deliverable past
// due" is the one risk source this function surfaces today. "An approval
// open longer than the project's threshold" (F007/F009, M2) is still not
// built -- this function's own return type stays a plain array precisely
// so a second risk source can be appended here later without changing
// `RiskBanner`'s (components/portal/risk-banner.tsx) props shape at all,
// the same extension-point pattern `getPortalBadgeCounts` above already
// uses. Zero or one entries today: `getWorstOverdueBlockingDeliverableRisk`
// (lib/queries/deliverables.ts) only ever names the SINGLE worst overdue
// blocking deliverable, per this feature's own spec ("naming the worst
// one and what it moves") -- never a whole list of every overdue item,
// which would read as noise rather than the one place the portal is
// allowed to be uncomfortable. `null` renders nothing at all (no empty
// banner shell), matching this file's own "must not render a
// placeholder" instruction, unchanged from before this feature.
export async function getPortalRisks(projectId: string): Promise<PortalRisk[]> {
  const risk = await getWorstOverdueBlockingDeliverableRisk(projectId);
  return risk
    ? [{ id: risk.id, message: risk.message, itemName: risk.itemName, dueAt: risk.dueAt }]
    : [];
}

// --- Live now (F006, missions/20260903-portal; P3, docs/client-portal-
// sixstar-plan.md) ----------------------------------------------------
//
// "Who's working on this right now" -- active_timers rows for this
// project's tasks. Unlike every other query in this file, this one
// cannot be written against the ordinary RLS-respecting client at all:
// `active_timers_select_active_members` was hardened in 20260902020000
// to `is_task_workspace_member(task_id) and not is_task_client(task_id)`
// -- a client role is explicitly excluded from ever reading an
// active_timers row, full stop, so there is no client-visible row here
// to filter down from (unlike `getProjectPhases`/`getPortalPages`, whose
// admin-client reads are only resolving a DISPLAY value for a row the
// client already reached through their own RLS-scoped read).
//
// Reads through the admin client from the start, scoped to `project_id`
// -- a project this caller already reached through the caller's own
// `getPortalProjects` (portal_enabled + membership) gate one query
// earlier in the same request -- and re-derives, in TypeScript, the one
// thing RLS would otherwise have enforced: excluding any timer belonging
// to a client member of this same workspace, so a client never sees
// their own (or a co-client's) "live now" entry reflected back at them.
//
// Never selects `started_at` at all: P3's own privacy boundary ("never
// show how long the timer has been running") is enforced by this
// function simply never fetching that column, not by fetching and then
// hiding it in the UI.
export type PortalLiveNowEntry = {
  id: string;
  userId: string;
  personName: string | null;
  avatarUrl: string | null;
  /** The client-visible task's title, or -- when the task itself is not
   * client-visible -- its phase's name (F006's own clarified spec:
   * "a task name only when the task is client-visible, otherwise the
   * phase name"). A task with neither (not client-visible and no phase)
   * falls back to a generic, honest label rather than fabricating one. */
  label: string;
};

export async function getPortalLiveNow(
  projectId: string,
): Promise<PortalLiveNowEntry[]> {
  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id, workspace_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return [];

  const { data: timers, error } = await admin
    .from("active_timers")
    .select(
      "id, user_id, tasks!inner(id, title, client_visible, phase_id, project_id, deleted_at)",
    )
    .eq("tasks.project_id", projectId)
    .is("tasks.deleted_at", null);

  if (error) {
    logger.error("getPortalLiveNow: failed to load active timers", { error });
    return [];
  }
  if (!timers?.length) return [];

  const userIds = [...new Set(timers.map((row) => row.user_id))];
  const phaseIds = [
    ...new Set(
      timers
        .map((row) => (Array.isArray(row.tasks) ? row.tasks[0] : row.tasks)?.phase_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [people, roleRows, phaseRows] = await Promise.all([
    resolvePeople(userIds),
    admin
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", project.workspace_id)
      .in("user_id", userIds),
    // F006b (missions/20260903-portal, AS-012): `client_visible` filtered
    // explicitly, same as `getProjectPhases`'s own identical filter (and
    // for the same reason -- this reads through the admin client, so
    // there is no RLS backing this predicate at all). Before this filter,
    // a `client_visible = false` phase's own NAME reached the client
    // whenever a timer ran on an internal task inside it -- the phase row
    // itself was never readable to the client (project_phases_select_
    // client already required client_visible), only this one DISPLAY
    // lookup skipped the same check the row-level read enforces.
    phaseIds.length > 0
      ? admin
          .from("project_phases")
          .select("id, name")
          .eq("client_visible", true)
          .in("id", phaseIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const roleByUserId = new Map((roleRows.data ?? []).map((r) => [r.user_id, r.role]));
  const phaseNameById = new Map((phaseRows.data ?? []).map((p) => [p.id, p.name]));

  return timers
    // A client should never see their own (or a co-client's) presence
    // reflected back at them -- "your team" is the agency's, never the
    // client's own membership.
    .filter((row) => roleByUserId.get(row.user_id) !== "client")
    .flatMap((row) => {
      const task = Array.isArray(row.tasks) ? row.tasks[0] : row.tasks;
      if (!task) return [];

      const person = people.get(row.user_id);
      const label = task.client_visible
        ? task.title
        : (task.phase_id && phaseNameById.get(task.phase_id)) || "Working on the project";

      return [
        {
          id: row.id,
          userId: row.user_id,
          personName: person?.name ?? null,
          avatarUrl: person?.avatarUrl ?? null,
          label,
        },
      ];
    });
}

// --- Your team (F006, missions/20260903-portal) ---------------------------
//
// `project_members` -- who is on this project, for the overview's "Your
// team" rail card. Same "RLS gives a client no row to read through"
// situation `getPortalLiveNow` documents above:
// `project_members_select_active_members` (hardened 20260902020000)
// lets a client read only THEIR OWN `project_members` row ("not
// is_project_client(project_id) or user_id = auth.uid()"), never a
// teammate's -- so this reads through the admin client from the start,
// scoped to `project_id` (already permitted to this caller via
// `getPortalProjects`' own gate), and excludes any member who is
// themselves a client of this workspace: "your team" means the agency's
// team, not this client's own membership row or a co-client's.
// F112 (missions/20260903-portal, six-star review Part 0/D): each person
// gets a real card -- name, project ROLE (job title, from `project_roles`
// -- PM, team lead, design lead, Webflow lead, designer, developer, NOT
// the `project_members.project_role` permission), a one-line "what they
// own" (`project_roles.note`, free text), and how to reach them (email).
// A person can hold more than one `project_roles` row; the card shows one
// row per (person, role) pair, same as the settings editor.
export type PortalTeamMember = {
  id: string;
  userId: string;
  name: string | null;
  avatarUrl: string | null;
  roleLabel: string;
  note: string | null;
  email: string | null;
};

export async function getPortalTeam(projectId: string): Promise<PortalTeamMember[]> {
  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id, workspace_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return [];

  const { data: members, error } = await admin
    .from("project_members")
    .select("user_id, project_role")
    .eq("project_id", projectId);

  if (error) {
    logger.error("getPortalTeam: failed to load project members", { error });
    return [];
  }
  if (!members?.length) return [];

  const userIds = [...new Set(members.map((m) => m.user_id))];

  const [people, roleRows, projectRoleRows] = await Promise.all([
    resolvePeople(userIds),
    admin
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", project.workspace_id)
      .in("user_id", userIds),
    admin
      .from("project_roles")
      .select("user_id, role, note")
      .eq("project_id", projectId),
  ]);

  const roleByUserId = new Map((roleRows.data ?? []).map((r) => [r.user_id, r.role]));
  const teamMemberIds = members
    .map((member) => member.user_id)
    .filter((userId) => roleByUserId.get(userId) !== "client");
  const teamMemberIdSet = new Set(teamMemberIds);

  const jobsByUserId = new Map<string, { role: string; note: string | null }[]>();
  for (const row of projectRoleRows.data ?? []) {
    if (!teamMemberIdSet.has(row.user_id)) continue;
    const list = jobsByUserId.get(row.user_id) ?? [];
    list.push({ role: row.role, note: row.note });
    jobsByUserId.set(row.user_id, list);
  }

  const orderIndex = new Map(PROJECT_ROLE_ORDER.map((value, index) => [value, index]));
  const rows: (PortalTeamMember & { sortIndex: number })[] = [];
  for (const userId of teamMemberIds) {
    const person = people.get(userId);
    const jobs = jobsByUserId.get(userId);
    if (jobs?.length) {
      for (const job of jobs) {
        rows.push({
          id: `${userId}:${job.role}`,
          userId,
          name: person?.name ?? null,
          avatarUrl: person?.avatarUrl ?? null,
          roleLabel: PROJECT_ROLE_LABELS[job.role as ProjectRoleValue] ?? job.role,
          note: job.note,
          email: person?.email ?? null,
          sortIndex: orderIndex.get(job.role as ProjectRoleValue) ?? 99,
        });
      }
    } else {
      const member = members.find((m) => m.user_id === userId);
      rows.push({
        id: userId,
        userId,
        name: person?.name ?? null,
        avatarUrl: person?.avatarUrl ?? null,
        // No `project_roles` job title assigned yet -- fall back to the
        // only per-project "role" this schema had before this feature
        // (`project_members.project_role`, `lead` | `member`), same label
        // this card rendered before F112.
        roleLabel: member?.project_role === "lead" ? "Project lead" : "Team member",
        note: null,
        email: person?.email ?? null,
        sortIndex: 99,
      });
    }
  }

  return rows
    .sort((a, b) => a.sortIndex - b.sortIndex)
    .map(({ sortIndex: _sortIndex, ...row }) => row);
}

// --- Client requests (C5) ---------------------------------------------------

export type PortalRequest = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  body: string | null;
  desiredBy: string | null;
  status: "submitted" | "in_review" | "accepted" | "declined";
  declineReason: string | null;
  convertedTaskId: string | null;
  convertedTaskTitle: string | null;
  convertedTaskStatus: string | null;
  createdAt: string;
};

// Every client request on this workspace's portal-enabled projects, not
// just the ones this caller filed. F016e (missions/20260903-portal,
// M3-scrutiny defect 2, AS-048): `client_requests_select_author_or_team`
// used to scope a client caller to `created_by = auth.uid()` — two people
// from the same client company each saw only the half of their own
// project's requests they personally authored. The policy is now
// project-scoped, the same shape every other client-facing SELECT policy
// in this file already uses, so no `created_by` filter is repeated here
// either.
//
// F006b (missions/20260903-portal, AS-007): the `projects` read below
// filters on `portal_enabled` explicitly, the same load-bearing reason
// `getPortalProjects` states on its own identical filter — RLS does not
// gate an ordinary `projects` SELECT by `portal_enabled` (that column has
// no bearing on ordinary project visibility), so this is the actual gate
// for this function's `projectNames` map AND, because it narrows the
// `project_id in (...)` list the `client_requests` query below is scoped
// to, for the requests themselves too. `client_requests_select_author_or_
// team` (20260913010000) now folds the same `portal_enabled` check into
// the author's own branch as a second, database-level gate — this filter
// stays as belt-and-braces so a caller of this function never has to
// reason about a portal-disabled project's id reaching either query.
export async function getPortalRequests(
  workspaceId: string,
): Promise<PortalRequest[]> {
  const supabase = await getRequestClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .eq("portal_enabled", true);

  const projectNames = new Map(
    (projects ?? []).map((p) => [p.id as string, p.name as string]),
  );

  if (projectNames.size === 0) return [];

  const { data, error } = await supabase
    .from("client_requests")
    .select(
      "id, project_id, title, body, desired_by, status, decline_reason, converted_task_id, created_at, tasks(title, status)",
    )
    .in("project_id", [...projectNames.keys()])
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("getPortalRequests failed", { error: error });
    return [];
  }

  return (data ?? []).map((row) => {
    // The embedded task is only readable when it is shared with the client
    // — which `acceptClientRequest` guarantees for anything it converts.
    // A null here therefore means "accepted, then later un-shared by the
    // team", which the UI renders as accepted without a link rather than
    // pretending the task does not exist.
    const task = Array.isArray(row.tasks) ? row.tasks[0] : row.tasks;

    return {
      id: row.id,
      projectId: row.project_id,
      projectName: projectNames.get(row.project_id) ?? "",
      title: row.title,
      body: row.body,
      desiredBy: row.desired_by,
      status: row.status as PortalRequest["status"],
      declineReason: row.decline_reason,
      convertedTaskId: row.converted_task_id,
      convertedTaskTitle: task?.title ?? null,
      convertedTaskStatus: task?.status ?? null,
      createdAt: row.created_at,
    };
  });
}

export type PortalProjectOption = { id: string; name: string };

// F006b (missions/20260903-portal, AS-007): the new-request form's own
// project `<select>` — every other project-scoped read in this file that
// touches `projects` directly needs the same explicit `portal_enabled`
// filter `getPortalProjects` documents on its own identical line, because
// RLS never gates an ordinary `projects` SELECT by that column. Without
// it, a client on a portal-enabled AND a portal-disabled project could
// file a NEW request against the disabled one from this exact dropdown —
// this was the write half of the M1 scrutiny report's B1.
export async function getPortalProjectOptions(
  workspaceId: string,
): Promise<PortalProjectOption[]> {
  const supabase = await getRequestClient();
  const { data } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .eq("portal_enabled", true)
    .order("name");
  return (data ?? []).map((p) => ({ id: p.id, name: p.name }));
}

// --- Task detail + conversation (C7) ---------------------------------------

export type PortalComment = {
  id: string;
  text: string;
  createdAt: string;
  authorId: string;
  authorName: string | null;
  isMine: boolean;
};

export type PortalTaskDetail = PortalTask & {
  projectId: string;
  projectName: string;
  description: string | null;
  comments: PortalComment[];
  // F4 (docs/client-dashboard-features-plan.md): drives the
  // Approve/Request changes controls on this page.
  pendingClientApproval: boolean;
};

// One shared task, with the part of its conversation the client is allowed
// to see. RLS decides both halves: a task that is not shared returns no
// row, and an internal comment returns no row — so `null` here means
// "nothing to show", never "hidden but present".
export async function getPortalTaskDetail(
  workspaceId: string,
  taskId: string,
  currentUserId: string,
): Promise<PortalTaskDetail | null> {
  const supabase = await getRequestClient();

  const { data: task, error } = await supabase
    .from("tasks")
    .select(
      "id, title, status, status_id, due_date, description, project_id, pending_client_approval",
    )
    .eq("id", taskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !task) return null;

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, workspace_id")
    .eq("id", task.project_id)
    .maybeSingle();

  // Guards against a task id from another workspace being rendered inside
  // this workspace's portal chrome.
  if (!project || project.workspace_id !== workspaceId) return null;

  const { data: statuses } = await supabase
    .from("project_statuses")
    .select("id, name, category, client_bucket")
    .eq("project_id", task.project_id);

  const matchedStatus =
    (statuses ?? []).find((s) => s.id === task.status_id) ??
    (statuses ?? []).find((s) => s.name === task.status) ??
    null;
  const category = matchedStatus?.category ?? "not_started";
  const clientBucket = matchedStatus?.client_bucket ?? null;

  const { data: comments } = await supabase
    .from("comments")
    .select("id, text, created_at, user_id")
    .eq("task_id", taskId)
    .is("deleted_at", null)
    .order("created_at");

  const authorIds = [...new Set((comments ?? []).map((c) => c.user_id))];
  const names = new Map<string, string | null>();

  if (authorIds.length > 0) {
    // A client cannot read the team's profiles (20260902020000), so this
    // returns their own name and nothing else. Rather than render blanks,
    // the UI falls back to the workspace name for anyone it cannot
    // resolve — from the client's side "someone at the agency said this"
    // is the honest and sufficient attribution.
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", authorIds);
    for (const profile of profiles ?? []) {
      names.set(profile.id, profile.display_name);
    }
  }

  return {
    id: task.id,
    title: task.title,
    status: task.status,
    statusId: task.status_id,
    dueDate: task.due_date,
    category: category as StatusCategory,
    clientBucket,
    projectId: project.id,
    projectName: project.name,
    description: task.description,
    comments: (comments ?? []).map((comment) => ({
      id: comment.id,
      text: comment.text,
      createdAt: comment.created_at,
      authorId: comment.user_id,
      authorName: names.get(comment.user_id) ?? null,
      isMine: comment.user_id === currentUserId,
    })),
    pendingClientApproval: task.pending_client_approval ?? false,
  };
}

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

  const categoryByStatusId = new Map<string, StatusCategory>();
  // F006g (missions/20260903-portal, AS-015, AS-017): carried alongside
  // category so this list's "waiting" predicate can route through the
  // exact same `resolveClientBucket` the Pages distribution uses --
  // never a second, independent definition of "waiting" the two screens
  // could disagree on.
  const clientBucketByStatusId = new Map<string, string | null>();
  for (const status of (statuses ?? []) as StatusRowWithBucket[]) {
    categoryByStatusId.set(status.id, status.category);
    clientBucketByStatusId.set(status.id, status.client_bucket ?? null);
  }

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

// --- Files (F3, docs/client-dashboard-features-plan.md) -------------------
//
// One list of every attachment on a task the client can see, instead of
// making them open each task to find one. RLS-scoped exactly like this
// file's other queries: attachments join back to tasks, and a client's own
// SELECT on `tasks` already only returns client_visible rows (20260902010000),
// so filtering here on client_visible again is belt-and-suspenders, not the
// real boundary.

export type PortalFile = {
  id: string;
  fileName: string;
  createdAt: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
};

export async function getPortalFiles(
  workspaceId: string,
): Promise<PortalFile[]> {
  const supabase = await getRequestClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  const projectIds = (projects ?? []).map((p) => p.id);
  const projectNames = new Map((projects ?? []).map((p) => [p.id, p.name]));

  if (projectIds.length === 0) return [];

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, project_id")
    .in("project_id", projectIds)
    .eq("client_visible", true)
    .is("deleted_at", null);

  const taskIds = (tasks ?? []).map((t) => t.id);
  if (taskIds.length === 0) return [];

  const taskById = new Map((tasks ?? []).map((t) => [t.id, t]));

  const { data: attachments } = await supabase
    .from("attachments")
    .select("id, file_name, created_at, task_id")
    .in("task_id", taskIds)
    .order("created_at", { ascending: false });

  return (attachments ?? []).flatMap((attachment) => {
    const task = taskById.get(attachment.task_id);
    if (!task) return [];
    return [
      {
        id: attachment.id,
        fileName: attachment.file_name,
        createdAt: attachment.created_at,
        taskId: task.id,
        taskTitle: task.title,
        projectId: task.project_id,
        projectName: projectNames.get(task.project_id) ?? "",
      },
    ];
  });
}

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

// F111 (missions/20260903-portal, docs/client-portal-visual-plan.md 3.6):
// "Weekly delivery rhythm" -- how much client-visible work shipped, week
// by week, across the project's own span. See lib/portal/weekly-delivery.ts's
// own header for the full definition of "shipped in week N" and why
// `task_activity` (not `updated_at`) is the source. This function does
// the two reads that definition needs and hands the plain completion-date
// list to that pure module -- the DB/RLS boundary and the series math stay
// separate, same split as getProjectPhases/computePhaseTimelineLayout.
export async function getPortalWeeklyDelivery(
  projectId: string,
  projectStartDate: string | null,
  todayIso: string,
): Promise<PortalQueryResult<WeeklyDeliveryWeek[]>> {
  const supabase = await getRequestClient();

  // Same `client_visible` scoping every other business-logic read in this
  // file applies explicitly (getProjectPhases's own comment: RLS already
  // hides a non-visible task from a client session, but this figure must
  // stay correct for a team member previewing the client's own numbers
  // too).
  const { data: tasks, error: tasksError } = await supabase
    .from("tasks")
    .select("id, status_id, status, created_at")
    .eq("project_id", projectId)
    .eq("client_visible", true)
    .is("deleted_at", null);

  if (tasksError) {
    logger.error("getPortalWeeklyDelivery: failed to load tasks", { error: tasksError });
    return { ok: false, error: tasksError.message };
  }

  const fallbackStart = projectStartDate ?? tasks?.[0]?.created_at?.slice(0, 10) ?? todayIso;

  if (!tasks?.length) {
    return { ok: true, data: computeWeeklyDeliverySeries([], fallbackStart, todayIso) };
  }

  const { data: statuses, error: statusesError } = await supabase
    .from("project_statuses")
    .select("id, project_id, name, category")
    .eq("project_id", projectId);

  if (statusesError) {
    logger.error("getPortalWeeklyDelivery: failed to load statuses", { error: statusesError });
    return { ok: false, error: statusesError.message };
  }

  // Same category-resolution convention as getProjectPhases/getPortalOverview
  // above (categoryByStatusId, falling back to a name match) -- never a
  // hardcoded `status === 'done'` string check, so a project that renamed
  // or reordered its default columns still resolves correctly.
  const categoryByStatusId = new Map<string, StatusCategory>();
  const categoryByName = new Map<string, StatusCategory>();
  for (const status of (statuses ?? []) as StatusRow[]) {
    categoryByStatusId.set(status.id, status.category);
    categoryByName.set(status.name, status.category);
  }

  const doneTasks = tasks.filter((task) => {
    const category = task.status_id
      ? categoryByStatusId.get(task.status_id)
      : categoryByName.get(task.status);
    return category === "done";
  });

  if (doneTasks.length === 0) {
    return { ok: true, data: computeWeeklyDeliverySeries([], fallbackStart, todayIso) };
  }

  const doneTaskIds = doneTasks.map((task) => task.id);

  const { data: activity, error: activityError } = await supabase
    .from("task_activity")
    .select("task_id, created_at")
    .in("task_id", doneTaskIds)
    .eq("kind", "field_changed")
    .eq("field", "status")
    .order("created_at", { ascending: false });

  if (activityError) {
    logger.error("getPortalWeeklyDelivery: failed to load task_activity", {
      error: activityError,
    });
    return { ok: false, error: activityError.message };
  }

  // Rows arrive most-recent-first, so the first row seen for a task_id is
  // its LAST status change -- exactly the "last transition, task still
  // done today" reading this feature's definition requires (see
  // lib/portal/weekly-delivery.ts's header for why the last, not the
  // first, transition is used).
  const lastStatusChangeByTask = new Map<string, string>();
  for (const row of activity ?? []) {
    if (!lastStatusChangeByTask.has(row.task_id)) {
      lastStatusChangeByTask.set(row.task_id, row.created_at);
    }
  }

  // Fallback per task (documented in lib/portal/weekly-delivery.ts's
  // header): a done task with no recorded status-change event at all --
  // predates F194/F195, or was seeded/imported already done -- uses its
  // own `created_at`, never `updated_at`.
  const completionDates = doneTasks.map(
    (task) => lastStatusChangeByTask.get(task.id) ?? task.created_at,
  );

  return { ok: true, data: computeWeeklyDeliverySeries(completionDates, fallbackStart, todayIso) };
}
