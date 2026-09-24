"use server";

// F020 (missions/20260903-portal): team-side CRUD for `project_metrics`,
// `metric_snapshots`, `project_improvements`, and the one-way "freeze
// baseline" flip on `projects.baseline_frozen_at` (AS-039, AS-040,
// AS-041). Mirrors lib/actions/deliverables.ts's shape exactly — same
// withAuthz pipeline, same default `canWrite` gate, same `ctx.admin`
// write path with RLS as the backstop
// (`project_metrics_insert_team`/`_update_team`/`_delete_team`,
// `project_improvements_*`, all `20261013010000`, gated on
// `is_project_workspace_writer`).
//
// AS-040's actual enforcement point is NOT this file: it is the database
// trigger `prevent_frozen_baseline_update` (same migration). A direct
// `.update()` on `project_metrics.baseline_value`/`baseline_at` from
// anywhere — this file, a future RPC, a stray script running as an
// authenticated team member — is rejected by the trigger once
// `baseline_frozen_at` is set, regardless of what this action's own
// input validation does. This file's `updateMetric` still forwards
// whatever the caller sent for those two fields (rather than special-
// casing "when frozen, silently drop these two keys") so the trigger's
// 42501 surfaces as a real, visible error the UI can show, instead of a
// silent no-op that would look like success.

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { logger } from "@/lib/observability/logger";
import { type ActionOutcome, type ActionResult, withAuthz } from "@/lib/actions/authz";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwnedObjectPath, signOwnedObject, storageOwnerPrefix } from "@/lib/storage/sign-owned-object";
import { getCurrentUser } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/activity/audit";
import {
  createMetricSchema,
  updateMetricSchema,
  reorderMetricSchema,
  deleteMetricSchema,
  createSnapshotSchema,
  deleteSnapshotSchema,
  freezeBaselineSchema,
  createImprovementSchema,
  updateImprovementSchema,
  reorderImprovementSchema,
  deleteImprovementSchema,
} from "@/lib/validation/metrics";
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENT_SIZE_BYTES,
} from "@/lib/validation/attachments";
import { uploadImprovementImageSchema } from "@/lib/validation/metrics";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { isProjectVisibleToCaller } from "@/lib/actions/project-visibility";
import { isClient } from "@/lib/auth/permissions";
import { revalidatePortalProject } from "@/lib/actions/portal-revalidate";
import type { ProjectVisibility } from "@/lib/actions/project-visibility";
import type {
  MetricDirection,
  MetricSnapshot,
  MetricSource,
  ProjectImprovement,
  ProjectMetric,
} from "@/lib/queries/metrics";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";
const IMPROVEMENTS_BUCKET = "task-attachments";

type AdminClient = ReturnType<typeof createAdminClient>;

function toMetricData(row: {
  id: string;
  project_id: string;
  name: string;
  unit: string | null;
  source: string;
  baseline_value: number | string | null;
  baseline_at: string | null;
  target_value: number | string | null;
  direction: string;
  display_max: number | string | null;
  client_visible: boolean;
  position: number;
}): ProjectMetric {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    unit: row.unit,
    source: row.source as MetricSource,
    baselineValue: row.baseline_value === null ? null : Number(row.baseline_value),
    baselineAt: row.baseline_at,
    targetValue: row.target_value === null ? null : Number(row.target_value),
    direction: row.direction as MetricDirection,
    displayMax: row.display_max === null ? null : Number(row.display_max),
    clientVisible: row.client_visible,
    position: row.position,
  };
}

const METRIC_COLUMNS =
  "id, project_id, name, unit, source, baseline_value, baseline_at, target_value, direction, display_max, client_visible, position";

type ProjectExtra = { projectId: string; workspaceSlug: string };

async function loadProjectExtra(
  admin: AdminClient,
  projectId: string,
): Promise<
  | { ok: true; workspaceId: string; projectId: string; visibility: ProjectVisibility; extra: ProjectExtra }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("projects")
    .select("id, workspace_id, visibility, deleted_at, baseline_frozen_at, workspaces(slug)")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !data || data.deleted_at) {
    return { ok: false, error: "Project not found." };
  }

  const workspace = data.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;
  if (!workspaceSlug) {
    return { ok: false, error: "Project not found." };
  }

  return {
    ok: true,
    workspaceId: data.workspace_id,
    projectId: data.id,
    visibility: data.visibility === "private" ? "private" : "workspace",
    extra: { projectId: data.id, workspaceSlug },
  };
}

type MetricExtra = ProjectExtra & { metricName: string };

async function loadMetricExtra(
  admin: AdminClient,
  metricId: string,
): Promise<
  | { ok: true; workspaceId: string; projectId: string; visibility: ProjectVisibility; extra: MetricExtra }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("project_metrics")
    .select(
      "id, project_id, name, projects!inner(id, workspace_id, visibility, deleted_at, workspaces(slug))",
    )
    .eq("id", metricId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Metric not found." };
  }

  const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
  if (!project?.workspace_id || project.deleted_at) {
    return { ok: false, error: "Metric not found." };
  }

  const workspace = project.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;
  if (!workspaceSlug) {
    return { ok: false, error: "Metric not found." };
  }

  return {
    ok: true,
    workspaceId: project.workspace_id,
    projectId: project.id,
    visibility: project.visibility === "private" ? "private" : "workspace",
    extra: { projectId: project.id, workspaceSlug, metricName: data.name },
  };
}

