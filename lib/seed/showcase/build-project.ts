// Generic project builder: turns a ProjectSpec (tasks, phases, people,
// comments, time plan) into rows. Project-specific records (budgets,
// scope, approvals, metrics, docs, chat, ...) are added by the per-project
// modules on top of the context this returns.

import type { People, PersonKey } from "./accounts";
import type { Discipline, StatusName, TaskSpec, TypeKey } from "./types";
import {
  type Admin,
  type Inline,
  at,
  day,
  insertRows,
  isWeekend,
  richDoc,
  rng,
  uuid,
} from "./util";

export type CommentSpec = {
  task: string;
  by: PersonKey;
  daysAgo: number;
  hour?: number;
  parts: Inline[] | ((p: People) => Inline[]);
  internal?: boolean;
  reactions?: Array<[PersonKey, string]>;
};

export type TimePlan = {
  // Billable-ish target hours for each ISO date range.
  periods: Array<{ from: number; to: number; hoursPerWeek: number }>;
  seed: number;
};

export type ProjectSpec = {
  key: string;
  name: string;
  description: string;
  icon: string;
  sidebarPosition: number;
  billingModel: "fixed_price" | "hourly";
  start: number;
  end: number | null;
  createdDaysAgo: number;
  targetLaunch?: number;
  launchConfidence?: "on_track" | "at_risk" | "slipped";
  launchNote?: string;
  warrantyUntil?: number;
  warrantyTerms?: string;
  lead: PersonKey;
  members: Array<{ who: PersonKey; lead?: boolean }>;
  roles: Array<{ who: PersonKey; role: "pm" | "team_lead" | "design_lead" | "webflow_lead" | "designer" | "developer"; note?: string }>;
  phases: Array<{
    name: string;
    clientDescription: string;
    state: "not_started" | "active" | "blocked" | "done";
    plannedStart: number;
    plannedEnd: number;
    actualStart?: number;
    actualEnd?: number;
    blockedReason?: string;
  }>;
  components: string[];
  customFields: Array<{ name: string; type: "text" | "number" | "url" | "checkbox" }>;
  tasks: TaskSpec[];
  dependencies: Array<[string, string]>; // [blocking, blocked]
  comments: CommentSpec[];
  timePlan: TimePlan;
  attachments: Array<{ task: string; by: PersonKey; name: string; kind: "png" | "pdf" | "csv" | "txt"; daysAgo: number; accent?: string }>;
};

export type ProjectCtx = {
  admin: Admin;
  workspaceId: string;
  people: People;
  projectId: string;
  spec: ProjectSpec;
  statusIds: Record<StatusName, string>;
  typeIds: Record<TypeKey, string>;
  phaseIds: Record<string, string>;
  taskIds: Record<string, string>;
  taskSpecs: Record<string, TaskSpec>;
  commentIds: string[];
  commentByTask: Record<string, string[]>;
  channelId: string;
  counts: Record<string, number>;
};

export const DONE_STATUSES: StatusName[] = ["Approved", "Completed"];
const STATUS_CATEGORY: Record<StatusName, "not_started" | "in_progress" | "done"> = {
  Backlog: "not_started",
  "To Do": "not_started",
  Blocked: "not_started",
  Canceled: "not_started",
  "In Design": "in_progress",
  "In Dev": "in_progress",
  "QA by Dev": "in_progress",
  "QA by Design": "in_progress",
  "Awaiting Client": "in_progress",
  Approved: "done",
  Completed: "done",
};
export const statusCategory = (s: StatusName) => STATUS_CATEGORY[s];

const FLOW: StatusName[] = ["To Do", "In Design", "In Dev", "QA by Dev", "QA by Design", "Awaiting Client", "Approved", "Completed"];

const CATEGORY_BY_PERSON: Record<PersonKey, Discipline> = {
  tom: "pm",
  anna: "pm",
  john: "development",
  maja: "design",
  marko: "development",
  nina: "qa",
  gary: "content_seo",
  lisa: "pm",
  clara: "pm",
  erik: "pm",
  marketing: "content_seo",
};

