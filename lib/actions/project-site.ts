"use server";

// F022 (missions/20260903-portal): team-side CRUD for `project_links` and
// `project_accounts` (AS-049, AS-050). Mirrors lib/actions/project-records.ts's
// file shape throughout: withAuthz's default `canWrite` gate, ctx.admin
// for the actual write with RLS as the backstop (every INSERT/UPDATE/
// DELETE policy on both tables is gated on `is_project_workspace_writer`,
// 20261014010000), writeAudit for the audit trail, and the same
// swap-with-neighbor reorder shape lib/actions/phases.ts's
// `reorderPhases` uses (position is a plain PM-editable integer, no
// separate RPC — a two-row swap within one table, not a multi-table
// write, so design constraint 6 does not apply here any more than it did
// to phases).

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { logger } from "@/lib/observability/logger";
import { type ActionResult, withAuthz } from "@/lib/actions/authz";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/activity/audit";
import { revalidatePortalProject } from "@/lib/actions/portal-revalidate";
import {
  createProjectLinkSchema,
  updateProjectLinkSchema,
  deleteProjectLinkSchema,
  reorderProjectLinkSchema,
  createProjectAccountSchema,
  updateProjectAccountSchema,
  deleteProjectAccountSchema,
  reorderProjectAccountSchema,
} from "@/lib/validation/project-site";
import type { ProjectVisibility } from "@/lib/actions/project-visibility";
import type {
  ProjectLink,
  ProjectLinkKind,
  ProjectAccount,
  ProjectAccountOwner,
  ProjectAccountStatus,
} from "@/lib/queries/project-site";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

type AdminClient = ReturnType<typeof createAdminClient>;

type ProjectExtra = { projectId: string; workspaceSlug: string };

async function loadProjectExtra(
  admin: AdminClient,
  projectId: string,
): Promise<
  | {
      ok: true;
      workspaceId: string;
      projectId: string;
      visibility: ProjectVisibility;
      extra: ProjectExtra;
    }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("projects")
    .select("id, workspace_id, visibility, deleted_at, workspaces(slug)")
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

async function revalidateSiteSettings(workspaceSlug: string, projectId: string) {
  try {
    revalidatePath(`/w/${workspaceSlug}/projects/${projectId}/settings/site`, "page");
    revalidatePortalProject(workspaceSlug, projectId);
  } catch (revalidateError) {
    logger.error("project-site: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }
}

const AUTHZ_ERRORS = {
  membershipError: "You don't have permission to manage this project's site.",
  writeError: "Viewers don't have permission to manage this project's site.",
  visibilityError: "You don't have permission to manage this project's site.",
};

// ---------------------------------------------------------------------
// project_links
// ---------------------------------------------------------------------

export type ProjectLinkActionResult = ActionResult<ProjectLink>;

const LINK_COLUMNS = "id, project_id, kind, label, url, client_visible, position";

function toProjectLink(row: {
  id: string;
  project_id: string;
  kind: string;
  label: string;
  url: string;
  client_visible: boolean;
  position: number;
}): ProjectLink {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind as ProjectLinkKind,
    label: row.label,
    url: row.url,
    clientVisible: row.client_visible,
    position: row.position,
  };
}

const createProjectLinkImpl = withAuthz(
  createProjectLinkSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<ProjectLinkActionResult> => {
    const { data: last } = await ctx.admin
      .from("project_links")
      .select("position")
      .eq("project_id", ctx.projectId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const newPosition = ((last as { position: number } | null)?.position ?? 0) + 1;

    const { data: inserted, error } = await ctx.admin
      .from("project_links")
      .insert({
        project_id: ctx.projectId,
        kind: input.kind,
        label: input.label,
        url: input.url,
        client_visible: input.clientVisible ?? false,
        position: newPosition,
      })
      .select(LINK_COLUMNS)
      .single();

    if (error || !inserted) {
      logger.error("createProjectLink: insert failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_link.created",
      targetType: "project_link",
      targetId: inserted.id,
      metadata: { projectId: ctx.projectId, label: inserted.label },
    });

    await revalidateSiteSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: toProjectLink(inserted) };
  },
);

export async function createProjectLink(input: {
  projectId: string;
  kind: ProjectLinkKind;
  label: string;
  url: string;
  clientVisible?: boolean;
}): Promise<ProjectLinkActionResult> {
  return createProjectLinkImpl(input);
}

type LinkExtra = ProjectExtra & { linkLabel: string };

async function loadLinkExtra(
  admin: AdminClient,
  linkId: string,
): Promise<
  | {
      ok: true;
      workspaceId: string;
      projectId: string;
      visibility: ProjectVisibility;
      extra: LinkExtra;
    }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("project_links")
    .select(
      "id, project_id, label, projects!inner(id, workspace_id, visibility, deleted_at, workspaces(slug))",
    )
    .eq("id", linkId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Link not found." };
  }

  const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
  if (!project?.workspace_id || project.deleted_at) {
    return { ok: false, error: "Link not found." };
  }

  const workspace = project.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;
  if (!workspaceSlug) {
    return { ok: false, error: "Link not found." };
  }

  return {
    ok: true,
    workspaceId: project.workspace_id,
    projectId: project.id,
    visibility: project.visibility === "private" ? "private" : "workspace",
    extra: { projectId: project.id, workspaceSlug, linkLabel: data.label },
  };
}

