"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  archiveProjectSchema,
  createProjectSchema,
  editProjectSchema,
  restoreProjectSchema,
} from "@/lib/validation/projects";
import { logger } from "@/lib/observability/logger";
import {
  requireActiveMembership,
  requireWorkspaceAdmin,
} from "@/lib/auth/require-membership";
import { canWrite } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/activity/audit";
import type { Database } from "@/lib/supabase/database.types";

// F142: `projects.archived_by` (supabase/migrations/
// 20260822000000_projects_archived_by.sql) is not yet reflected in the
// generated `Database` type — `supabase gen types typescript` requires the
// same live-schema connectivity that `supabase db push` needs, which
// hung in this worker's sandbox (see this feature's handoff). This local
// type extension lets `archiveProject` write the column via a typed
// variable (structurally assignable, extra property allowed) rather than
// an unsafe `as any`/`as never` cast on the update call itself. Delete
// this once `database.types.ts` is regenerated against the live schema.
type ProjectsUpdateWithArchivedBy =
  Database["public"]["Tables"]["projects"]["Update"] & {
    archived_by?: string | null;
  };

export type CreateProjectResult =
  | {
      ok: true;
      data: {
        id: string;
        workspaceId: string;
        name: string;
        description: string | null;
        startDate: string | null;
        endDate: string | null;
        createdAt: string;
        createdBy: string | null;
      };
    }
  | { ok: false; error: string };

