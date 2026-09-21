"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
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
import { canCreateProject, canWrite } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/activity/audit";
import type { Database } from "@/lib/supabase/database.types";
import type { ActionResult } from "@/lib/actions/authz";

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

export type CreateProjectResult = ActionResult<{
        id: string;
        workspaceId: string;
        name: string;
        description: string | null;
        startDate: string | null;
        endDate: string | null;
        createdAt: string;
        createdBy: string | null;
      }>;

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

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to create a project." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: membership/permission check via requireActiveMembership(); caller identity already verified via getCurrentUser()/!user check immediately above
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

  // F031 (SB-034): one shared predicate (lib/auth/permissions.ts) also backs
  // the sidebar "+ New" menu. Allow-list: owner/admin/member. The branches
  // below only pick the error message.
  if (!canCreateProject({ role: membership.role })) {
    if (membership.role === "guest") {
      return { ok: false, error: "Guests cannot create projects." };
    }
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

  // Internal team chat: every project gets its own chat channel from the
  // moment it's created, not only once its portal is turned on (F116's
  // `ensure_project_channel_atomic` was originally wired only to
  // `setPortalEnabled`/`activateInvitedMemberships` for the client-portal
  // "Conversation" tab — see those call sites' own comments). Reusing the
  // exact same idempotent RPC here means the workspace-side chat sidebar
  // (app/(workspace)/w/[workspaceSlug]/chat/) and the portal's Conversation
  // tab (app/(portal)/portal/[workspaceSlug]/p/[projectId]/conversation/)
  // are backed by the identical `channels` row per project — same data,
  // different UI wrapper — rather than two separate channel concepts. Best
  // effort: a failure here must not fail project creation itself (the
  // project row above already committed), so it's logged, not returned as
  // an error; a project without a channel yet just falls back to
  // `setPortalEnabled`'s own call to the same RPC (or a later retry) to
  // backfill it.
  const { data: projectChannelId, error: ensureChannelError } = await admin.rpc(
    "ensure_project_channel_atomic",
    {
      p_project_id: inserted.id,
      p_created_by: user.id,
    },
  );
  if (ensureChannelError) {
    logger.error("createProject: ensure_project_channel_atomic failed (non-fatal)", {
      error: ensureChannelError,
    });
  } else if (projectChannelId) {
    // `ensure_project_channel_atomic` only enrolls existing
    // `project_members` rows, and project creation deliberately does not
    // insert one for the creator (most projects default to
    // workspace-visibility, no explicit `project_members` row needed for
    // that) -- explicitly add the creator as a `channel_members` row here
    // so the project's channel shows up in their own chat sidebar
    // (lib/queries/chat.ts's getWorkspaceChannels) immediately, not only
    // once someone is later added via `project_members`.
    const { error: memberError } = await admin
      .from("channel_members")
      .insert({ channel_id: projectChannelId, user_id: user.id })
      .select("channel_id")
      .maybeSingle();
    if (memberError && memberError.code !== "23505") {
      logger.error("createProject: failed to enroll creator on project channel (non-fatal)", {
        error: memberError,
      });
    }
  }

  // Default view tabs (Setup/Design/Dev/QA): every new project gets these
  // four SHARED list-type saved views out of the box, matching the
  // ClickUp-style "Design"/"Dev" list convention the workspace was
  // modelled after. Deliberately an EMPTY filter set (`config.filters: []`)
  // rather than any real predicate -- these are meant as manually-curated
  // buckets a member fills in themselves (per this feature's own scope
  // note), not smart filters, and the saved_views schema (F227/F228) has
  // no task<->view membership concept to assign tasks into one of these
  // automatically (out of scope here -- see this action's own comment
  // above the insert for the full rationale). Best-effort, like the
  // chat-channel provisioning above: a failure here must never fail
  // project creation itself.
  const DEFAULT_VIEW_NAMES = ["Setup", "Design", "Dev", "QA"];
  const { error: defaultViewsError } = await admin.from("saved_views").insert(
    DEFAULT_VIEW_NAMES.map((name, index) => ({
      workspace_id: parsed.data.workspaceId,
      project_id: inserted.id,
      owner_id: user.id,
      name,
      scope: "shared" as const,
      view_type: "list" as const,
      config: { filters: [], sort: [], groupBy: null },
      is_default: false,
      position: (index + 1) * 1000,
    })),
  );
  if (defaultViewsError) {
    logger.error("createProject: default view tabs insert failed (non-fatal)", {
      error: defaultViewsError,
    });
  }

  // "Who approves what" decision types: every new project starts with two
  // (Design, Content) — the new, smaller default per this feature's own
  // clarified spec, replacing the old fixed four (content/brand/technical/
  // commercial), which existing projects keep via
  // 20261117010000_project_decision_types.sql's backfill. Best-effort,
  // same convention as the chat channel / default views above: a failure
  // here must not fail project creation itself — a project without a
  // decision type yet just falls back to adding one later from project
  // settings (components/approvals/decision-owners.tsx).
  const DEFAULT_DECISION_TYPES = [
    { name: "Design", description: "Visual design, moodboards, page layouts." },
    { name: "Content", description: "Copy, sitemap structure, wording." },
  ];
  const { error: decisionTypesError } = await admin.from("project_decision_types").insert(
    DEFAULT_DECISION_TYPES.map((type, index) => ({
      project_id: inserted.id,
      name: type.name,
      description: type.description,
      sort_order: index + 1,
    })),
  );
  if (decisionTypesError) {
    logger.error("createProject: default decision types insert failed (non-fatal)", {
      error: decisionTypesError,
    });
  }

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

export type EditProjectResult = ActionResult<{
        id: string;
        workspaceId: string;
        name: string;
        description: string | null;
        startDate: string | null;
        endDate: string | null;
        icon: string | null;
        updatedAt: string;
      }>;

export type EditProjectUpdates = {
  name?: string;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  icon?: string | null;
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

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to edit a project." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: membership/permission check via requireActiveMembership(); caller identity already verified via getCurrentUser()/!user check immediately above
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
    .select("id, workspace_id, name, description, start_date, end_date, deleted_at, visibility")
    .eq("id", projectId)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (fetchError || !existing) {
    return { ok: false, error: "Project not found." };
  }

  // Verify the caller can actually see this project. For private projects the
  // caller must have an explicit project_members row; for workspace-visible
  // projects any active workspace member qualifies (already established above
  // by requireActiveMembership). Returning "Project not found." rather than a
  // permission error avoids leaking the existence of projects the caller has
  // no access to.
  if (existing.visibility === "private") {
    const { data: projectMemberRow } = await admin
      .from("project_members")
      .select("user_id")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!projectMemberRow) {
      return { ok: false, error: "Project not found." };
    }
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
    icon?: string | null;
  } = {};
  if (parsed.data.name !== undefined) updatePayload.name = parsed.data.name;
  if (parsed.data.description !== undefined)
    updatePayload.description = parsed.data.description;
  if (parsed.data.startDate !== undefined)
    updatePayload.start_date = parsed.data.startDate;
  if (parsed.data.endDate !== undefined) updatePayload.end_date = parsed.data.endDate;
  if (parsed.data.icon !== undefined) updatePayload.icon = parsed.data.icon;

  if (Object.keys(updatePayload).length === 0) {
    return { ok: false, error: "No changes to save." };
  }

  // `icon` selected/updated via `.returns<>()`/an `as never` update cast
  // rather than a typed column reference -- same not-yet-regenerated
  // `Database` type workaround this file already applies to
  // `archived_by` above (see `ProjectsUpdateWithArchivedBy`'s own
  // comment), needed here because `lib/supabase/database.types.ts` is
  // periodically regenerated by other concurrent work in this repo and
  // has, at various points, lagged behind `projects.icon`
  // (supabase/migrations/20261113010000_project_icon.sql).
  const { data: updated, error: updateError } = await admin
    .from("projects")
    .update(updatePayload as never)
    .eq("id", projectId)
    .eq("workspace_id", workspaceId)
    .select("id, workspace_id, name, description, start_date, end_date, icon, updated_at")
    .single()
    .then((result) =>
      result as {
        data: {
          id: string;
          workspace_id: string;
          name: string;
          description: string | null;
          start_date: string | null;
          end_date: string | null;
          icon: string | null;
          updated_at: string;
        } | null;
        error: { message?: string; code?: string } | null;
      },
    );

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
      icon: updated.icon,
      updatedAt: updated.updated_at,
    },
  };
}