const updateProjectLinkImpl = withAuthz(
  updateProjectLinkSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadLinkExtra(admin, input.linkId),
  },
  async (input, ctx): Promise<ProjectLinkActionResult> => {
    const { data: updated, error } = await ctx.admin
      .from("project_links")
      .update({
        kind: input.kind,
        label: input.label,
        url: input.url,
        client_visible: input.clientVisible,
      })
      .eq("id", input.linkId)
      .select(LINK_COLUMNS)
      .single();

    if (error || !updated) {
      logger.error("updateProjectLink: update failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_link.updated",
      targetType: "project_link",
      targetId: updated.id,
      metadata: { projectId: ctx.projectId, label: updated.label },
    });

    await revalidateSiteSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: toProjectLink(updated) };
  },
);

export async function updateProjectLink(input: {
  linkId: string;
  kind: ProjectLinkKind;
  label: string;
  url: string;
  clientVisible: boolean;
}): Promise<ProjectLinkActionResult> {
  return updateProjectLinkImpl(input);
}

export type DeleteProjectLinkResult = ActionResult<{ id: string; restore: ProjectLink }>;

const deleteProjectLinkImpl = withAuthz(
  deleteProjectLinkSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadLinkExtra(admin, input.linkId),
  },
  async (input, ctx): Promise<DeleteProjectLinkResult> => {
    const { data: existing, error: readError } = await ctx.admin
      .from("project_links")
      .select(LINK_COLUMNS)
      .eq("id", input.linkId)
      .maybeSingle();

    if (readError || !existing) {
      logger.error("deleteProjectLink: pre-delete read failed", { error: readError });
      return { ok: false, error: GENERIC_ERROR };
    }

    const { error } = await ctx.admin.from("project_links").delete().eq("id", input.linkId);

    if (error) {
      logger.error("deleteProjectLink: delete failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_link.deleted",
      targetType: "project_link",
      targetId: input.linkId,
      metadata: { projectId: ctx.projectId, label: ctx.linkLabel },
    });

    await revalidateSiteSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: { id: input.linkId, restore: toProjectLink(existing) } };
  },
);

export async function deleteProjectLink(linkId: string): Promise<DeleteProjectLinkResult> {
  return deleteProjectLinkImpl({ linkId });
}

// F090 item 5: restoreProjectLink — undo for the hard delete above.
const restoreProjectLinkSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  id: z.string().uuid("Invalid link."),
  kind: z.string(),
  label: z.string().min(1),
  url: z.string().min(1),
  clientVisible: z.boolean(),
  position: z.number(),
});

const restoreProjectLinkImpl = withAuthz(
  restoreProjectLinkSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<ProjectLinkActionResult> => {
    const { data, error } = await ctx.admin
      .from("project_links")
      .insert({
        id: input.id,
        project_id: ctx.projectId,
        kind: input.kind,
        label: input.label,
        url: input.url,
        client_visible: input.clientVisible,
        position: input.position,
      })
      .select(LINK_COLUMNS)
      .single();

    if (error || !data) {
      logger.error("restoreProjectLink: insert failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_link.restored",
      targetType: "project_link",
      targetId: input.id,
      metadata: { projectId: ctx.projectId, label: input.label },
    });

    await revalidateSiteSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: toProjectLink(data) };
  },
);

