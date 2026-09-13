// Read-side for F012's `client_deliverables` (missions/20260903-portal,
// M3 — Your list, scope, decisions). Same posture as `lib/queries/portal.ts`
// itself (see that file's header comment): this uses the ordinary
// RLS-respecting server client, never the admin client, so the query is
// written as if nothing were hidden and the database does the hiding —
// `client_deliverables_select_client` (20260926010000) already restricts a
// client caller to portal-enabled projects they are a member of.

import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PortalQueryResult } from "@/lib/queries/portal";
import { formatDayMonthUTC } from "@/lib/format";

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

// F016h (missions/20260903-portal, M3 remediation, AS-003): the ONE
// predicate deciding "is this deliverable past due" for both the sidebar
// badge (SQL, below) and the Your list view's `classifyBucket`
// (app/(portal)/.../your-list/page.tsx, which imports this). F016e's
// comment here claimed the two were already unified while the view kept
// its own, independently-written condition that routed `delivered` to
// `"progress"` regardless of due date — disagreeing with this query,
// which (correctly, per AS-003's own wording, "deliverables that are
// past their due date", no state carve-out beyond accepted/waived)
// counts a past-due `delivered` row. `isDeliverablePastDue` is that
// shared condition, written once; `classifyBucket` in the view calls it
// instead of re-deriving its own past-due test from `state`/`dueAt`.
export function isDeliverablePastDue(
  state: DeliverableState,
  dueAt: string | null,
  today: string,
): boolean {
  return state !== "accepted" && state !== "waived" && dueAt !== null && dueAt < today;
}

// F016e (missions/20260903-portal, M3-scrutiny defect 1, AS-003): the
// count `getPortalBadgeCounts` (lib/queries/portal.ts) folds into
// `deliverablesPastDue`. AS-003's own wording is "deliverables that are
// past their due date" — no `blocking` qualifier — and the Your list
// view's "blocked" bucket (app/(portal)/.../your-list/page.tsx's
// `classifyBucket`) already counts every outstanding, past-due
// deliverable regardless of `blocking`. This used to additionally filter
// `.eq("blocking", true)`, so the sidebar badge and the page it links to
// reported two different numbers for the same project.
//
// F016k (M3 remediation round 2): this used to RE-EXPRESS
// `isDeliverablePastDue`'s condition as three PostgREST filters
// (`.not("state", "in", ...)`, `.not("due_at", "is", null)`,
// `.lt("due_at", today)`) instead of calling the shared function itself
// — a second, independently-typed copy of the same predicate that could
// drift from `isDeliverablePastDue` (and from `classifyBucket`, which
// calls it) without either surface's own test noticing, because neither
// test exercised the OTHER surface's real code. This now fetches the
// bare columns the predicate needs and calls `isDeliverablePastDue`
// itself, once, in TypeScript — the badge is no longer a second
// implementation of "is this deliverable past due", it is a caller of
// the one that exists.
export async function getDeliverablesPastDueCount(
  projectId: string,
): Promise<PortalQueryResult<number>> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("client_deliverables")
    .select("state, due_at")
    .eq("project_id", projectId);

  if (error) {
    logger.error("getDeliverablesPastDueCount: failed to load count", { error });
    return { ok: false, error: error.message };
  }

  const count = (data ?? []).filter((row) =>
    isDeliverablePastDue(row.state as DeliverableState, row.due_at, today),
  ).length;

  return { ok: true, data: count };
}