// Creates a project within a workspace (AS-025, AS-026, AS-035, AS-036).
// Pattern mirrors lib/actions/workspaces.ts: Zod-validated input, membership
// re-checked server-side (defense in depth, AS-143), admin client used for
// the actual insert (RLS on `projects` — supabase/migrations/
// 20260818004709_rls_projects.sql — would also allow this same insert for an
// active member; the admin client is used here only because this action has
// already independently re-verified membership itself, consistent with the
// rest of this file's siblings), discriminated-union return, generic
// user-facing errors with details only logged server-side (AS-146).
export async function createProject(
  workspaceId: string,
  name: string,
  description?: string | null,
  startDate?: string | null,
  endDate?: string | null,
): Promise<CreateProjectResult> {
  const parsed = createProjectSchema.safeParse({
    workspaceId,
    name,
    description: description ?? null,
    startDate: startDate ?? null,
    endDate: endDate ?? null,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter valid project details.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to create a project." };
  }

  const admin = createAdminClient();

  // Defense in depth (AS-143): re-check the caller is an active member of
  // this exact workspace, server-side, rather than trusting that the UI
  // only shows the create-project form to members of the active workspace.
  const membership = await requireActiveMembership(
    admin,
    parsed.data.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to create a project in this workspace.",
    };
  }

  // F128 (AS-216, AS-217): viewers are read-only (canWrite deliberately
  // does not exclude guest — see its doc comment in lib/auth/permissions.ts;
  // guest write access is separately scoped by F134's AS-223).
  if (!canWrite({ role: membership.role })) {
    return {
      ok: false,
      error: "Viewers don't have permission to create projects.",
    };
  }

  // AS-036: created_by is set here from the server-verified caller id, never
  // trusted from client input. created_at is left to the column default
  // (supabase/migrations/20260818004413_create_projects.sql sets `default
  // now()`), also never accepted from the client.
  const { data: inserted, error: insertError } = await admin
    .from("projects")
    .insert({
      workspace_id: parsed.data.workspaceId,
      name: parsed.data.name,
      description: parsed.data.description,
      start_date: parsed.data.startDate,
      end_date: parsed.data.endDate,
      created_by: user.id,
    })
    .select("id, workspace_id, name, description, start_date, end_date, created_at, created_by")
    .single();

  if (insertError || !inserted) {
    logger.error("createProject: insert failed", { error: insertError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  await writeAudit(supabase, {
    workspaceId: parsed.data.workspaceId,
    action: "project.created",
    targetType: "project",
    targetId: inserted.id,
    metadata: { name: inserted.name },
  });

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", parsed.data.workspaceId)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}`, "layout");
    } catch (revalidateError) {
      // Same non-fatal cache-freshness rationale as lib/actions/workspaces.ts:
      // revalidatePath throws outside an active request/render context (e.g.
      // this action invoked from a test harness). The insert itself already
      // succeeded, so this is not an action failure.
      logger.error("createProject: revalidatePath failed (non-fatal)", { error: revalidateError });
    }
  }

  return {
    ok: true,
    data: {
      id: inserted.id,
      workspaceId: inserted.workspace_id,
      name: inserted.name,
      description: inserted.description,
      startDate: inserted.start_date,
      endDate: inserted.end_date,
      createdAt: inserted.created_at,
      createdBy: inserted.created_by,
    },
  };
}

export type EditProjectResult =
  | {
      ok: true;
      data: {
        id: string;
        workspaceId: string;
        name: string;
        description: string | null;
        startDate: string | null;
        endDate: string | null;
        updatedAt: string;
      };
    }
  | { ok: false; error: string };

export type EditProjectUpdates = {
  name?: string;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

// Edits a project's name/description/start_date/end_date (AS-029). Any
// active workspace member may edit — no per-project ownership/role
// restriction beyond membership, mirroring the AS-061 "no per-task
// ownership restriction" convention already established for tasks; the
// same principle applies here since AS-029 does not gate this to
// admin/owner (unlike AS-030's archive action, which is role-gated).
//
// updated_at is intentionally never set from application code: the
// `projects_set_updated_at` trigger (supabase/migrations/
// 20260818004413_create_projects.sql, `set_updated_at()`) fires on every
// `before update` and stamps `now()` itself (AS-037). Setting it here too
// would be redundant and would let a client-influenced value race the
// trigger's own `now()` read.
export async function editProject(
  projectId: string,
  workspaceId: string,
  updates: EditProjectUpdates,
): Promise<EditProjectResult> {
  const parsed = editProjectSchema.safeParse(updates);

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter valid project details.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to edit a project." };
  }

  const admin = createAdminClient();

  // Defense in depth (AS-143): re-check the caller is an active member of
  // this exact workspace, server-side, rather than trusting the UI only
  // shows the edit affordance to members of the active workspace.
  const membership = await requireActiveMembership(admin, workspaceId, user.id);

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to edit this project.",
    };
  }

  // F128 (AS-216, AS-217): viewers are read-only (canWrite deliberately
  // does not exclude guest — see its doc comment in lib/auth/permissions.ts;
  // guest write access is separately scoped by F134's AS-223).
  if (!canWrite({ role: membership.role })) {
    return {
      ok: false,
      error: "Viewers don't have permission to edit projects.",
    };
  }

  // Load the current row, scoped to this exact workspace, so (a) a
  // project belonging to a different workspace can never be edited by
  // supplying an arbitrary projectId + a workspace the caller happens to
  // be a member of, and (b) a partial update (e.g. only startDate
  // supplied) can still be checked against the *effective* end date for
  // AS-035's start/end ordering constraint.
  const { data: existing, error: fetchError } = await admin
    .from("projects")
    .select("id, workspace_id, name, description, start_date, end_date, deleted_at")
    .eq("id", projectId)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError || !existing) {
    return { ok: false, error: "Project not found." };
  }

  const nextStartDate =
    parsed.data.startDate !== undefined ? parsed.data.startDate : existing.start_date;
  const nextEndDate =
    parsed.data.endDate !== undefined ? parsed.data.endDate : existing.end_date;

  if (nextStartDate && nextEndDate && nextEndDate < nextStartDate) {
    return {
      ok: false,
      error: "End date cannot be earlier than the start date.",
    };
  }

  const updatePayload: {
    name?: string;
    description?: string | null;
    start_date?: string | null;
    end_date?: string | null;
  } = {};
  if (parsed.data.name !== undefined) updatePayload.name = parsed.data.name;
  if (parsed.data.description !== undefined)
    updatePayload.description = parsed.data.description;
  if (parsed.data.startDate !== undefined)
    updatePayload.start_date = parsed.data.startDate;
  if (parsed.data.endDate !== undefined) updatePayload.end_date = parsed.data.endDate;

  if (Object.keys(updatePayload).length === 0) {
    return { ok: false, error: "No changes to save." };
  }

  const { data: updated, error: updateError } = await admin
    .from("projects")
    .update(updatePayload)
    .eq("id", projectId)
    .eq("workspace_id", workspaceId)
    .select("id, workspace_id, name, description, start_date, end_date, updated_at")
    .single();

  if (updateError || !updated) {
    logger.error("editProject: update failed", { error: updateError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  await writeAudit(supabase, {
    workspaceId,
    action: "project.updated",
    targetType: "project",
    targetId: projectId,
    metadata: { fields: Object.keys(updatePayload) },
  });

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", workspaceId)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}`, "layout");
    } catch (revalidateError) {
      logger.error("editProject: revalidatePath failed (non-fatal)", { error: revalidateError });
    }
  }

  return {
    ok: true,
    data: {
      id: updated.id,
      workspaceId: updated.workspace_id,
      name: updated.name,
      description: updated.description,
      startDate: updated.start_date,
      endDate: updated.end_date,
      updatedAt: updated.updated_at,
    },
  };
}