export type ArchiveProjectResult = ActionResult<{
        id: string;
        workspaceId: string;
        deletedAt: string;
      }>;

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

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to archive a project." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: membership/permission check via requireWorkspaceAdmin(); caller identity already verified via getCurrentUser()/!user check immediately above
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

export type RestoreProjectResult = ActionResult<{
        id: string;
        workspaceId: string;
      }>;

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

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to restore a project." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: membership/permission check via requireWorkspaceAdmin(); caller identity already verified via getCurrentUser()/!user check immediately above
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

// Sidebar drag-and-drop reorder.
//
// `projects.sidebar_position` (supabase/migrations/
// 20261111010000_projects_sidebar_position.sql) is not yet reflected in
// the generated `Database` type -- same "CLI-applied migration outran
// `supabase gen types typescript`, needs live-schema connectivity this
// worker's sandbox doesn't have" situation `ProjectsUpdateWithArchivedBy`
// above already documents. Same fix: a local type extension rather than
// an unsafe `as any` cast on the update call. Delete both once
// `database.types.ts` is regenerated against the live schema.
type ProjectsRowWithSidebarPosition =
  Database["public"]["Tables"]["projects"]["Row"] & {
    sidebar_position: number | null;
  };
type ProjectsUpdateWithSidebarPosition =
  Database["public"]["Tables"]["projects"]["Update"] & {
    sidebar_position?: number | null;
  };