export async function restoreProjectLink(input: {
  projectId: string;
  id: string;
  kind: ProjectLinkKind;
  label: string;
  url: string;
  clientVisible: boolean;
  position: number;
}): Promise<ProjectLinkActionResult> {
  return restoreProjectLinkImpl(input);
}

export type ReorderProjectLinkResult = ActionResult<{
        moved: { id: string; position: number };
        swappedWith: { id: string; position: number } | null;
      }>;

const reorderProjectLinkImpl = withAuthz(
  reorderProjectLinkSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadLinkExtra(admin, input.linkId),
  },
  async (input, ctx): Promise<ReorderProjectLinkResult> => {
    const { data, error: siblingsError } = await ctx.admin
      .from("project_links")
      .select("id, position")
      .eq("project_id", ctx.projectId)
      .order("position", { ascending: true });

    const siblings = data as { id: string; position: number }[] | null;

    if (siblingsError || !siblings) {
      logger.error("reorderProjectLink: failed to load siblings", { error: siblingsError });
      return { ok: false, error: GENERIC_ERROR };
    }

    const index = siblings.findIndex((link) => link.id === input.linkId);
    if (index === -1) {
      return { ok: false, error: "Link not found." };
    }

    const neighborIndex = input.direction === "up" ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= siblings.length) {
      return { ok: true, data: { moved: siblings[index], swappedWith: null } };
    }

    const moved = siblings[index];
    const neighbor = siblings[neighborIndex];

    const [{ error: movedError }, { error: neighborError }] = await Promise.all([
      ctx.admin.from("project_links").update({ position: neighbor.position }).eq("id", moved.id),
      ctx.admin.from("project_links").update({ position: moved.position }).eq("id", neighbor.id),
    ]);

    if (movedError || neighborError) {
      logger.error("reorderProjectLink: swap failed", { error: movedError ?? neighborError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await revalidateSiteSettings(ctx.workspaceSlug, ctx.projectId);

    return {
      ok: true,
      data: {
        moved: { id: moved.id, position: neighbor.position },
        swappedWith: { id: neighbor.id, position: moved.position },
      },
    };
  },
);

export async function reorderProjectLink(
  linkId: string,
  direction: "up" | "down",
): Promise<ReorderProjectLinkResult> {
  return reorderProjectLinkImpl({ linkId, direction });
}

// ---------------------------------------------------------------------
// project_accounts
// ---------------------------------------------------------------------

export type ProjectAccountActionResult = ActionResult<ProjectAccount>;

const ACCOUNT_COLUMNS =
  "id, project_id, service, owner, status, renewal_date, note, client_visible, position";

function toProjectAccount(row: {
  id: string;
  project_id: string;
  service: string;
  owner: string;
  status: string;
  renewal_date: string | null;
  note: string | null;
  client_visible: boolean;
  position: number;
}): ProjectAccount {
  return {
    id: row.id,
    projectId: row.project_id,
    service: row.service,
    owner: row.owner as ProjectAccountOwner,
    status: row.status as ProjectAccountStatus,
    renewalDate: row.renewal_date,
    note: row.note,
    clientVisible: row.client_visible,
    position: row.position,
  };
}

const createProjectAccountImpl = withAuthz(
  createProjectAccountSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<ProjectAccountActionResult> => {
    const { data: last } = await ctx.admin
      .from("project_accounts")
      .select("position")
      .eq("project_id", ctx.projectId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const newPosition = ((last as { position: number } | null)?.position ?? 0) + 1;

    const { data: inserted, error } = await ctx.admin
      .from("project_accounts")
      .insert({
        project_id: ctx.projectId,
        service: input.service,
        owner: input.owner,
        status: input.status,
        renewal_date: input.renewalDate ?? null,
        note: input.note ?? null,
        client_visible: input.clientVisible ?? true,
        position: newPosition,
      })
      .select(ACCOUNT_COLUMNS)
      .single();

    if (error || !inserted) {
      // A rejected secret shape at the CHECK-constraint level (defense in
      // depth on top of the Zod refinement) surfaces the same actionable
      // message rather than a generic Postgres error.
      const message = error?.message?.includes("no_secret_shape")
        ? "This looks like a password or API key. Put it in the password manager, not here."
        : GENERIC_ERROR;
      logger.error("createProjectAccount: insert failed", { error });
      return { ok: false, error: message };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_account.created",
      targetType: "project_account",
      targetId: inserted.id,
      metadata: { projectId: ctx.projectId, service: inserted.service },
    });

    await revalidateSiteSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: toProjectAccount(inserted) };
  },
);