async function revalidateMeasurementSettings(workspaceSlug: string, projectId: string) {
  try {
    revalidatePath(`/w/${workspaceSlug}/projects/${projectId}/settings/measurement`, "page");
    revalidatePortalProject(workspaceSlug, projectId);
  } catch (revalidateError) {
    logger.error("metrics: revalidatePath failed (non-fatal)", { error: revalidateError });
  }
}

// ---------------------------------------------------------------------
// createMetric
// ---------------------------------------------------------------------

export type MetricActionResult = ActionResult<ProjectMetric>;

const createMetricImpl = withAuthz(
  createMetricSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's metrics.",
    writeError: "Viewers don't have permission to manage metrics.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's metrics.",
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<MetricActionResult> => {
    const metrics = ctx.admin.from("project_metrics");

    const { data: lastMetric } = await metrics
      .select("position")
      .eq("project_id", ctx.projectId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const newPosition = ((lastMetric as { position: number } | null)?.position ?? 0) + 1;

    const { data: inserted, error: insertError } = await ctx.admin
      .from("project_metrics")
      .insert({
        project_id: ctx.projectId,
        name: input.name,
        unit: input.unit ?? null,
        source: input.source,
        baseline_value: input.baselineValue ?? null,
        baseline_at: input.baselineAt ?? null,
        target_value: input.targetValue ?? null,
        direction: input.direction,
        display_max: input.displayMax ?? null,
        position: newPosition,
      })
      .select(METRIC_COLUMNS)
      .single();

    if (insertError || !inserted) {
      logger.error("createMetric: insert failed", { error: insertError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_metric.created",
      targetType: "project_metric",
      targetId: inserted.id,
      metadata: { projectId: ctx.projectId, name: inserted.name },
    });

    await revalidateMeasurementSettings(ctx.workspaceSlug, ctx.projectId);

    return { ok: true, data: toMetricData(inserted) };
  },
);

export async function createMetric(input: {
  projectId: string;
  name: string;
  unit?: string | null;
  source: MetricSource;
  baselineValue?: number | null;
  baselineAt?: string | null;
  targetValue?: number | null;
  direction: MetricDirection;
  displayMax?: number | null;
}): Promise<MetricActionResult> {
  return createMetricImpl(input);
}

// ---------------------------------------------------------------------
// updateMetric — AS-040's visible failure mode: an update touching a
// frozen baseline is rejected by the database trigger, not silently
// dropped here.
// ---------------------------------------------------------------------

const updateMetricImpl = withAuthz(
  updateMetricSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's metrics.",
    writeError: "Viewers don't have permission to manage metrics.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's metrics.",
    resolveWorkspace: (input, admin) => loadMetricExtra(admin, input.metricId),
  },
  async (input, ctx): Promise<MetricActionResult> => {
    const { data: updated, error: updateError } = await ctx.admin
      .from("project_metrics")
      .update({
        name: input.name,
        unit: input.unit,
        source: input.source,
        baseline_value: input.baselineValue,
        baseline_at: input.baselineAt,
        target_value: input.targetValue,
        direction: input.direction,
        display_max: input.displayMax,
        client_visible: input.clientVisible,
      })
      .eq("id", input.metricId)
      .select(METRIC_COLUMNS)
      .single();

    if (updateError || !updated) {
      logger.error("updateMetric: update failed", { error: updateError });
      // 42501 is the trigger's own errcode (prevent_frozen_baseline_update)
      // — surfaced as a specific, honest message rather than the generic
      // one, so the UI can tell the PM why, not just that it failed.
      const isFrozenBaselineRejection =
        (updateError as { code?: string } | null)?.code === "42501" ||
        String(updateError?.message ?? "").includes("baseline is frozen");
      return {
        ok: false,
        error: isFrozenBaselineRejection
          ? "This project's baseline is frozen — the baseline value and date can no longer be changed. Record a new measurement as a snapshot instead."
          : GENERIC_ERROR,
      };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_metric.updated",
      targetType: "project_metric",
      targetId: updated.id,
      metadata: { projectId: ctx.projectId, previousName: ctx.metricName, name: updated.name },
    });

    await revalidateMeasurementSettings(ctx.workspaceSlug, ctx.projectId);

    return { ok: true, data: toMetricData(updated) };
  },
);

export async function updateMetric(input: {
  metricId: string;
  name: string;
  unit: string | null;
  source: MetricSource;
  baselineValue: number | null;
  baselineAt: string | null;
  targetValue: number | null;
  direction: MetricDirection;
  displayMax: number | null;
  clientVisible: boolean;
}): Promise<MetricActionResult> {
  return updateMetricImpl(input);
}

// ---------------------------------------------------------------------
// deleteMetric
// ---------------------------------------------------------------------

export type DeleteMetricResult =
  // F090 item 5: `restore` is the pre-delete metric row. NOTE: this
  // metric's own `metric_snapshots` rows are cascade-deleted by the FK
  // (`on delete cascade`, per lib/queries/metrics.ts) the instant the
  // metric itself is deleted -- restoreMetric below brings the metric
  // definition back, but NOT its snapshot history, which is a real,
  // documented limitation of reinsert-on-undo for a parent row with
  // cascading children (see this feature's handoff for why full
  // snapshot-preserving undo is out of scope here).
  | { ok: true; data: { id: string; restore: ProjectMetric } }
  | { ok: false; error: string };

