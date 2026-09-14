import { logger } from "@/lib/observability/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePeople } from "@/lib/queries/people";
import {
  PROJECT_ROLE_LABELS,
  PROJECT_ROLE_ORDER,
  type ProjectRoleValue,
} from "@/lib/queries/project-roles";

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