const ENTRY_NOTES: Record<Discipline, string[]> = {
  design: ["Design iterations", "Figma handoff annotations", "Design QA on staging", "Feedback round with Clara", "Mobile variants", "Visual polish"],
  development: ["Build + responsive pass", "CMS bindings", "Bug fixing", "Code review", "Integration work", "Performance tuning", "Staging deploy + smoke test"],
  content_seo: ["Keyword mapping", "Copy draft", "Meta titles & descriptions", "Internal links", "Copy edits after review"],
  pm: ["Client call + follow-up", "Planning & estimates", "Status update", "Scope discussion", "Sprint planning"],
  qa: ["Test pass", "Regression testing", "Device lab testing", "Bug verification"],
};

function taskWindow(t: TaskSpec, projectStart: number): [number, number] | null {
  const cat = STATUS_CATEGORY[t.status];
  if (t.status === "Backlog" || t.status === "To Do") return null;
  const created = -(t.createdDaysAgo ?? -projectStart);
  const start = t.start ?? (t.due != null ? t.due - Math.max(3, Math.ceil((t.estimate ?? 240) / 300)) : created);
  let end: number;
  if (cat === "done") end = Math.min(t.due ?? 0, 0);
  else end = 0;
  if (t.status === "Canceled") end = Math.min(t.due ?? 0, start + 7, 0);
  const s = Math.max(start, projectStart);
  if (end < s) return [s, s];
  return [s, end];
}