const deleteMetricImpl = withAuthz(
  deleteMetricSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's metrics.",
    writeError: "Viewers don't have permission to manage metrics.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's metrics.",
    resolveWorkspace: (input, admin) => loadMetricExtra(admin, input.metricId),
  },
  async (input, ctx): Promise<DeleteMetricResult> => {
    const { data: existing, error: readError } = await ctx.admin
      .from("project_metrics")
      .select(METRIC_COLUMNS)
      .eq("id", input.metricId)
      .maybeSingle();

    if (readError || !existing) {
      logger.error("deleteMetric: pre-delete read failed", { error: readError });
      return { ok: false, error: GENERIC_ERROR };
    }

    const { error: deleteError } = await ctx.admin
      .from("project_metrics")
      .delete()
      .eq("id", input.metricId);

    if (deleteError) {
      logger.error("deleteMetric: delete failed", { error: deleteError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_metric.deleted",
      targetType: "project_metric",
      targetId: input.metricId,
      metadata: { projectId: ctx.projectId, name: ctx.metricName },
    });

    await revalidateMeasurementSettings(ctx.workspaceSlug, ctx.projectId);

    return { ok: true, data: { id: input.metricId, restore: toMetricData(existing) } };
  },
);

export async function deleteMetric(metricId: string): Promise<DeleteMetricResult> {
  return deleteMetricImpl({ metricId });
}

// F090 item 5: restoreMetric — undo for the hard delete above (metric
// definition only; see DeleteMetricResult's own comment on snapshots).
const restoreMetricSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  id: z.string().uuid("Invalid metric."),
  name: z.string().min(1),
  unit: z.string().nullable(),
  source: z.string(),
  baselineValue: z.number().nullable(),
  baselineAt: z.string().nullable(),
  targetValue: z.number().nullable(),
  direction: z.string(),
  displayMax: z.number().nullable(),
  clientVisible: z.boolean(),
  position: z.number(),
});

const restoreMetricImpl = withAuthz(
  restoreMetricSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's metrics.",
    writeError: "Viewers don't have permission to manage metrics.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's metrics.",
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<MetricActionResult> => {
    const { data, error } = await ctx.admin
      .from("project_metrics")
      .insert({
        id: input.id,
        project_id: ctx.projectId,
        name: input.name,
        unit: input.unit,
        source: input.source,
        baseline_value: input.baselineValue,
        baseline_at: input.baselineAt,
        target_value: input.targetValue,
        direction: input.direction,
        display_max: input.displayMax,
        client_visible: input.clientVisible,
        position: input.position,
      })
      .select(METRIC_COLUMNS)
      .single();

    if (error || !data) {
      logger.error("restoreMetric: insert failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_metric.restored",
      targetType: "project_metric",
      targetId: input.id,
      metadata: { projectId: ctx.projectId, name: input.name },
    });

    await revalidateMeasurementSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: toMetricData(data) };
  },
);

export async function restoreMetric(input: {
  projectId: string;
  id: string;
  name: string;
  unit: string | null;
  source: MetricSource;
  baselineValue: number | null;
  baselineAt: string | null;
  targetValue: number | null;
  direction: MetricDirection;
  displayMax: number | null;
  clientVisible: boolean;
  position: number;
}): Promise<MetricActionResult> {
  return restoreMetricImpl(input);
}

// ---------------------------------------------------------------------
// reorderMetrics — same plain-integer swap as reorderDeliverables.
// ---------------------------------------------------------------------

export type ReorderMetricResult = ActionResult<{ moved: { id: string; position: number }; swappedWith: { id: string; position: number } | null }>;