export async function createProjectAccount(input: {
  projectId: string;
  service: string;
  owner: ProjectAccountOwner;
  status: ProjectAccountStatus;
  renewalDate?: string | null;
  note?: string | null;
  clientVisible?: boolean;
}): Promise<ProjectAccountActionResult> {
  return createProjectAccountImpl(input);
}

type AccountExtra = ProjectExtra & { accountService: string };

async function loadAccountExtra(
  admin: AdminClient,
  accountId: string,
): Promise<
  | {
      ok: true;
      workspaceId: string;
      projectId: string;
      visibility: ProjectVisibility;
      extra: AccountExtra;
    }
  | { ok: false; error: string }
> {
  const { data, error } = await admin
    .from("project_accounts")
    .select(
      "id, project_id, service, projects!inner(id, workspace_id, visibility, deleted_at, workspaces(slug))",
    )
    .eq("id", accountId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Account not found." };
  }

  const project = Array.isArray(data.projects) ? data.projects[0] : data.projects;
  if (!project?.workspace_id || project.deleted_at) {
    return { ok: false, error: "Account not found." };
  }

  const workspace = project.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;
  if (!workspaceSlug) {
    return { ok: false, error: "Account not found." };
  }

  return {
    ok: true,
    workspaceId: project.workspace_id,
    projectId: project.id,
    visibility: project.visibility === "private" ? "private" : "workspace",
    extra: { projectId: project.id, workspaceSlug, accountService: data.service },
  };
}

const updateProjectAccountImpl = withAuthz(
  updateProjectAccountSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadAccountExtra(admin, input.accountId),
  },
  async (input, ctx): Promise<ProjectAccountActionResult> => {
    const { data: updated, error } = await ctx.admin
      .from("project_accounts")
      .update({
        service: input.service,
        owner: input.owner,
        status: input.status,
        renewal_date: input.renewalDate,
        note: input.note,
        client_visible: input.clientVisible,
      })
      .eq("id", input.accountId)
      .select(ACCOUNT_COLUMNS)
      .single();

    if (error || !updated) {
      const message = error?.message?.includes("no_secret_shape")
        ? "This looks like a password or API key. Put it in the password manager, not here."
        : GENERIC_ERROR;
      logger.error("updateProjectAccount: update failed", { error });
      return { ok: false, error: message };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_account.updated",
      targetType: "project_account",
      targetId: updated.id,
      metadata: { projectId: ctx.projectId, service: updated.service },
    });

    await revalidateSiteSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: toProjectAccount(updated) };
  },
);

export async function updateProjectAccount(input: {
  accountId: string;
  service: string;
  owner: ProjectAccountOwner;
  status: ProjectAccountStatus;
  renewalDate: string | null;
  note: string | null;
  clientVisible: boolean;
}): Promise<ProjectAccountActionResult> {
  return updateProjectAccountImpl(input);
}

export type DeleteProjectAccountResult = ActionResult<{ id: string; restore: ProjectAccount }>;

const deleteProjectAccountImpl = withAuthz(
  deleteProjectAccountSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadAccountExtra(admin, input.accountId),
  },
  async (input, ctx): Promise<DeleteProjectAccountResult> => {
    const { data: existing, error: readError } = await ctx.admin
      .from("project_accounts")
      .select(ACCOUNT_COLUMNS)
      .eq("id", input.accountId)
      .maybeSingle();

    if (readError || !existing) {
      logger.error("deleteProjectAccount: pre-delete read failed", { error: readError });
      return { ok: false, error: GENERIC_ERROR };
    }

    const { error } = await ctx.admin
      .from("project_accounts")
      .delete()
      .eq("id", input.accountId);

    if (error) {
      logger.error("deleteProjectAccount: delete failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_account.deleted",
      targetType: "project_account",
      targetId: input.accountId,
      metadata: { projectId: ctx.projectId, service: ctx.accountService },
    });

    await revalidateSiteSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: { id: input.accountId, restore: toProjectAccount(existing) } };
  },
);