export async function buildProject(
  admin: Admin,
  workspaceId: string,
  people: People,
  spec: ProjectSpec,
): Promise<ProjectCtx> {
  const counts: Record<string, number> = {};
  const projectId = uuid();
  const P = (k: PersonKey) => people[k];

  // ------------------------------------------------------------ project
  await insertRows(admin, "projects", [
    {
      id: projectId,
      workspace_id: workspaceId,
      name: spec.name,
      description: spec.description,
      key: spec.key,
      icon: spec.icon,
      sidebar_position: spec.sidebarPosition,
      start_date: day(spec.start),
      end_date: spec.end != null ? day(spec.end) : null,
      created_by: P("tom"),
      created_at: at(-spec.createdDaysAgo, 9),
      billing_model: spec.billingModel,
      visibility: "workspace",
      portal_enabled: true,
      portal_enabled_at: at(-spec.createdDaysAgo + 2, 10),
      target_launch_date: spec.targetLaunch != null ? day(spec.targetLaunch) : null,
      launch_confidence: spec.launchConfidence ?? null,
      launch_note: spec.launchNote ?? null,
      warranty_until: spec.warrantyUntil != null ? day(spec.warrantyUntil) : null,
      warranty_terms: spec.warrantyTerms ?? null,
    },
  ], counts);

  // Board columns come from the seed trigger. Give the two columns that
  // mean something to a client their explicit client bucket (the same
  // thing the Columns settings screen does).
  const { data: statuses, error: statusError } = await admin
    .from("project_statuses")
    .select("id, name")
    .eq("project_id", projectId);
  if (statusError || !statuses?.length) throw new Error(`load statuses: ${statusError?.message}`);
  const statusIds = Object.fromEntries(statuses.map((s) => [s.name, s.id])) as Record<StatusName, string>;
  for (const [name, bucket, desc] of [
    ["Blocked", "blocked", "Paused until something outside the team is resolved."],
    ["Awaiting Client", "waiting", "Waiting for your review or input."],
    ["Approved", "done", "Approved by you — ready for launch."],
  ] as const) {
    const { error } = await admin
      .from("project_statuses")
      .update({ client_bucket: bucket, client_description: desc })
      .eq("id", statusIds[name]);
    if (error) throw new Error(`status bucket ${name}: ${error.message}`);
  }

  const { data: types, error: typeError } = await admin
    .from("task_types")
    .select("id, system_key")
    .eq("workspace_id", workspaceId);
  if (typeError) throw new Error(`load task types: ${typeError.message}`);
  const typeIds = Object.fromEntries(
    (types ?? []).filter((t) => t.system_key).map((t) => [t.system_key, t.id]),
  ) as Record<TypeKey, string>;
  for (const k of ["page", "delivery", "qa", "client_request", "change_request", "improvement"] as TypeKey[]) {
    if (!typeIds[k]) throw new Error(`task type ${k} missing in workspace`);
  }

  // ------------------------------------------------------------ members
  await insertRows(admin, "project_members", spec.members.map((m, i) => ({
    project_id: projectId,
    user_id: P(m.who),
    project_role: m.lead ? "lead" : "member",
    added_by: P("tom"),
    created_at: at(-spec.createdDaysAgo + (i > 5 ? 2 : 0), 9, 30 + i),
  })), counts);

  await insertRows(admin, "project_roles", spec.roles.map((r) => ({
    project_id: projectId,
    user_id: P(r.who),
    role: r.role,
    note: r.note ?? null,
    added_by: P("tom"),
  })), counts);

  // Project chat channel — same idempotent RPC createProject/setPortalEnabled
  // use; enrolls every project member (team + clients).
  const { data: channelId, error: channelError } = await admin.rpc("ensure_project_channel_atomic", {
    p_project_id: projectId,
    p_created_by: P("tom"),
  });
  if (channelError || !channelId) throw new Error(`ensure_project_channel_atomic: ${channelError?.message}`);
  counts.channels = 1;
  counts.channel_members = spec.members.length;

  // ------------------------------------------------------------ phases
  const phaseIds: Record<string, string> = {};
  await insertRows(admin, "project_phases", spec.phases.map((ph, i) => {
    const id = uuid();
    phaseIds[ph.name] = id;
    return {
      id,
      project_id: projectId,
      name: ph.name,
      client_description: ph.clientDescription,
      position: i + 1,
      state: ph.state,
      planned_start: day(ph.plannedStart),
      planned_end: day(ph.plannedEnd),
      actual_start: ph.actualStart != null ? day(ph.actualStart) : null,
      actual_end: ph.actualEnd != null ? day(ph.actualEnd) : null,
      blocked_reason: ph.blockedReason ?? null,
      client_visible: true,
    };
  }), counts);

  // --------------------------------------------------- components/fields
  const componentIds: Record<string, string> = {};
  await insertRows(admin, "page_components", spec.components.map((name, i) => {
    const id = uuid();
    componentIds[name] = id;
    return { id, project_id: projectId, name, position: i };
  }), counts);

  const fieldIds: Record<string, string> = {};
  await insertRows(admin, "project_custom_fields", spec.customFields.map((f, i) => {
    const id = uuid();
    fieldIds[f.name] = id;
    return { id, project_id: projectId, name: f.name, field_type: f.type, position: (i + 1) * 1000 };
  }), counts);

  // -------------------------------------------------------------- tasks
  const taskIds: Record<string, string> = {};
  const taskSpecs: Record<string, TaskSpec> = {};
  for (const t of spec.tasks) {
    taskIds[t.ref] = uuid();
    taskSpecs[t.ref] = t;
  }

  type TaskRow = Parameters<typeof insertRows<"tasks">>[2][number];
  const parents: TaskRow[] = [];
  const children: TaskRow[] = [];
  const sectionRefs: Array<{ id: string; pageRef: string; spec: NonNullable<TaskSpec["page"]>["sections"][number] }> = [];

  const ordered = [...spec.tasks].sort((a, b) => (b.createdDaysAgo ?? 0) - (a.createdDaysAgo ?? 0));
  let pagePos = 0;
  ordered.forEach((t, index) => {
    const created = t.createdDaysAgo ?? spec.createdDaysAgo - 1;
    const updatedDaysAgo = Math.max(0, Math.min(created, t.due != null && t.due < 0 ? -t.due : 1));
    const body = t.description ? richDoc([[t.description]]) : null;
    let start = t.start != null ? day(t.start) : null;
    const due = t.due != null ? day(t.due) : null;
    if (start && due && start > due) start = due;
    const row: TaskRow = {
      id: taskIds[t.ref],
      project_id: projectId,
      title: t.title,
      description: t.description ?? null,
      description_json: body?.json ?? null,
      status: t.status,
      priority: t.priority,
      tags: t.tags ?? [],
      start_date: start,
      due_date: due,
      points: t.points ?? null,
      author_id: P(t.author ?? (spec.lead === "anna" ? "anna" : "tom")),
      assignee_id: t.assignees?.length ? P(t.assignees[0]) : null,
      position: (index + 1) * 1000,
      created_at: at(-created, 9, index % 60),
      updated_at: at(-updatedDaysAgo, 15, index % 60),
      estimate_minutes: t.estimate ?? null,
      recurrence: t.recurrence ?? null,
      client_visible: t.clientVisible ?? false,
      task_type_id: typeIds[t.type],
      pending_client_approval: t.pendingApproval ?? false,
      phase_id: t.phase ? phaseIds[t.phase] ?? null : null,
      blocked_reason: t.blockedReason ?? null,
      billable: t.billable ?? true,
      parent_task_id: t.parent ? taskIds[t.parent] : null,
      page_slug: t.page?.slug ?? null,
      page_kind: t.page?.kind ?? null,
      page_order: t.page ? (pagePos += 1) : null,
    };
    (t.parent ? children : parents).push(row);

    t.page?.sections.forEach((s, si) => {
      const id = uuid();
      const ref = `${t.ref}#${si}`;
      taskIds[ref] = id;
      sectionRefs.push({ id, pageRef: t.ref, spec: s });
      taskSpecs[ref] = {
        ref, title: s.title, status: s.status, priority: null, type: "page",
        assignees: s.assignees ?? t.assignees, clientVisible: s.clientVisible ?? t.clientVisible,
      };
      children.push({
        id,
        project_id: projectId,
        parent_task_id: taskIds[t.ref],
        title: s.title,
        status: s.status,
        priority: null,
        author_id: P("john"),
        assignee_id: s.assignees?.length ? P(s.assignees[0]) : t.assignees?.length ? P(t.assignees[0]) : null,
        position: (si + 1) * 1000,
        created_at: at(-created, 9, 30 + si),
        updated_at: at(-Math.min(created, 4), 11, si),
        client_visible: s.clientVisible ?? t.clientVisible ?? false,
        task_type_id: typeIds.page,
        phase_id: t.phase ? phaseIds[t.phase] ?? null : null,
        section_kind: s.kind ?? "static",
        component_id: s.component ? componentIds[s.component] : null,
        billable: true,
      });
    });
  });
  // Page tasks use the Page type for the page itself too.
  await insertRows(admin, "tasks", parents, counts);
  await insertRows(admin, "tasks", children, counts);

  // --------------------------------------------- assignees / watchers / checklist
  const assigneeRows = spec.tasks.flatMap((t) =>
    (t.assignees ?? []).map((who) => ({ task_id: taskIds[t.ref], user_id: P(who), assigned_by: P(spec.lead), created_at: at(-(t.createdDaysAgo ?? 30), 10) })),
  );
  for (const s of sectionRefs) {
    const who = s.spec.assignees ?? taskSpecs[s.pageRef].assignees ?? [];
    for (const w of who.slice(0, 1)) assigneeRows.push({ task_id: s.id, user_id: P(w), assigned_by: P(spec.lead), created_at: at(-10, 10) });
  }
  await insertRows(admin, "task_assignees", assigneeRows, counts);

  await insertRows(admin, "task_watchers", spec.tasks.flatMap((t) => {
    const set = new Set<PersonKey>([...(t.watchers ?? [])]);
    if (t.author) set.add(t.author);
    for (const a of t.assignees ?? []) set.delete(a);
    return [...set].map((who) => ({ task_id: taskIds[t.ref], user_id: P(who), is_watching: true }));
  }), counts);

  await insertRows(admin, "checklist_items", spec.tasks.flatMap((t) =>
    (t.checklist ?? []).map(([content, done], i) => ({
      task_id: taskIds[t.ref],
      content,
      is_checked: done,
      checked_by: done ? P(t.assignees?.[0] ?? spec.lead) : null,
      checked_at: done ? at(-Math.max(1, (t.createdDaysAgo ?? 10) - i * 2), 14) : null,
      position: (i + 1) * 1000,
    })),
  ), counts);

  await insertRows(admin, "task_custom_field_values", spec.tasks.flatMap((t) =>
    Object.entries(t.custom ?? {}).map(([name, value]) => {
      if (!fieldIds[name]) throw new Error(`custom field ${name} not defined`);
      return { task_id: taskIds[t.ref], field_id: fieldIds[name], value };
    }),
  ), counts);

  // ---------------------------------------------- architecture extras
  const pageTasks = spec.tasks.filter((t) => t.page);
  await insertRows(admin, "task_discipline_estimates", pageTasks.flatMap((t) =>
    Object.entries(t.page!.estimates ?? {}).map(([discipline, hours]) => ({
      task_id: taskIds[t.ref],
      project_id: projectId,
      discipline,
      minutes: Math.round((hours as number) * 60),
      estimated_by: P(discipline === "design" ? "maja" : discipline === "qa" ? "nina" : discipline === "pm" ? spec.lead : "john"),
    })),
  ), counts);

  await insertRows(admin, "architecture_node_meta", pageTasks.filter((t) => t.page!.meta).map((t) => {
    const m = t.page!.meta!;
    return {
      task_id: taskIds[t.ref],
      project_id: projectId,
      intent: m.intent,
      audience: m.audience,
      primary_cta: m.primaryCta,
      tone: m.tone,
      keywords: m.keywords,
      copy_status: m.copyStatus,
      updated_by: P(spec.members.some((x) => x.who === "gary") ? "gary" : "john"),
    };
  }), counts);

  await insertRows(admin, "page_links", pageTasks.flatMap((t) =>
    (t.page!.links ?? []).map((l, i) => ({
      task_id: taskIds[t.ref],
      kind: l.kind,
      label: l.label,
      url: l.url,
      client_visible: l.clientVisible,
      position: i,
    })),
  ), counts);

  // ------------------------------------------------------ dependencies
  await insertRows(admin, "task_dependencies", spec.dependencies.map(([blocking, blocked]) => {
    if (!taskIds[blocking] || !taskIds[blocked]) throw new Error(`dependency ${blocking}→${blocked}: unknown ref`);
    return { blocking_task_id: taskIds[blocking], blocked_task_id: taskIds[blocked], created_by: P(spec.lead) };
  }), counts);

  // --------------------------------------------------------- comments
  const commentIds: string[] = [];
  const commentByTask: Record<string, string[]> = {};
  const commentRows = spec.comments.map((c) => {
    const parts = typeof c.parts === "function" ? c.parts(people) : c.parts;
    const doc = richDoc([parts]);
    const id = uuid();
    commentIds.push(id);
    (commentByTask[c.task] ??= []).push(id);
    if (!taskIds[c.task]) throw new Error(`comment on unknown task ${c.task}`);
    return {
      id,
      task_id: taskIds[c.task],
      user_id: P(c.by),
      text: doc.text,
      body_text: doc.text,
      body_json: doc.json,
      internal: c.internal ?? false,
      created_at: at(-c.daysAgo, c.hour ?? 10, (commentIds.length * 7) % 60),
    };
  });
  await insertRows(admin, "comments", commentRows, counts);
  await insertRows(admin, "comment_reactions", spec.comments.flatMap((c, i) =>
    (c.reactions ?? []).map(([who, emoji]) => ({ comment_id: commentIds[i], task_id: taskIds[c.task], user_id: P(who), emoji })),
  ), counts);

  // ------------------------------------------------------ task activity
  const activity: Array<Parameters<typeof insertRows<"task_activity">>[2][number]> = [];
  for (const t of spec.tasks) {
    const id = taskIds[t.ref];
    const created = t.createdDaysAgo ?? spec.createdDaysAgo - 1;
    const actor = P(t.assignees?.[0] ?? spec.lead);
    if (t.due != null) {
      activity.push({ task_id: id, actor_id: P(spec.lead), kind: "field_changed", field: "due_date", old_value: null, new_value: day(t.due), created_at: at(-created, 9, 5) });
    }
    for (const who of t.assignees ?? []) {
      activity.push({ task_id: id, actor_id: P(spec.lead), kind: "field_changed", field: "assignee_id", old_value: null, new_value: P(who), created_at: at(-created, 9, 10) });
    }
    // Status path up to the current column.
    let path: StatusName[] = [];
    if (t.status === "Blocked") path = ["To Do", "In Dev", "Blocked"];
    else if (t.status === "Canceled") path = ["Backlog", "Canceled"];
    else if (t.status === "Backlog") path = [];
    else {
      const idx = FLOW.indexOf(t.status);
      const flow = FLOW.slice(0, idx + 1).filter((s) => t.type === "page" || s !== "In Design" || t.status === "In Design");
      path = flow.length > 4 ? [flow[0], flow[1], flow[flow.length - 2], flow[flow.length - 1]] : flow;
    }
    const endDay = Math.min(0, t.due ?? 0);
    const span = Math.max(1, created + endDay);
    for (let i = 1; i < path.length; i += 1) {
      const daysAgo = Math.max(0, Math.round(created - (span * i) / path.length));
      activity.push({ task_id: id, actor_id: actor, kind: "field_changed", field: "status", old_value: path[i - 1], new_value: path[i], created_at: at(-daysAgo, 11 + i, 15) });
    }
    if (t.priority === "urgent" && created > 5) {
      activity.push({ task_id: id, actor_id: P(spec.lead), kind: "field_changed", field: "priority", old_value: "high", new_value: "urgent", created_at: at(-Math.round(created / 2), 16) });
    }
  }
  commentRows.forEach((c) => {
    activity.push({ task_id: c.task_id, actor_id: c.user_id, kind: "comment_added", field: null, old_value: null, new_value: { comment_id: c.id }, created_at: c.created_at });
  });
  await insertRows(admin, "task_activity", activity, counts);

  // -------------------------------------------------------- time entries
  const entries = generateTimeEntries(spec, taskIds, taskSpecs, people);
  await insertRows(admin, "time_entries", entries, counts);

  return {
    admin,
    workspaceId,
    people,
    projectId,
    spec,
    statusIds,
    typeIds,
    phaseIds,
    taskIds,
    taskSpecs,
    commentIds,
    commentByTask,
    channelId: channelId as string,
    counts,
  };
}

