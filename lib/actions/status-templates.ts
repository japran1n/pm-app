"use server";

// F428-F430 (docs/plan-daily-work-followups.md): workspace-owned status
// templates, and applying one to a project's board columns.
//
// Pattern mirrors lib/actions/statuses.ts: the request-scoped,
// RLS-respecting client performs every read/write on status_templates and
// status_template_items (RLS is the real enforcement boundary — see
// 20260903010000_status_templates.sql's policies), the admin client is
// used only for read-only lookups that need to resolve real data
// regardless of the caller's own RLS visibility (workspace id from a
// project id), and `requireWorkspaceAdmin` is re-checked here on top of
// RLS per this codebase's "the DB is the last line, not the only line"
// convention (AS-230).
//
// `applyStatusTemplate` is the one action that calls a SECURITY DEFINER
// RPC (apply_status_template) instead of doing plain table writes — see
// that function's own migration comment for why: it remaps tasks off
// deleted columns in one transaction, which plain RLS-gated inserts/
// deletes cannot do atomically. The RPC re-checks the caller's
// owner/admin role itself (defense in depth — see that migration), so
// this action's own requireWorkspaceAdmin check below is not the only
// thing standing between a non-admin and a project's columns.

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireWorkspaceAdmin } from "@/lib/auth/require-membership";
import {
  createStatusTemplateSchema,
  renameStatusTemplateSchema,
  deleteStatusTemplateSchema,
  addTemplateItemSchema,
  updateTemplateItemSchema,
  removeTemplateItemSchema,
  reorderTemplateItemSchema,
  applyStatusTemplateSchema,
} from "@/lib/validation/status-templates";

const PERMISSION_DENIED_ERROR =
  "You don't have permission to manage status templates.";
const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

export type StatusTemplateActionResult =
  | { ok: true }
  | { ok: false; error: string };

async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function createStatusTemplate(
  input: unknown,
): Promise<StatusTemplateActionResult> {
  const parsed = createStatusTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const userId = await currentUserId();
  if (!userId) return { ok: false, error: PERMISSION_DENIED_ERROR };

  const admin = createAdminClient();
  const membership = await requireWorkspaceAdmin(admin, parsed.data.workspaceId, userId);
  if (!membership.ok) return { ok: false, error: PERMISSION_DENIED_ERROR };

  const supabase = await createClient();
  const { error } = await supabase.from("status_templates").insert({
    workspace_id: parsed.data.workspaceId,
    name: parsed.data.name,
    created_by: userId,
  });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "A template with that name already exists." };
    }
    console.error("createStatusTemplate failed:", error);
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/w/[workspaceSlug]/settings", "page");
  return { ok: true };
}

export async function renameStatusTemplate(
  input: unknown,
): Promise<StatusTemplateActionResult> {
  const parsed = renameStatusTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const userId = await currentUserId();
  if (!userId) return { ok: false, error: PERMISSION_DENIED_ERROR };

  const admin = createAdminClient();
  const { data: template } = await admin
    .from("status_templates")
    .select("workspace_id")
    .eq("id", parsed.data.templateId)
    .maybeSingle();
  if (!template) return { ok: false, error: "Template not found." };

  const membership = await requireWorkspaceAdmin(admin, template.workspace_id, userId);
  if (!membership.ok) return { ok: false, error: PERMISSION_DENIED_ERROR };

  const supabase = await createClient();
  const { error } = await supabase
    .from("status_templates")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.templateId);

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "A template with that name already exists." };
    }
    console.error("renameStatusTemplate failed:", error);
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/w/[workspaceSlug]/settings", "page");
  return { ok: true };
}