// --- "What it holds up" (F014, missions/20260903-portal, AS-029, AS-031) --
//
// The portal's Your list view and the overview's risk banner both need
// the SAME derived sentence — "what does this deliverable's linked task
// depend on it for" — never a field the PM types (this feature's own
// spec, verbatim: "Derive it — never ask the PM to type it"). Both
// callers share this one derivation so the row's short label ("Holds up
// build of /blogg") and the risk banner's full sentence ("The Blogg page
// cannot be built without its copy...") can never independently drift
// on what a given task "counts as".
//
// Reads through the admin client, same reasoning as `getPortalLiveNow`
// (lib/queries/portal.ts): a deliverable's linked task is not
// necessarily one the client's own RLS-scoped session can read (an
// internal task can still block a client-visible outcome), so this is a
// DISPLAY lookup layered on top of a row the caller already reached
// through `client_deliverables`' own client SELECT policy — never a
// second, independent grant of task/phase visibility. Exactly like that
// function, a task's own title (and, here, its page slug) is only ever
// used when `client_visible` is true; the fallback is the task's PHASE
// name (also gated on the phase's own `client_visible`, same predicate
// `getProjectPhases`/`getPortalLiveNow` already apply) — never an
// internal task's title leaking through a "holds up" label.
//
// F016c (M3-scrutiny.md B1): both admin reads below are scoped to
// `projectId` — the deliverable's own project, supplied by every caller
// — on top of the composite FK (20260930020000) that now makes a
// cross-project `task_id`/`phase_id` unrepresentable at write time. This
// function no longer merely ASSUMES the invariant this comment used to
// assert; it enforces it independently, so a row that somehow slipped
// past the constraint (e.g. a future migration that relaxes it) still
// cannot leak another workspace's task title or phase name into this
// project's portal.
export type DeliverableHoldsUp = {
  /** `null` when there is nothing safe/known to derive (no linked task,
   * a deleted task, or a task with neither a client-visible page/title
   * nor a client-visible phase) — the row simply omits the "holds up"
   * line rather than fabricating one. */
  label: string | null;
  kind: "page" | "task" | "phase" | "none";
  value: string | null;
};

const NO_HOLDS_UP: DeliverableHoldsUp = { label: null, kind: "none", value: null };