function generateTimeEntries(
  spec: ProjectSpec,
  taskIds: Record<string, string>,
  taskSpecs: Record<string, TaskSpec>,
  people: People,
) {
  const rand = rng(spec.timePlan.seed);
  const candidates = Object.entries(taskSpecs)
    .map(([ref, t]) => ({ ref, t, window: taskWindow(t, spec.start) }))
    .filter((c) => c.window && (c.t.assignees?.length ?? 0) > 0 && !c.ref.includes("#"));

  type Entry = { task_id: string; user_id: string; minutes: number; billable: boolean; note: string | null; entry_date: string; work_category: Discipline; created_at: string };
  const merged = new Map<string, Entry>();

  for (const period of spec.timePlan.periods) {
    for (let d = period.from; d <= Math.min(period.to, 0); d += 1) {
      const date = day(d);
      if (isWeekend(date)) continue;
      let minutesToday = (period.hoursPerWeek * 60) / 5;
      minutesToday *= 0.7 + rand() * 0.6; // day-to-day wobble
      if (d === 0) minutesToday *= 0.45; // today is only half over
      const active = candidates.filter((c) => c.window![0] <= d && d <= c.window![1]);
      if (!active.length) continue;
      const weights = active.map((c) => (c.t.estimate ?? 240) * (c.t.priority === "urgent" ? 1.6 : c.t.priority === "high" ? 1.3 : 1));
      const total = weights.reduce((a, b) => a + b, 0);
      const pieces = Math.min(active.length, 1 + Math.floor(rand() * 4));
      for (let p = 0; p < pieces; p += 1) {
        let r = rand() * total;
        let pick = 0;
        while (r > weights[pick] && pick < active.length - 1) {
          r -= weights[pick];
          pick += 1;
        }
        const c = active[pick];
        const assignees = c.t.assignees!;
        const who = assignees[Math.floor(rand() * assignees.length)];
        let minutes = Math.round((minutesToday / pieces) / 15) * 15;
        minutes = Math.max(15, Math.min(minutes, 360));
        const cat: Discipline =
          c.t.type === "qa" && who === "nina"
            ? "qa"
            : (c.t.tags ?? []).some((tag) => ["seo", "content", "copy"].includes(tag)) && who !== "maja"
              ? "content_seo"
              : CATEGORY_BY_PERSON[who];
        const billable = (c.t.billable ?? true) && c.t.type !== "qa" && c.t.type !== "improvement";
        const key = `${c.ref}|${who}|${date}`;
        const existing = merged.get(key);
        if (existing) {
          existing.minutes = Math.min(existing.minutes + minutes, 480);
          continue;
        }
        const notes = ENTRY_NOTES[cat];
        merged.set(key, {
          task_id: taskIds[c.ref],
          user_id: people[who],
          minutes,
          billable,
          note: rand() < 0.55 ? notes[Math.floor(rand() * notes.length)] : null,
          entry_date: date,
          work_category: cat,
          created_at: at(d, 17, Math.floor(rand() * 59)),
        });
      }
    }
  }
  return [...merged.values()];
}

export { STATUS_CATEGORY };