export async function deleteStatusTemplate(
  input: unknown,
): Promise<StatusTemplateActionResult> {
  const parsed = deleteStatusTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const userId = await currentUserId();
  if (!userId) return { ok: false, error: PERMISSION_DENIED_ERROR };

  const admin = createAdminClient();
  const { data: template } = await admin
    .from("status_templates")
    .select("workspace_id")
    .eq("id", parsed.data.templateId)
    .maybeSingle();
  if (!template) return { ok: true }; // already gone

  const membership = await requireWorkspaceAdmin(admin, template.workspace_id, userId);
  if (!membership.ok) return { ok: false, error: PERMISSION_DENIED_ERROR };

  // AS-576: deleting a template never touches any project that already
  // applied it — project_statuses rows are independent copies, not a live
  // reference to this template (see this feature's migration header).
  const supabase = await createClient();
  const { error } = await supabase
    .from("status_templates")
    .delete()
    .eq("id", parsed.data.templateId);

  if (error) {
    console.error("deleteStatusTemplate failed:", error);
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/w/[workspaceSlug]/settings", "page");
  return { ok: true };
}

async function requireItemAdmin(itemId: string) {
  const userId = await currentUserId();
  if (!userId) return { ok: false as const };

  const admin = createAdminClient();
  const { data: item } = await admin
    .from("status_template_items")
    .select("id, template_id, status_templates(workspace_id)")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return { ok: false as const };

  const template = item.status_templates as { workspace_id: string } | { workspace_id: string }[] | null;
  const workspaceId = Array.isArray(template) ? template[0]?.workspace_id : template?.workspace_id;
  if (!workspaceId) return { ok: false as const };

  const membership = await requireWorkspaceAdmin(admin, workspaceId, userId);
  if (!membership.ok) return { ok: false as const };

  return { ok: true as const, templateId: item.template_id };
}

export async function addTemplateItem(
  input: unknown,
): Promise<StatusTemplateActionResult> {
  const parsed = addTemplateItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const userId = await currentUserId();
  if (!userId) return { ok: false, error: PERMISSION_DENIED_ERROR };

  const admin = createAdminClient();
  const { data: template } = await admin
    .from("status_templates")
    .select("workspace_id")
    .eq("id", parsed.data.templateId)
    .maybeSingle();
  if (!template) return { ok: false, error: "Template not found." };

  const membership = await requireWorkspaceAdmin(admin, template.workspace_id, userId);
  if (!membership.ok) return { ok: false, error: PERMISSION_DENIED_ERROR };

  const supabase = await createClient();
  const { data: existingItems } = await supabase
    .from("status_template_items")
    .select("position")
    .eq("template_id", parsed.data.templateId)
    .order("position", { ascending: false })
    .limit(1);
  const nextPosition = (existingItems?.[0]?.position ?? 0) + 1000;

  const { error } = await supabase.from("status_template_items").insert({
    template_id: parsed.data.templateId,
    name: parsed.data.name,
    color: parsed.data.color,
    category: parsed.data.category,
    position: nextPosition,
  });

  if (error) {
    console.error("addTemplateItem failed:", error);
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/w/[workspaceSlug]/settings", "page");
  return { ok: true };
}

export async function updateTemplateItem(
  input: unknown,
): Promise<StatusTemplateActionResult> {
  const parsed = updateTemplateItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const auth = await requireItemAdmin(parsed.data.itemId);
  if (!auth.ok) return { ok: false, error: PERMISSION_DENIED_ERROR };

  const patch: Record<string, string> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.color !== undefined) patch.color = parsed.data.color;
  if (parsed.data.category !== undefined) patch.category = parsed.data.category;

  const supabase = await createClient();
  const { error } = await supabase
    .from("status_template_items")
    .update(patch)
    .eq("id", parsed.data.itemId);

  if (error) {
    console.error("updateTemplateItem failed:", error);
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/w/[workspaceSlug]/settings", "page");
  return { ok: true };
}

export async function removeTemplateItem(
  input: unknown,
): Promise<StatusTemplateActionResult> {
  const parsed = removeTemplateItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const auth = await requireItemAdmin(parsed.data.itemId);
  if (!auth.ok) return { ok: false, error: PERMISSION_DENIED_ERROR };

  const supabase = await createClient();
  const { error } = await supabase
    .from("status_template_items")
    .delete()
    .eq("id", parsed.data.itemId);

  if (error) {
    console.error("removeTemplateItem failed:", error);
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/w/[workspaceSlug]/settings", "page");
  return { ok: true };
}

export async function reorderTemplateItem(
  input: unknown,
): Promise<StatusTemplateActionResult> {
  const parsed = reorderTemplateItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const auth = await requireItemAdmin(parsed.data.itemId);
  if (!auth.ok) return { ok: false, error: PERMISSION_DENIED_ERROR };

  const supabase = await createClient();
  const { error } = await supabase
    .from("status_template_items")
    .update({ position: parsed.data.newPosition })
    .eq("id", parsed.data.itemId);

  if (error) {
    console.error("reorderTemplateItem failed:", error);
    return { ok: false, error: GENERIC_ERROR };
  }

  revalidatePath("/w/[workspaceSlug]/settings", "page");
  return { ok: true };
}

// AS-573/AS-574: server-side re-check happens twice for this one — once
// here (so a non-admin gets PERMISSION_DENIED_ERROR, this action's own
// generic-message convention) and again inside apply_status_template
// itself (so the check holds even for a caller invoking the RPC directly,
// bypassing this action entirely).
export async function applyStatusTemplate(
  input: unknown,
): Promise<StatusTemplateActionResult> {
  const parsed = applyStatusTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_ERROR };
  }

  const userId = await currentUserId();
  if (!userId) return { ok: false, error: PERMISSION_DENIED_ERROR };

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("projects")
    .select("workspace_id, workspaces(slug)")
    .eq("id", parsed.data.projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: "Project not found." };

  const membership = await requireWorkspaceAdmin(admin, project.workspace_id, userId);
  if (!membership.ok) return { ok: false, error: PERMISSION_DENIED_ERROR };

  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_status_template", {
    p_project_id: parsed.data.projectId,
    p_template_id: parsed.data.templateId,
  });

  if (error) {
    console.error("applyStatusTemplate failed:", error);
    return { ok: false, error: GENERIC_ERROR };
  }

  const workspace = project.workspaces as { slug: string } | { slug: string }[] | null;
  const workspaceSlug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;
  if (workspaceSlug) {
    revalidatePath(
      `/w/${workspaceSlug}/projects/${parsed.data.projectId}/settings/columns`,
    );
    revalidatePath(`/w/${workspaceSlug}/projects/${parsed.data.projectId}/board`);
  }
  return { ok: true };
}