export type ReorderProjectResult = ActionResult<{ order: string[] }>;

// Moves `projectId` to `newPosition` (a 0-based index) among the OTHER
// non-deleted projects in its own workspace, then re-sequences every
// affected project's `sidebar_position` to plain 0..n-1 integers -- a
// full re-sequence (not a fractional-index insert like the board's
// `calculatePosition`) because this list is short (a workspace's project
// count, not its task count) and a full rewrite keeps the stored values
// simple/inspectable, per the clarified "global per workspace, MVP is
// enough" scope. `newPosition` is clamped to the valid range rather than
// rejected, so a caller racing a concurrent delete/insert never 400s the
// user over a now-stale index.
//
// Global per-workspace order (not per-member): every workspace member
// drags into the SAME shared order, matching this feature's clarified
// "no per-user override, simpler option" answer -- there is no
// `workspace_member_id` column on `sidebar_position`, deliberately.
export async function reorderProject(
  projectId: string,
  newPosition: number,
): Promise<ReorderProjectResult> {
  if (!Number.isInteger(newPosition) || newPosition < 0) {
    return { ok: false, error: "Invalid position." };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to reorder projects." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const { data: target, error: targetError } = await admin
    .from("projects")
    .select("id, workspace_id")
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();

  if (targetError || !target) {
    return { ok: false, error: "Project not found." };
  }

  // Defense in depth (AS-143 convention): re-check the caller is an
  // active member of the project's OWN workspace, not whatever
  // workspace it happens to be resolved against client-side.
  const membership = await requireActiveMembership(
    admin,
    target.workspace_id,
    user.id,
  );

  if (!membership.ok) {
    return {
      ok: false,
      error: "You don't have permission to reorder projects.",
    };
  }

  if (!canWrite({ role: membership.role })) {
    return {
      ok: false,
      error: "Viewers don't have permission to reorder projects.",
    };
  }

  const { data: siblingRows, error: siblingsError } = await admin
    .from("projects")
    .select("id, sidebar_position, created_at")
    .eq("workspace_id", target.workspace_id)
    .is("deleted_at", null)
    .order("sidebar_position", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (siblingsError || !siblingRows) {
    logger.error("reorderProject: failed to load sibling projects", {
      error: siblingsError,
    });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const siblings = siblingRows as unknown as ProjectsRowWithSidebarPosition[];
  const currentOrder = siblings.map((row) => row.id);
  const currentIndex = currentOrder.indexOf(projectId);

  if (currentIndex === -1) {
    return { ok: false, error: "Project not found." };
  }

  const withoutTarget = currentOrder.filter((id) => id !== projectId);
  const clampedPosition = Math.min(
    Math.max(newPosition, 0),
    withoutTarget.length,
  );
  const nextOrder = [
    ...withoutTarget.slice(0, clampedPosition),
    projectId,
    ...withoutTarget.slice(clampedPosition),
  ];

  // Only write rows whose position actually changed, still re-sequenced
  // to plain 0..n-1 integers so there's never a gap/duplicate left behind
  // from a prior partial state.
  const updates = nextOrder
    .map((id, index) => ({ id, index }))
    .filter(({ id, index }) => {
      const existing = siblings.find((row) => row.id === id);
      return existing?.sidebar_position !== index;
    });

  for (const { id, index } of updates) {
    const payload: ProjectsUpdateWithSidebarPosition = {
      sidebar_position: index,
    };
    const { error: updateError } = await admin
      .from("projects")
      .update(payload as never)
      .eq("id", id);

    if (updateError) {
      logger.error("reorderProject: update failed", {
        error: updateError,
        projectId: id,
      });
      return {
        ok: false,
        error: "Something went wrong. Please try again in a moment.",
      };
    }
  }

  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", target.workspace_id)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}`, "layout");
    } catch (revalidateError) {
      logger.error("reorderProject: revalidatePath failed (non-fatal)", {
        error: revalidateError,
      });
    }
  }

  return { ok: true, data: { order: nextOrder } };
}