async function resolveHoldsUpContext(
  projectId: string,
  taskIds: string[],
): Promise<Map<string, DeliverableHoldsUp>> {
  const result = new Map<string, DeliverableHoldsUp>();
  if (taskIds.length === 0) return result;

  const admin = createAdminClient();

  const { data: tasks, error } = await admin
    .from("tasks")
    .select("id, title, page_slug, client_visible, phase_id, deleted_at")
    .eq("project_id", projectId)
    .in("id", taskIds);

  if (error) {
    logger.error("resolveHoldsUpContext: failed to load linked tasks", { error });
    return result;
  }

  const phaseIds = [
    ...new Set(
      (tasks ?? [])
        .map((task) => task.phase_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const { data: phases } =
    phaseIds.length > 0
      ? await admin
          .from("project_phases")
          .select("id, name")
          .eq("project_id", projectId)
          .eq("client_visible", true)
          .in("id", phaseIds)
      : { data: [] as { id: string; name: string }[] };

  const phaseNameById = new Map((phases ?? []).map((phase) => [phase.id, phase.name]));

  for (const task of tasks ?? []) {
    if (task.deleted_at) {
      result.set(task.id, NO_HOLDS_UP);
      continue;
    }

    if (task.client_visible && task.page_slug) {
      result.set(task.id, {
        label: `Holds up build of /${task.page_slug}`,
        kind: "page",
        value: task.page_slug,
      });
      continue;
    }

    if (task.client_visible && task.title) {
      result.set(task.id, {
        label: `Holds up ${task.title}`,
        kind: "task",
        value: task.title,
      });
      continue;
    }

    const phaseName = task.phase_id ? phaseNameById.get(task.phase_id) : undefined;
    if (phaseName) {
      result.set(task.id, {
        label: `Holds up ${phaseName}`,
        kind: "phase",
        value: phaseName,
      });
      continue;
    }

    result.set(task.id, NO_HOLDS_UP);
  }

  return result;
}

export type PortalDeliverable = ClientDeliverable & { holdsUp: DeliverableHoldsUp };

// AS-029/AS-030: every deliverable on this project, RLS-scoped exactly
// like `getClientDeliverables`, each carrying its own derived "holds up"
// label for the Your list view's row.
export async function getClientDeliverablesForPortal(
  projectId: string,
): Promise<PortalQueryResult<PortalDeliverable[]>> {
  const base = await getClientDeliverables(projectId);
  if (!base.ok) return base;

  const taskIds = [
    ...new Set(base.data.map((d) => d.taskId).filter((id): id is string => Boolean(id))),
  ];
  const holdsUpByTaskId = await resolveHoldsUpContext(projectId, taskIds);

  return {
    ok: true,
    data: base.data.map((deliverable) => ({
      ...deliverable,
      holdsUp: deliverable.taskId
        ? holdsUpByTaskId.get(deliverable.taskId) ?? NO_HOLDS_UP
        : NO_HOLDS_UP,
    })),
  };
}

// Plain word-cap-first formatting for a page slug ("blogg" -> "Blogg"),
// used only by the risk sentence below — the row's own short label above
// keeps the raw "/slug" form instead (this feature's own literal example:
// "Holds up build of /blogg").
function titleCaseSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function subjectFromHoldsUp(holdsUp: DeliverableHoldsUp): string {
  if (holdsUp.kind === "page" && holdsUp.value) {
    return `The ${titleCaseSlug(holdsUp.value)} page`;
  }
  if (holdsUp.kind === "phase" && holdsUp.value) {
    return `The ${holdsUp.value} phase`;
  }
  if (holdsUp.kind === "task" && holdsUp.value) {
    return `"${holdsUp.value}"`;
  }
  return "This item";
}

// "cannot be built without X" phrasing per deliverable kind — read
// alongside `deliverableKindSchema` (lib/validation/deliverables.ts),
// the closed vocabulary this switches over.
const KIND_NEED_PHRASE: Record<DeliverableKind, string> = {
  copy: "its copy",
  image: "its images",
  access: "access to it",
  decision: "a decision",
  data: "its data",
  other: "the outstanding item",
};

// AS-031: the risk banner's own sentence — "The Blogg page cannot be
// built without its copy, and 18 Nov moves with it." Plain and specific,
// never blaming: names the worst overdue blocking item and what it
// moves, nothing else (this feature's own spec, verbatim).
export function formatDeliverableRiskMessage(params: {
  kind: DeliverableKind;
  holdsUp: DeliverableHoldsUp;
  targetLaunchDate: string | null;
}): string {
  const subject = subjectFromHoldsUp(params.holdsUp);
  const need = KIND_NEED_PHRASE[params.kind];

  if (params.targetLaunchDate) {
    return `${subject} cannot be built without ${need}, and ${formatDayMonthUTC(params.targetLaunchDate)} moves with it.`;
  }

  return `${subject} cannot be built without ${need}, and the launch date moves with it.`;
}

// F085 (missions/20260903-portal audit, defect 5): the risk banner used
// to render only `message` -- naming what the item holds up, but never
// the item's own name, its due date, or anywhere to act on it. `itemName`
// and `dueAt` are the same deliverable row the message is already built
// from (never a second lookup); `Your list` (the Your list view,
// app/(portal)/.../your-list/page.tsx) is where a client actually acts on
// an outstanding deliverable, so that is the one place `RiskBanner`
// links to -- `href` is built by the caller (the Overview page, which
// already has the workspace slug the query below does not) rather than
// hard-coded here.
export type DeliverableRisk = {
  id: string;
  message: string;
  itemName: string;
  dueAt: string;
};

// AS-031: the single worst (earliest-due, i.e. most overdue) blocking,
// undelivered deliverable on this project, or `null` when nothing
// qualifies — `getPortalRisks` (lib/queries/portal.ts) renders nothing
// at all in that case (its own doc comment: "must not render a
// placeholder"). Shares its filter with
// `getOverdueBlockingDeliverableCount` above (blocking, not yet
// accepted/waived, has a due date, past due) so the banner and the
// sidebar badge always agree on what counts as "at risk".
export async function getWorstOverdueBlockingDeliverableRisk(
  projectId: string,
): Promise<DeliverableRisk | null> {
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: project }, { data: rows, error }] = await Promise.all([
    admin.from("projects").select("target_launch_date").eq("id", projectId).maybeSingle(),
    admin
      .from("client_deliverables")
      .select("id, title, kind, due_at, task_id")
      .eq("project_id", projectId)
      .eq("blocking", true)
      .not("state", "in", "(accepted,waived)")
      .not("due_at", "is", null)
      .lt("due_at", today)
      .order("due_at", { ascending: true })
      .limit(1),
  ]);

  if (error) {
    logger.error("getWorstOverdueBlockingDeliverableRisk: failed to load worst deliverable", {
      error,
    });
    return null;
  }

  const worst = rows?.[0];
  if (!worst) return null;

  const holdsUpByTaskId = worst.task_id
    ? await resolveHoldsUpContext(projectId, [worst.task_id])
    : new Map<string, DeliverableHoldsUp>();
  const holdsUp = (worst.task_id && holdsUpByTaskId.get(worst.task_id)) || NO_HOLDS_UP;

  return {
    id: worst.id,
    message: formatDeliverableRiskMessage({
      kind: worst.kind as DeliverableKind,
      holdsUp,
      targetLaunchDate: project?.target_launch_date ?? null,
    }),
    itemName: worst.title,
    // `due_at` is non-null here by construction (`.not("due_at", "is",
    // null)` above), so this cast is safe -- narrower than the shared
    // `ClientDeliverable.dueAt` type only because this row is one that
    // already passed that filter.
    dueAt: worst.due_at as string,
  };
}