const reorderMetricImpl = withAuthz(
  reorderMetricSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's metrics.",
    writeError: "Viewers don't have permission to manage metrics.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's metrics.",
    resolveWorkspace: (input, admin) => loadMetricExtra(admin, input.metricId),
  },
  async (input, ctx): Promise<ReorderMetricResult> => {
    const { data, error: siblingsError } = await ctx.admin
      .from("project_metrics")
      .select("id, position")
      .eq("project_id", ctx.projectId)
      .order("position", { ascending: true });

    const siblings = data as { id: string; position: number }[] | null;
    if (siblingsError || !siblings) {
      logger.error("reorderMetrics: failed to load siblings", { error: siblingsError });
      return { ok: false, error: GENERIC_ERROR };
    }

    const index = siblings.findIndex((metric) => metric.id === input.metricId);
    if (index === -1) return { ok: false, error: "Metric not found." };

    const neighborIndex = input.direction === "up" ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= siblings.length) {
      return { ok: true, data: { moved: siblings[index], swappedWith: null } };
    }

    const moved = siblings[index];
    const neighbor = siblings[neighborIndex];

    const [{ error: movedError }, { error: neighborError }] = await Promise.all([
      ctx.admin.from("project_metrics").update({ position: neighbor.position }).eq("id", moved.id),
      ctx.admin.from("project_metrics").update({ position: moved.position }).eq("id", neighbor.id),
    ]);

    if (movedError || neighborError) {
      logger.error("reorderMetrics: swap failed", { error: movedError ?? neighborError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await revalidateMeasurementSettings(ctx.workspaceSlug, ctx.projectId);

    return {
      ok: true,
      data: {
        moved: { id: moved.id, position: neighbor.position },
        swappedWith: { id: neighbor.id, position: moved.position },
      },
    };
  },
);

export async function reorderMetrics(
  metricId: string,
  direction: "up" | "down",
): Promise<ReorderMetricResult> {
  return reorderMetricImpl({ metricId, direction });
}

// ---------------------------------------------------------------------
// createSnapshot — AS-040: "later measurements are recorded as separate
// snapshots" is exactly this action, unconditionally (there is no
// separate "pre-freeze" write path for a measurement — a snapshot is
// always a snapshot, frozen or not).
// ---------------------------------------------------------------------

function toSnapshotData(row: {
  id: string;
  metric_id: string;
  value: number | string;
  measured_at: string;
  note: string | null;
  created_by: string;
  created_at: string;
}): MetricSnapshot {
  return {
    id: row.id,
    metricId: row.metric_id,
    value: Number(row.value),
    measuredAt: row.measured_at,
    note: row.note,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export type SnapshotActionResult = ActionResult<MetricSnapshot>;

const createSnapshotImpl = withAuthz(
  createSnapshotSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's metrics.",
    writeError: "Viewers don't have permission to manage metrics.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's metrics.",
    resolveWorkspace: (input, admin) => loadMetricExtra(admin, input.metricId),
  },
  async (input, ctx): Promise<SnapshotActionResult> => {
    const { data: inserted, error: insertError } = await ctx.admin
      .from("metric_snapshots")
      .insert({
        metric_id: input.metricId,
        value: input.value,
        measured_at: input.measuredAt,
        note: input.note ?? null,
        created_by: ctx.user.id,
      })
      .select("id, metric_id, value, measured_at, note, created_by, created_at")
      .single();

    if (insertError || !inserted) {
      logger.error("createSnapshot: insert failed", { error: insertError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "metric_snapshot.created",
      targetType: "metric_snapshot",
      targetId: inserted.id,
      metadata: { projectId: ctx.projectId, metricId: input.metricId, value: input.value },
    });

    await revalidateMeasurementSettings(ctx.workspaceSlug, ctx.projectId);

    return { ok: true, data: toSnapshotData(inserted) };
  },
);

export async function createSnapshot(input: {
  metricId: string;
  value: number;
  measuredAt: string;
  note?: string | null;
}): Promise<SnapshotActionResult> {
  return createSnapshotImpl(input);
}

// ---------------------------------------------------------------------
// deleteSnapshot — correcting a mis-entered measurement (no UPDATE path
// on metric_snapshots, per that table's own RLS comment: delete + re-add
// keeps the record honestly append-only).
// ---------------------------------------------------------------------

export type DeleteSnapshotResult =
  // F090 item 5: `restore` is the pre-delete snapshot row. Per this
  // feature's own audit, `metric_snapshots` is one of the explicitly
  // named candidates for real soft-delete (a frozen measurement is an
  // audit-trail item) -- this reinsert-on-undo is the pragmatic interim
  // fix, not that larger migration. See this feature's handoff.
  | { ok: true; data: { id: string; restore: MetricSnapshot } }
  | { ok: false; error: string };

type SnapshotExtra = ProjectExtra & { metricId: string };

async function loadSnapshotExtra(
  admin: AdminClient,
  snapshotId: string,
): Promise<
  | { ok: true; workspaceId: string; projectId: string; visibility: ProjectVisibility; extra: SnapshotExtra }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("metric_snapshots")
    .select(
      "id, metric_id, project_metrics!inner(id, project_id, projects!inner(id, workspace_id, visibility, deleted_at, workspaces(slug)))",
    )
    .eq("id", snapshotId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Snapshot not found." };
  }

  const metric = Array.isArray(data.project_metrics) ? data.project_metrics[0] : data.project_metrics;
  const project = metric ? (Array.isArray(metric.projects) ? metric.projects[0] : metric.projects) : null;
  if (!project?.workspace_id || project.deleted_at) {
    return { ok: false, error: "Snapshot not found." };
  }

  const workspace = project.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;
  if (!workspaceSlug) {
    return { ok: false, error: "Snapshot not found." };
  }

  return {
    ok: true,
    workspaceId: project.workspace_id,
    projectId: project.id,
    visibility: project.visibility === "private" ? "private" : "workspace",
    extra: { projectId: project.id, workspaceSlug, metricId: data.metric_id },
  };
}

const deleteSnapshotImpl = withAuthz(
  deleteSnapshotSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's metrics.",
    writeError: "Viewers don't have permission to manage metrics.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's metrics.",
    resolveWorkspace: (input, admin) => loadSnapshotExtra(admin, input.snapshotId),
  },
  async (input, ctx): Promise<DeleteSnapshotResult> => {
    const { data: existing, error: readError } = await ctx.admin
      .from("metric_snapshots")
      .select("id, metric_id, value, measured_at, note, created_by, created_at")
      .eq("id", input.snapshotId)
      .maybeSingle();

    if (readError || !existing) {
      logger.error("deleteSnapshot: pre-delete read failed", { error: readError });
      return { ok: false, error: GENERIC_ERROR };
    }

    const { error: deleteError } = await ctx.admin
      .from("metric_snapshots")
      .delete()
      .eq("id", input.snapshotId);

    if (deleteError) {
      logger.error("deleteSnapshot: delete failed", { error: deleteError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await revalidateMeasurementSettings(ctx.workspaceSlug, ctx.projectId);

    return { ok: true, data: { id: input.snapshotId, restore: toSnapshotData(existing) } };
  },
);

export async function deleteSnapshot(snapshotId: string): Promise<DeleteSnapshotResult> {
  return deleteSnapshotImpl({ snapshotId });
}

// F090 item 5: restoreSnapshot — undo for the hard delete above.
const restoreSnapshotSchema = z.object({
  metricId: z.string().uuid("Invalid metric."),
  id: z.string().uuid("Invalid snapshot."),
  value: z.number(),
  measuredAt: z.string(),
  note: z.string().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
});

const restoreSnapshotImpl = withAuthz(
  restoreSnapshotSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's metrics.",
    writeError: "Viewers don't have permission to manage metrics.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's metrics.",
    resolveWorkspace: (input, admin) => loadMetricExtra(admin, input.metricId),
  },
  async (input, ctx): Promise<SnapshotActionResult> => {
    const { data, error } = await ctx.admin
      .from("metric_snapshots")
      .insert({
        id: input.id,
        metric_id: input.metricId,
        value: input.value,
        measured_at: input.measuredAt,
        note: input.note,
        created_by: input.createdBy,
        created_at: input.createdAt,
      })
      .select("id, metric_id, value, measured_at, note, created_by, created_at")
      .single();

    if (error || !data) {
      logger.error("restoreSnapshot: insert failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await revalidateMeasurementSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: toSnapshotData(data) };
  },
);

export async function restoreSnapshot(input: {
  metricId: string;
  id: string;
  value: number;
  measuredAt: string;
  note: string | null;
  createdBy: string;
  createdAt: string;
}): Promise<SnapshotActionResult> {
  return restoreSnapshotImpl(input);
}

// ---------------------------------------------------------------------
// freezeBaseline — AS-040: a one-way flip. `projects_update_team`'s
// existing RLS (unchanged by this feature) is the enforcement boundary;
// this action never un-sets `baseline_frozen_at` (no "unfreeze" input
// exists anywhere in this file), matching the spec's own "once frozen"
// framing.
// ---------------------------------------------------------------------

export type FreezeBaselineResult = ActionResult<{ projectId: string; baselineFrozenAt: string }>;

const freezeBaselineImpl = withAuthz(
  freezeBaselineSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's metrics.",
    writeError: "Viewers don't have permission to manage metrics.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's metrics.",
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<FreezeBaselineResult> => {
    const { data: updated, error: updateError } = await ctx.admin
      .from("projects")
      .update({ baseline_frozen_at: new Date().toISOString() })
      .eq("id", ctx.projectId)
      .is("baseline_frozen_at", null)
      .select("id, baseline_frozen_at")
      .single();

    if (updateError || !updated) {
      logger.error("freezeBaseline: update failed", { error: updateError });
      return { ok: false, error: "The baseline is already frozen, or the project could not be found." };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project.baseline_frozen",
      targetType: "project",
      targetId: ctx.projectId,
      metadata: { projectId: ctx.projectId },
    });

    await revalidateMeasurementSettings(ctx.workspaceSlug, ctx.projectId);

    return {
      ok: true,
      data: { projectId: updated.id, baselineFrozenAt: updated.baseline_frozen_at as string },
    };
  },
);

export async function freezeBaseline(projectId: string): Promise<FreezeBaselineResult> {
  return freezeBaselineImpl({ projectId });
}

// ---------------------------------------------------------------------
// project_improvements CRUD
// ---------------------------------------------------------------------

function toImprovementData(row: {
  id: string;
  project_id: string;
  area: string;
  explanation: string;
  before_path: string | null;
  after_path: string | null;
  position: number;
  client_visible: boolean;
}): ProjectImprovement {
  return {
    id: row.id,
    projectId: row.project_id,
    area: row.area,
    explanation: row.explanation,
    beforePath: row.before_path,
    afterPath: row.after_path,
    position: row.position,
    clientVisible: row.client_visible,
  };
}

const IMPROVEMENT_COLUMNS =
  "id, project_id, area, explanation, before_path, after_path, position, client_visible";

type ImprovementExtra = ProjectExtra & { improvementArea: string };

async function loadImprovementExtra(
  admin: AdminClient,
  improvementId: string,
): Promise<
  | { ok: true; workspaceId: string; projectId: string; visibility: ProjectVisibility; extra: ImprovementExtra }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("project_improvements")
    .select(
      "id, project_id, area, projects!inner(id, workspace_id, visibility, deleted_at, workspaces(slug))",
    )
    .eq("id", improvementId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Improvement not found." };
  }

  const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
  if (!project?.workspace_id || project.deleted_at) {
    return { ok: false, error: "Improvement not found." };
  }

  const workspace = project.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;
  if (!workspaceSlug) {
    return { ok: false, error: "Improvement not found." };
  }

  return {
    ok: true,
    workspaceId: project.workspace_id,
    projectId: project.id,
    visibility: project.visibility === "private" ? "private" : "workspace",
    extra: { projectId: project.id, workspaceSlug, improvementArea: data.area },
  };
}

export type ImprovementActionResult = ActionResult<ProjectImprovement>;

const createImprovementImpl = withAuthz(
  createImprovementSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's improvements.",
    writeError: "Viewers don't have permission to manage improvements.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's improvements.",
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<ImprovementActionResult> => {
    const improvements = ctx.admin.from("project_improvements");

    const { data: last } = await improvements
      .select("position")
      .eq("project_id", ctx.projectId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const newPosition = ((last as { position: number } | null)?.position ?? 0) + 1;

    const { data: inserted, error: insertError } = await ctx.admin
      .from("project_improvements")
      .insert({
        project_id: ctx.projectId,
        area: input.area,
        explanation: input.explanation,
        position: newPosition,
      })
      .select(IMPROVEMENT_COLUMNS)
      .single();

    if (insertError || !inserted) {
      logger.error("createImprovement: insert failed", { error: insertError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_improvement.created",
      targetType: "project_improvement",
      targetId: inserted.id,
      metadata: { projectId: ctx.projectId, area: inserted.area },
    });

    await revalidateMeasurementSettings(ctx.workspaceSlug, ctx.projectId);

    return { ok: true, data: toImprovementData(inserted) };
  },
);

export async function createImprovement(input: {
  projectId: string;
  area: string;
  explanation: string;
}): Promise<ImprovementActionResult> {
  return createImprovementImpl(input);
}

const updateImprovementImpl = withAuthz(
  updateImprovementSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's improvements.",
    writeError: "Viewers don't have permission to manage improvements.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's improvements.",
    resolveWorkspace: (input, admin) => loadImprovementExtra(admin, input.improvementId),
  },
  async (input, ctx): Promise<ImprovementActionResult> => {
    const { data: updated, error: updateError } = await ctx.admin
      .from("project_improvements")
      .update({
        area: input.area,
        explanation: input.explanation,
        client_visible: input.clientVisible,
      })
      .eq("id", input.improvementId)
      .select(IMPROVEMENT_COLUMNS)
      .single();

    if (updateError || !updated) {
      logger.error("updateImprovement: update failed", { error: updateError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_improvement.updated",
      targetType: "project_improvement",
      targetId: updated.id,
      metadata: { projectId: ctx.projectId, previousArea: ctx.improvementArea, area: updated.area },
    });

    await revalidateMeasurementSettings(ctx.workspaceSlug, ctx.projectId);

    return { ok: true, data: toImprovementData(updated) };
  },
);

export async function updateImprovement(input: {
  improvementId: string;
  area: string;
  explanation: string;
  clientVisible: boolean;
}): Promise<ImprovementActionResult> {
  return updateImprovementImpl(input);
}

export type DeleteImprovementResult = ActionResult<{ id: string; restore: ProjectImprovement }>;

const deleteImprovementImpl = withAuthz(
  deleteImprovementSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's improvements.",
    writeError: "Viewers don't have permission to manage improvements.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's improvements.",
    resolveWorkspace: (input, admin) => loadImprovementExtra(admin, input.improvementId),
  },
  async (input, ctx): Promise<DeleteImprovementResult> => {
    const { data: existing, error: readError } = await ctx.admin
      .from("project_improvements")
      .select(IMPROVEMENT_COLUMNS)
      .eq("id", input.improvementId)
      .maybeSingle();

    if (readError || !existing) {
      logger.error("deleteImprovement: pre-delete read failed", { error: readError });
      return { ok: false, error: GENERIC_ERROR };
    }

    const { error: deleteError } = await ctx.admin
      .from("project_improvements")
      .delete()
      .eq("id", input.improvementId);

    if (deleteError) {
      logger.error("deleteImprovement: delete failed", { error: deleteError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_improvement.deleted",
      targetType: "project_improvement",
      targetId: input.improvementId,
      metadata: { projectId: ctx.projectId, area: ctx.improvementArea },
    });

    await revalidateMeasurementSettings(ctx.workspaceSlug, ctx.projectId);

    return {
      ok: true,
      data: { id: input.improvementId, restore: toImprovementData(existing) },
    };
  },
);

export async function deleteImprovement(improvementId: string): Promise<DeleteImprovementResult> {
  return deleteImprovementImpl({ improvementId });
}

// F090 item 5: restoreImprovement — undo for the hard delete above. The
// before/after Storage objects themselves are never removed by
// deleteImprovementImpl (only the DB row), so re-inserting the row with
// the same `before_path`/`after_path` is safe -- the files are still
// there. The paths arrive from the client, so each one must sit under this
// project's own improvements folder; anything else is refused outright.
const restoreImprovementSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  id: z.string().uuid("Invalid improvement."),
  area: z.string().min(1),
  explanation: z.string(),
  beforePath: z.string().nullable(),
  afterPath: z.string().nullable(),
  position: z.number(),
  clientVisible: z.boolean(),
});

const restoreImprovementImpl = withAuthz(
  restoreImprovementSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's improvements.",
    writeError: "Viewers don't have permission to manage improvements.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's improvements.",
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<ImprovementActionResult> => {
    const ownerPrefix = storageOwnerPrefix.improvementImage(ctx.projectId);
    const pathsOwned = [input.beforePath, input.afterPath].every(
      (path) => path === null || isOwnedObjectPath(path, ownerPrefix),
    );
    if (!pathsOwned) {
      return { ok: false, error: "Improvement not found." };
    }

    const { data, error } = await ctx.admin
      .from("project_improvements")
      .insert({
        id: input.id,
        project_id: ctx.projectId,
        area: input.area,
        explanation: input.explanation,
        before_path: input.beforePath,
        after_path: input.afterPath,
        position: input.position,
        client_visible: input.clientVisible,
      })
      .select(IMPROVEMENT_COLUMNS)
      .single();

    if (error || !data) {
      logger.error("restoreImprovement: insert failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_improvement.restored",
      targetType: "project_improvement",
      targetId: input.id,
      metadata: { projectId: ctx.projectId, area: input.area },
    });

    await revalidateMeasurementSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: toImprovementData(data) };
  },
);

export async function restoreImprovement(input: {
  projectId: string;
  id: string;
  area: string;
  explanation: string;
  beforePath: string | null;
  afterPath: string | null;
  position: number;
  clientVisible: boolean;
}): Promise<ImprovementActionResult> {
  return restoreImprovementImpl(input);
}

const reorderImprovementImpl = withAuthz(
  reorderImprovementSchema,
  {
    requireWrite: true,
    membershipError: "You don't have permission to manage this project's improvements.",
    writeError: "Viewers don't have permission to manage improvements.",
    requireVisibility: true,
    visibilityError: "You don't have permission to manage this project's improvements.",
    resolveWorkspace: (input, admin) => loadImprovementExtra(admin, input.improvementId),
  },
  async (
    input,
    ctx,
  ): Promise<
    | { ok: true; data: { moved: { id: string; position: number }; swappedWith: { id: string; position: number } | null } }
    | { ok: false; error: string }
  > => {
    const { data, error: siblingsError } = await ctx.admin
      .from("project_improvements")
      .select("id, position")
      .eq("project_id", ctx.projectId)
      .order("position", { ascending: true });

    const siblings = data as { id: string; position: number }[] | null;
    if (siblingsError || !siblings) {
      logger.error("reorderImprovements: failed to load siblings", { error: siblingsError });
      return { ok: false, error: GENERIC_ERROR };
    }

    const index = siblings.findIndex((improvement) => improvement.id === input.improvementId);
    if (index === -1) return { ok: false, error: "Improvement not found." };

    const neighborIndex = input.direction === "up" ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= siblings.length) {
      return { ok: true, data: { moved: siblings[index], swappedWith: null } };
    }

    const moved = siblings[index];
    const neighbor = siblings[neighborIndex];

    const [{ error: movedError }, { error: neighborError }] = await Promise.all([
      ctx.admin.from("project_improvements").update({ position: neighbor.position }).eq("id", moved.id),
      ctx.admin.from("project_improvements").update({ position: moved.position }).eq("id", neighbor.id),
    ]);

    if (movedError || neighborError) {
      logger.error("reorderImprovements: swap failed", { error: movedError ?? neighborError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await revalidateMeasurementSettings(ctx.workspaceSlug, ctx.projectId);

    return {
      ok: true,
      data: {
        moved: { id: moved.id, position: neighbor.position },
        swappedWith: { id: neighbor.id, position: moved.position },
      },
    };
  },
);

export async function reorderImprovements(
  improvementId: string,
  direction: "up" | "down",
) {
  return reorderImprovementImpl({ improvementId, direction });
}

// ---------------------------------------------------------------------
// uploadImprovementImage — reuses the `task-attachments` bucket and its
// own `validateAttachmentFile`-equivalent allow-list/size limit
// (lib/validation/attachments.ts), same as portal-deliverables.ts's own
// upload action, but writes to the `improvements/{project_id}/{...}`
// path this feature's migration establishes (20261013010000) rather than
// the `{task_id}/{...}` one that migration's own bucket already uses for
// task attachments.
// ---------------------------------------------------------------------

export type UploadImprovementImageResult = ActionResult<ProjectImprovement>;

export async function uploadImprovementImage(formData: FormData): Promise<UploadImprovementImageResult> {
  const improvementIdRaw = formData.get("improvementId");
  const sideRaw = formData.get("side");
  const file = formData.get("file");

  const parsed = uploadImprovementImageSchema.safeParse({
    improvementId: improvementIdRaw,
    side: sideRaw,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  if (!(file instanceof File)) {
    return { ok: false, error: "Choose a file to upload." };
  }

  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    return { ok: false, error: "File is too large. Maximum size is 4 MB." };
  }

  if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(file.type as (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number])) {
    return { ok: false, error: "That file type isn't supported." };
  }

  const { user } = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to upload a file." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const extra = await loadImprovementExtra(admin, parsed.data.improvementId);
  if (!extra.ok) {
    return { ok: false, error: extra.error };
  }

  const membership = await import("@/lib/auth/require-membership").then((mod) =>
    mod.requireActiveMembership(admin, extra.workspaceId, user.id),
  );
  if (!membership.ok) {
    return { ok: false, error: "You don't have permission to manage this project's improvements." };
  }
  const { canTeamWrite } = await import("@/lib/auth/permissions");
  if (!canTeamWrite({ role: membership.role })) {
    return { ok: false, error: "You don't have permission to manage improvements." };
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectPath = `${storageOwnerPrefix.improvementImage(extra.projectId)}${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await admin.storage
    .from(IMPROVEMENTS_BUCKET)
    .upload(objectPath, file, { contentType: file.type });

  if (uploadError) {
    logger.error("uploadImprovementImage: storage upload failed", { error: uploadError });
    return { ok: false, error: GENERIC_ERROR };
  }

  const patch =
    parsed.data.side === "before"
      ? { before_path: objectPath }
      : { after_path: objectPath };

  const { data: updated, error: updateError } = await admin
    .from("project_improvements")
    .update(patch)
    .eq("id", parsed.data.improvementId)
    .select(IMPROVEMENT_COLUMNS)
    .single();

  if (updateError || !updated) {
    logger.error("uploadImprovementImage: row update failed", { error: updateError });
    return { ok: false, error: GENERIC_ERROR };
  }

  await revalidateMeasurementSettings(extra.extra.workspaceSlug, extra.projectId);

  return { ok: true, data: toImprovementData(updated) };
}

// ---------------------------------------------------------------------
// getImprovementImageSignedUrl — F021 (AS-042): the portal Results view's
// before/after images read through this, never a persisted URL, for the
// same reason getAttachmentSignedUrl documents on itself: the bucket is
// private and signed URLs expire (SIGNED_URL_TTL_SECONDS, 1h). Mirrors
// getAttachmentSignedUrl's own three-check shape (active membership,
// portal-enabled for a client caller, project-visible-to-caller) rather
// than relying solely on the Storage RLS policy this migration
// (20261013010000) already applies to `improvements/{project_id}/...`
// objects — same "second line, not the only line" convention every
// signed-url action in this codebase follows (see that function's own
// header, and portal-deliverables.ts's identical comment).
//
// Unlike getAttachmentSignedUrl there is no separate `client_visible`
// column to check on the OBJECT itself for a client caller — F020's own
// migration made `project_improvements.client_visible` the single flag
// (no independent one on metric_snapshots/images), so this function
// checks that flag directly rather than a task's.
// ---------------------------------------------------------------------

const SIGNED_URL_TTL_SECONDS = 60 * 60;

export type GetImprovementImageSignedUrlResult = ActionOutcome<{ signedUrl: string }>;

export async function getImprovementImageSignedUrl(
  improvementId: string,
  side: "before" | "after",
): Promise<GetImprovementImageSignedUrlResult> {
  const parsed = uploadImprovementImageSchema.pick({ improvementId: true }).safeParse({
    improvementId,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid improvement." };
  }

  const { user } = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const { data: improvementRow, error: improvementError } = await admin
    .from("project_improvements")
    .select(
      "id, project_id, before_path, after_path, client_visible, projects(workspace_id, visibility, portal_enabled, deleted_at)",
    )
    .eq("id", parsed.data.improvementId)
    .maybeSingle();

  if (improvementError || !improvementRow) {
    return { ok: false, error: "Image not found." };
  }

  const project = improvementRow.projects as
    | { workspace_id: string; visibility: string; portal_enabled: boolean; deleted_at: string | null }
    | { workspace_id: string; visibility: string; portal_enabled: boolean; deleted_at: string | null }[]
    | null;
  const projectRow = Array.isArray(project) ? project[0] : project;
  const workspaceId = projectRow?.workspace_id;

  if (!projectRow || projectRow.deleted_at || !workspaceId) {
    return { ok: false, error: "Image not found." };
  }

  const objectPath = side === "before" ? improvementRow.before_path : improvementRow.after_path;
  if (!objectPath) {
    return { ok: false, error: "Image not found." };
  }

  const membership = await requireActiveMembership(admin, workspaceId, user.id);
  if (!membership.ok) {
    return { ok: false, error: "You don't have permission to view this image." };
  }

  if (isClient({ role: membership.role }) && !improvementRow.client_visible) {
    return { ok: false, error: "Image not found." };
  }

  if (isClient({ role: membership.role }) && !projectRow.portal_enabled) {
    return { ok: false, error: "Image not found." };
  }

  if (
    !(await isProjectVisibleToCaller(
      admin,
      {
        projectId: improvementRow.project_id,
        visibility: (projectRow.visibility as "workspace" | "private") ?? "workspace",
      },
      user.id,
      membership.role,
    ))
  ) {
    return { ok: false, error: "Image not found." };
  }

  const signed = await signOwnedObject(
    admin,
    {
      bucket: IMPROVEMENTS_BUCKET,
      path: objectPath,
      ownerPrefix: storageOwnerPrefix.improvementImage(improvementRow.project_id),
    },
    SIGNED_URL_TTL_SECONDS,
  );

  if (!signed.ok) {
    if (signed.reason === "not_owned") {
      return { ok: false, error: "Image not found." };
    }
    logger.error("getImprovementImageSignedUrl: signed URL generation failed", {
      error: signed.error,
    });
    return { ok: false, error: GENERIC_ERROR };
  }

  return { ok: true, signedUrl: signed.signedUrl };
}