export async function deleteProjectAccount(accountId: string): Promise<DeleteProjectAccountResult> {
  return deleteProjectAccountImpl({ accountId });
}

// F090 item 5: restoreProjectAccount — undo for the hard delete above.
const restoreProjectAccountSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  id: z.string().uuid("Invalid account."),
  service: z.string().min(1),
  owner: z.string(),
  status: z.string(),
  renewalDate: z.string().nullable(),
  note: z.string().nullable(),
  clientVisible: z.boolean(),
  position: z.number(),
});

const restoreProjectAccountImpl = withAuthz(
  restoreProjectAccountSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadProjectExtra(admin, input.projectId),
  },
  async (input, ctx): Promise<ProjectAccountActionResult> => {
    const { data, error } = await ctx.admin
      .from("project_accounts")
      .insert({
        id: input.id,
        project_id: ctx.projectId,
        service: input.service,
        owner: input.owner,
        status: input.status,
        renewal_date: input.renewalDate,
        note: input.note,
        client_visible: input.clientVisible,
        position: input.position,
      })
      .select(ACCOUNT_COLUMNS)
      .single();

    if (error || !data) {
      logger.error("restoreProjectAccount: insert failed", { error });
      return { ok: false, error: GENERIC_ERROR };
    }

    await writeAudit(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      action: "project_account.restored",
      targetType: "project_account",
      targetId: input.id,
      metadata: { projectId: ctx.projectId, service: input.service },
    });

    await revalidateSiteSettings(ctx.workspaceSlug, ctx.projectId);
    return { ok: true, data: toProjectAccount(data) };
  },
);

export async function restoreProjectAccount(input: {
  projectId: string;
  id: string;
  service: string;
  owner: ProjectAccountOwner;
  status: ProjectAccountStatus;
  renewalDate: string | null;
  note: string | null;
  clientVisible: boolean;
  position: number;
}): Promise<ProjectAccountActionResult> {
  return restoreProjectAccountImpl(input);
}

export type ReorderProjectAccountResult = ActionResult<{
        moved: { id: string; position: number };
        swappedWith: { id: string; position: number } | null;
      }>;

const reorderProjectAccountImpl = withAuthz(
  reorderProjectAccountSchema,
  {
    requireWrite: true,
    requireVisibility: true,
    ...AUTHZ_ERRORS,
    resolveWorkspace: (input, admin) => loadAccountExtra(admin, input.accountId),
  },
  async (input, ctx): Promise<ReorderProjectAccountResult> => {
    const { data, error: siblingsError } = await ctx.admin
      .from("project_accounts")
      .select("id, position")
      .eq("project_id", ctx.projectId)
      .order("position", { ascending: true });

    const siblings = data as { id: string; position: number }[] | null;

    if (siblingsError || !siblings) {
      logger.error("reorderProjectAccount: failed to load siblings", { error: siblingsError });
      return { ok: false, error: GENERIC_ERROR };
    }

    const index = siblings.findIndex((account) => account.id === input.accountId);
    if (index === -1) {
      return { ok: false, error: "Account not found." };
    }

    const neighborIndex = input.direction === "up" ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= siblings.length) {
      return { ok: true, data: { moved: siblings[index], swappedWith: null } };
    }

    const moved = siblings[index];
    const neighbor = siblings[neighborIndex];

    const [{ error: movedError }, { error: neighborError }] = await Promise.all([
      ctx.admin
        .from("project_accounts")
        .update({ position: neighbor.position })
        .eq("id", moved.id),
      ctx.admin
        .from("project_accounts")
        .update({ position: moved.position })
        .eq("id", neighbor.id),
    ]);

    if (movedError || neighborError) {
      logger.error("reorderProjectAccount: swap failed", { error: movedError ?? neighborError });
      return { ok: false, error: GENERIC_ERROR };
    }

    await revalidateSiteSettings(ctx.workspaceSlug, ctx.projectId);

    return {
      ok: true,
      data: {
        moved: { id: moved.id, position: neighbor.position },
        swappedWith: { id: neighbor.id, position: moved.position },
      },
    };
  },
);

export async function reorderProjectAccount(
  accountId: string,
  direction: "up" | "down",
): Promise<ReorderProjectAccountResult> {
  return reorderProjectAccountImpl({ accountId, direction });
}