export type ArchiveProjectResult =
  | {
      ok: true;
      data: {
        id: string;
        workspaceId: string;
        deletedAt: string;
      };
    }
  | { ok: false; error: string };

// Archives (soft-deletes) a project (AS-030, AS-031, AS-032, AS-033).
// Admin/owner-only — deliberately `requireWorkspaceAdmin`, not
// `requireActiveMembership`, since AS-030 says "by an admin or owner" and
// AS-033 says a plain `member` must be rejected server-side even if they
// call this action directly (mirrors deleteWorkspace's
// `requireWorkspaceOwner` pattern in lib/actions/workspaces.ts, one role
// looser here per AS-030's "admin or owner" line).
//
// Sets `deleted_at = now()` rather than deleting the row (same soft-delete
// convention as deleteWorkspace) — AS-031 is satisfied because
// getWorkspaceProjects (lib/queries/projects.ts) already filters
// `deleted_at IS NULL`, and AS-032 is satisfied because nothing else about
// the row (or its would-be tasks once that table exists) is touched: a
// direct by-id query for this same row, unfiltered by deleted_at, still
// returns the full row with all its data intact. There is no project
// detail page yet (lands F030/F031) to wire a "navigate directly" UI
// affordance into — this action only needs to prove the underlying
// data-layer guarantee that archiving doesn't hide/destroy the row from a
// direct-by-id read, which the AS-032 test in
// tests/integration/archive-project.test.ts verifies directly against the
// database.
export async function archiveProject(
  projectId: string,
  workspaceId: string,
): Promise<ArchiveProjectResult> {
  const parsed = archiveProjectSchema.safeParse({ projectId, workspaceId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to archive a project." };
  }

  const admin = createAdminClient();

  // Defense in depth (AS-143 convention, tightened per AS-030/AS-033): the
  // caller must be an active admin or owner of this exact workspace,
  // re-checked server-side — a plain member calling this action directly
  // (bypassing the UI, which only renders the control for admin/owner)
  // must be rejected here, not just hidden client-side.
  const membership = await requireWorkspaceAdmin(
    admin,
    parsed.data.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "Only a workspace admin or owner can archive a project.",
    };
  }

  const { data: existing, error: fetchError } = await admin
    .from("projects")
    .select("id, workspace_id, deleted_at")
    .eq("id", parsed.data.projectId)
    .eq("workspace_id", parsed.data.workspaceId)
    .maybeSingle();

  if (fetchError || !existing) {
    return { ok: false, error: "Project not found." };
  }

  if (existing.deleted_at) {
    return { ok: false, error: "This project is already archived." };
  }

  const archivedAt = new Date().toISOString();

  // F142 (AS-251): also stamp `archived_by` so the archive view can show
  // who archived the project. Feature-detected the same way
  // `getArchivedWorkspaceProjects` (lib/queries/projects.ts) reads it —
  // this worker's sandbox could not confirm the F142 migration
  // (supabase/migrations/20260822000000_projects_archived_by.sql) was
  // applied to the linked project (`supabase db push`/`migration list`
  // both hung, see this feature's handoff), so a "column does not exist"
  // error (42703) here must not break archiving itself (mission-1's
  // AS-030/AS-031/AS-032/AS-033 behaviour, which this action must never
  // regress) — it falls back to the pre-existing `deleted_at`-only
  // update. Once the migration is confirmed live, the `archived_by` write
  // below succeeds and no further code change is needed.
  let updated:
    | { id: string; workspace_id: string; deleted_at: string | null }
    | null = null;
  let updateError: { code?: string; message?: string } | null = null;

  const archivedByUpdate: ProjectsUpdateWithArchivedBy = {
    deleted_at: archivedAt,
    archived_by: user.id,
  };

  const withArchivedBy = await admin
    .from("projects")
    // `archived_by` isn't in the generated `Database` type yet (see the
    // `ProjectsUpdateWithArchivedBy` comment above) — the typed client's
    // update() rejects any excess property at the type level regardless
    // of structural assignability, so this one call site needs the
    // explicit cast; every other query below stays fully typed.
    .update(archivedByUpdate as never)
    .eq("id", parsed.data.projectId)
    .eq("workspace_id", parsed.data.workspaceId)
    .is("deleted_at", null)
    .select("id, workspace_id, deleted_at")
    .single();

  if (
    withArchivedBy.error?.code === "42703" ||
    withArchivedBy.error?.code === "PGRST204"
  ) {
    const withoutArchivedBy = await admin
      .from("projects")
      .update({ deleted_at: archivedAt })
      .eq("id", parsed.data.projectId)
      .eq("workspace_id", parsed.data.workspaceId)
      .is("deleted_at", null)
      .select("id, workspace_id, deleted_at")
      .single();
    updated = withoutArchivedBy.data;
    updateError = withoutArchivedBy.error;
  } else {
    updated = withArchivedBy.data;
    updateError = withArchivedBy.error;
  }

  if (updateError || !updated) {
    logger.error("archiveProject: soft-delete update failed", { error: updateError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  await writeAudit(supabase, {
    workspaceId: parsed.data.workspaceId,
    action: "project.archived",
    targetType: "project",
    targetId: parsed.data.projectId,
  });

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", parsed.data.workspaceId)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}`, "layout");
    } catch (revalidateError) {
      logger.error("archiveProject: revalidatePath failed (non-fatal)", { error: revalidateError });
    }
  }

  return {
    ok: true,
    data: {
      id: updated.id,
      workspaceId: updated.workspace_id,
      deletedAt: updated.deleted_at as string,
    },
  };
}

export type RestoreProjectResult =
  | {
      ok: true;
      data: {
        id: string;
        workspaceId: string;
      };
    }
  | { ok: false; error: string };

// Restores (un-archives) a project (F143: AS-252, AS-253, AS-255) — the
// exact inverse of archiveProject above. Admin/owner-only, same gate as
// archiving (`requireWorkspaceAdmin`, not `requireActiveMembership`) — the
// clarified spec's access-control answer says this is "gated by F127"
// (lib/auth/permissions.ts / the role-check convention this codebase
// already applies), and there is no reason restoring should be less
// protected than the archive action it reverses; AS-253 requires this be
// rejected server-side, not just hidden from a non-admin's UI.
//
// Clears `deleted_at` (and `archived_by`, when the F142 column is live —
// same feature-detection fallback as archiveProject's write, since this
// worker's sandbox could not confirm that migration is applied to the
// linked project either; see this feature's handoff). Restoring never
// touches the `tasks` table: per F029's own soft-delete convention (see
// archiveProject's doc comment and AS-032), archiving only ever set
// `projects.deleted_at` — no task row was ever touched by archiving, so
// none needs to be touched by restoring either. A task that was
// independently soft-deleted (its own `deleted_at`) before the project was
// archived must stay soft-deleted; this action never writes to `tasks` at
// all, so that invariant holds by construction (AS-252's "not resurrect
// independently-soft-deleted tasks").
export async function restoreProject(
  projectId: string,
  workspaceId: string,
): Promise<RestoreProjectResult> {
  const parsed = restoreProjectSchema.safeParse({ projectId, workspaceId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to restore a project." };
  }

  const admin = createAdminClient();

  // Defense in depth (AS-143 convention, tightened per AS-253): the caller
  // must be an active admin or owner of this exact workspace, re-checked
  // server-side — a plain member calling this action directly (bypassing
  // the UI, which only renders the control for admin/owner) must be
  // rejected here, not just hidden client-side.
  const membership = await requireWorkspaceAdmin(
    admin,
    parsed.data.workspaceId,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "Only a workspace admin or owner can restore a project.",
    };
  }

  const { data: existing, error: fetchError } = await admin
    .from("projects")
    .select("id, workspace_id, deleted_at")
    .eq("id", parsed.data.projectId)
    .eq("workspace_id", parsed.data.workspaceId)
    .maybeSingle();

  if (fetchError || !existing) {
    return { ok: false, error: "Project not found." };
  }

  if (!existing.deleted_at) {
    // (a) definition-of-done "no-op input" convention: restoring an
    // already-active project is a no-op success, not an error — mirrors
    // this codebase's established "a no-op returns ok without writing"
    // pattern, applied here since there's nothing wrong with the caller's
    // request, just nothing left to do.
    return {
      ok: true,
      data: { id: existing.id, workspaceId: existing.workspace_id },
    };
  }

  // Same feature-detection fallback as archiveProject's write (see comment
  // above and archiveProject's own doc comment): `archived_by` may not
  // exist live yet, and a "column does not exist" error here must not
  // break restoring itself.
  let updated: { id: string; workspace_id: string } | null = null;
  let updateError: { code?: string; message?: string } | null = null;

  const restoreWithArchivedBy: ProjectsUpdateWithArchivedBy = {
    deleted_at: null,
    archived_by: null,
  };

  const withArchivedBy = await admin
    .from("projects")
    .update(restoreWithArchivedBy as never)
    .eq("id", parsed.data.projectId)
    .eq("workspace_id", parsed.data.workspaceId)
    .not("deleted_at", "is", null)
    .select("id, workspace_id")
    .single();

  if (
    withArchivedBy.error?.code === "42703" ||
    withArchivedBy.error?.code === "PGRST204"
  ) {
    const withoutArchivedBy = await admin
      .from("projects")
      .update({ deleted_at: null })
      .eq("id", parsed.data.projectId)
      .eq("workspace_id", parsed.data.workspaceId)
      .not("deleted_at", "is", null)
      .select("id, workspace_id")
      .single();
    updated = withoutArchivedBy.data;
    updateError = withoutArchivedBy.error;
  } else {
    updated = withArchivedBy.data;
    updateError = withArchivedBy.error;
  }

  if (updateError || !updated) {
    logger.error("restoreProject: restore update failed", { error: updateError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  await writeAudit(supabase, {
    workspaceId: parsed.data.workspaceId,
    action: "project.restored",
    targetType: "project",
    targetId: parsed.data.projectId,
  });

  // AS-255: revalidate every path whose data reflects live (non-archived)
  // projects, not just the archive page itself, so the project list,
  // dashboard, and search all reflect the restored project immediately.
  // Mirrors exactly what archiveProject already revalidates — the same
  // `/w/${slug}` layout segment covers the project list
  // (app/(workspace)/w/[workspaceSlug]/page.tsx), the dashboard (same page,
  // F073's tiles), and search (app/(workspace)/w/[workspaceSlug]/search,
  // if server-rendered) since they all live under that one layout segment;
  // there is no separate top-level route for any of those three that a
  // `"layout"`-scoped revalidation of `/w/${slug}` would miss.
  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", parsed.data.workspaceId)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}`, "layout");
    } catch (revalidateError) {
      logger.error("restoreProject: revalidatePath failed (non-fatal)", { error: revalidateError });
    }
  }

  return {
    ok: true,
    data: {
      id: updated.id,
      workspaceId: updated.workspace_id,
    },
  };
}
