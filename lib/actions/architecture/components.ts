"use server";

// Component actions for the Architecture board, split out of the original
// single-file lib/actions/architecture.ts as a PURE MOVE -- no behaviour,
// comment, or call site changed. See lib/actions/architecture.ts (now a
// re-export barrel) for the split rationale.
import { revalidatePath } from "next/cache";

import { logger } from "@/lib/observability/logger";
import { revalidatePortalProject } from "@/lib/actions/portal-revalidate";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { z } from "zod";

import { reorderComponentsSchema } from "@/lib/validation/architecture";

import type {
  MutationResult,
  MutationWithIdResult,
  MutationWithComponentIdResult,
} from "./shared";
import {
  authorizeArchitectureProject,
  areArchitectureSections,
} from "./authorize";

// Mission 20260910-182104, F025 (AS-051, AS-052): turns an existing
// section into a component. A section IS a subtask (standing decision 1);
// "turning it into a component" means creating a `page_components` row
// named after the section's own title (AS-052) and linking it back via
// the same `tasks.component_id` column every other section-component
// link uses (F008/F033 etc already read this column), so the section
// card immediately shows the new component name for free.
//
// Guards against creating a duplicate component for a section that is
// already linked -- returns a generic error rather than silently
// creating a second, orphaned component.
export async function createComponentFromSection(
  sectionTaskId: string,
  projectId: string,
): Promise<MutationWithComponentIdResult> {
  const { user } = await getCurrentUser();

  if (!user) {
    return {
      success: false,
      error: "You must be signed in to create a component.",
    };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  // Look up the section's owning project/workspace server-side (never
  // trust the caller-supplied projectId for permission checks -- only for
  // scoping the new component row once membership against the *real*
  // workspace is confirmed), and confirm it is actually a section (has a
  // parent page, no page_slug of its own) before touching it -- same
  // convention as deleteSection/renameSection above.
  const { data: taskRow, error: taskError } = await admin
    .from("tasks")
    .select(
      "id, project_id, title, page_slug, parent_task_id, component_id, projects(workspace_id, workspaces(slug))",
    )
    .eq("id", sectionTaskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (
    taskError ||
    !taskRow ||
    taskRow.page_slug ||
    !taskRow.parent_task_id ||
    !(taskRow as { projects?: { workspace_id?: string } }).projects?.workspace_id
  ) {
    return { success: false, error: "Section not found." };
  }

  if (
    taskRow.project_id !== projectId ||
    !(await areArchitectureSections(admin, [taskRow]))
  ) {
    return { success: false, error: "Section not found." };
  }

  const authz = await authorizeArchitectureProject(
    admin,
    user.id,
    taskRow.project_id,
  );

  if (!authz.ok) {
    return {
      success: false,
      error: "You don't have permission to create a component in this project.",
    };
  }

  if (taskRow.component_id) {
    return {
      success: false,
      error: "Section already linked to a component",
    };
  }

  const createComponentFromSectionWorkspaceSlug = authz.access.workspaceSlug;

  // AS-065: two components in the same project cannot share a
  // case-insensitive name (page_components_project_id_lower_name_idx,
  // supabase/migrations/20261121010000_f002_page_components.sql).
  // Section titles aren't guaranteed unique, so this can legitimately
  // collide -- surfaced as a normal error rather than a 500.
  const { count: existingComponentCount, error: countError } = await admin
    .from("page_components")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  if (countError) {
    logger.error("createComponentFromSection: failed to count components", {
      error: countError,
    });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { data: insertedComponent, error: insertError } = await admin
    .from("page_components")
    .insert({
      project_id: projectId,
      name: taskRow.title,
      position: (existingComponentCount ?? 0) + 1,
    })
    .select("id")
    .single();

  if (insertError || !insertedComponent) {
    if (insertError?.code === "23505") {
      return {
        success: false,
        error: "A component with this name already exists.",
      };
    }

    logger.error("createComponentFromSection: insert failed", {
      error: insertError,
    });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { error: updateError } = await admin
    .from("tasks")
    .update({ component_id: insertedComponent.id })
    .eq("id", sectionTaskId);

  if (updateError) {
    logger.error("createComponentFromSection: link update failed", {
      error: updateError,
    });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("createComponentFromSection: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  if (createComponentFromSectionWorkspaceSlug) {
    revalidatePortalProject(createComponentFromSectionWorkspaceSlug, projectId);
  }

  return { success: true, componentId: insertedComponent.id };
}

// Mission 20260910-182104, F025 (AS-065, AS-066): general-purpose
// component creation, independent of any section. Same
// membership/permission re-check and append-to-end position convention
// as createPage.
export async function createComponent(
  projectId: string,
  name: string,
): Promise<MutationWithIdResult> {
  // AS-066: a component cannot be created with an empty name.
  const parsed = z
    .string()
    .trim()
    .min(1, "Component name is required.")
    .max(200, "Component name must be 200 characters or fewer.")
    .safeParse(name);

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Component name is required.",
    };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return {
      success: false,
      error: "You must be signed in to create a component.",
    };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const authz = await authorizeArchitectureProject(admin, user.id, projectId);

  if (!authz.ok) {
    return authz.reason === "not_found"
      ? { success: false, error: "Project not found." }
      : {
          success: false,
          error: "You don't have permission to create a component in this project.",
        };
  }

  const createComponentWorkspaceSlug = authz.access.workspaceSlug;

  const { count: existingComponentCount, error: countError } = await admin
    .from("page_components")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  if (countError) {
    logger.error("createComponent: failed to count components", {
      error: countError,
    });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // AS-065: unique(project_id, lower(name)) -- enforced by
  // page_components_project_id_lower_name_idx
  // (supabase/migrations/20261121010000_f002_page_components.sql).
  const { data: inserted, error: insertError } = await admin
    .from("page_components")
    .insert({
      project_id: projectId,
      name: parsed.data,
      position: (existingComponentCount ?? 0) + 1,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    if (insertError?.code === "23505") {
      return {
        success: false,
        error: "A component with this name already exists.",
      };
    }

    logger.error("createComponent: insert failed", { error: insertError });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("createComponent: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  if (createComponentWorkspaceSlug) {
    revalidatePortalProject(createComponentWorkspaceSlug, projectId);
  }

  return { success: true, id: inserted.id };
}

// Mission 20260910-182104, F026 (AS-053, AS-062, AS-067, AS-068): links an
// existing component to a section. AS-062 (a section can only have one
// component) falls out for free from `tasks.component_id` being a single
// nullable column -- this update always replaces whatever was there
// before, there is no separate join table to dedupe.
export async function linkComponentToSection(
  sectionTaskId: string,
  componentId: string,
): Promise<MutationResult> {
  const { user } = await getCurrentUser();

  if (!user) {
    return {
      success: false,
      error: "You must be signed in to link a component.",
    };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const { data: sectionRow, error: sectionError } = await admin
    .from("tasks")
    .select("id, project_id, page_slug, parent_task_id")
    .eq("id", sectionTaskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (
    sectionError ||
    !sectionRow ||
    !(await areArchitectureSections(admin, [sectionRow]))
  ) {
    return { success: false, error: "Section not found." };
  }

  const { data: componentRow, error: componentError } = await admin
    .from("page_components")
    .select("id, project_id")
    .eq("id", componentId)
    .maybeSingle();

  if (componentError || !componentRow) {
    return { success: false, error: "Component not found." };
  }

  if (componentRow.project_id !== sectionRow.project_id) {
    return {
      success: false,
      error: "Component does not belong to this project.",
    };
  }

  const authz = await authorizeArchitectureProject(
    admin,
    user.id,
    sectionRow.project_id,
  );

  if (!authz.ok) {
    return authz.reason === "not_found"
      ? { success: false, error: "Project not found." }
      : {
          success: false,
          error: "You don't have permission to link a component in this project.",
        };
  }

  const linkComponentWorkspaceSlug = authz.access.workspaceSlug;

  const { error: updateError } = await admin
    .from("tasks")
    .update({ component_id: componentId })
    .eq("id", sectionTaskId);

  if (updateError) {
    logger.error("linkComponentToSection: update failed", {
      error: updateError,
    });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("linkComponentToSection: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  if (linkComponentWorkspaceSlug) {
    revalidatePortalProject(linkComponentWorkspaceSlug, sectionRow.project_id);
  }

  return { success: true };
}


// Mission 20260910-182104, F028 (AS-057): renames a component. Sections
// join to `page_components.name` via `tasks.component_id` (F026/F027) --
// there is no per-instance copy of the name anywhere -- so this update is
// the entire propagation mechanism: every section that links to this
// component id renders the new name the next time `getArchitectureBoard`
// (lib/queries/architecture.ts) is read, with no additional writes needed.
export async function renameComponent(
  componentId: string,
  name: string,
): Promise<MutationResult> {
  // AS-066: a component cannot be renamed to an empty name.
  const parsed = z
    .string()
    .trim()
    .min(1, "Component name is required.")
    .max(200, "Component name must be 200 characters or fewer.")
    .safeParse(name);

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Component name is required.",
    };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return {
      success: false,
      error: "You must be signed in to rename a component.",
    };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const { data: componentRow, error: componentError } = await admin
    .from("page_components")
    .select("id, project_id, projects(workspace_id, workspaces(slug))")
    .eq("id", componentId)
    .maybeSingle();

  if (
    componentError ||
    !componentRow ||
    !(componentRow as { projects?: { workspace_id?: string } }).projects
      ?.workspace_id
  ) {
    return { success: false, error: "Component not found." };
  }

  const authz = await authorizeArchitectureProject(
    admin,
    user.id,
    componentRow.project_id,
  );

  if (!authz.ok) {
    return {
      success: false,
      error: "You don't have permission to rename this component.",
    };
  }

  const renameComponentWorkspaceSlug = authz.access.workspaceSlug;

  // AS-065: unique(project_id, lower(name)) -- enforced by
  // page_components_project_id_lower_name_idx
  // (supabase/migrations/20261121010000_f002_page_components.sql).
  const { error: updateError } = await admin
    .from("page_components")
    .update({ name: parsed.data })
    .eq("id", componentId);

  if (updateError) {
    if (updateError.code === "23505") {
      return {
        success: false,
        error: "A component with this name already exists.",
      };
    }

    logger.error("renameComponent: update failed", { error: updateError });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("renameComponent: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  if (renameComponentWorkspaceSlug) {
    revalidatePortalProject(renameComponentWorkspaceSlug, componentRow.project_id);
  }

  return { success: true };
}

// Mission 20260910-182104, F029 (AS-058, AS-059): unlink a single section
// instance from its component without touching any other instance and
// without touching the section's own name.
//
// The update targets exactly one row (`WHERE id = sectionTaskId`), so
// other sections sharing the same `component_id` are never selected or
// written to -- AS-058 falls out of the WHERE clause alone, no extra
// guard needed. `tasks.title` (the section's own name, standing decision
// 8's "local title") is not part of this UPDATE's SET list at all, so it
// is left exactly as it was -- AS-059.
export async function unlinkComponentFromSection(
  sectionTaskId: string,
): Promise<MutationResult> {
  const { user } = await getCurrentUser();

  if (!user) {
    return {
      success: false,
      error: "You must be signed in to unlink a component.",
    };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const { data: sectionRow, error: sectionError } = await admin
    .from("tasks")
    .select("id, project_id")
    .eq("id", sectionTaskId)
    .is("deleted_at", null)
    .maybeSingle();

  if (sectionError || !sectionRow) {
    return { success: false, error: "Section not found." };
  }

  const authz = await authorizeArchitectureProject(
    admin,
    user.id,
    sectionRow.project_id,
  );

  if (!authz.ok) {
    return {
      success: false,
      error: "You don't have permission to unlink a component in this project.",
    };
  }

  const unlinkComponentWorkspaceSlug = authz.access.workspaceSlug;

  const { error: updateError } = await admin
    .from("tasks")
    .update({ component_id: null })
    .eq("id", sectionTaskId);

  if (updateError) {
    logger.error("unlinkComponentFromSection: update failed", {
      error: updateError,
    });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error(
      "unlinkComponentFromSection: revalidatePath failed (non-fatal)",
      { error: revalidateError },
    );
  }

  if (unlinkComponentWorkspaceSlug) {
    revalidatePortalProject(unlinkComponentWorkspaceSlug, sectionRow.project_id);
  }

  return { success: true };
}

// Mission 20260910-182104, F030 (AS-060, AS-061): delete a component.
// The `tasks.component_id` foreign key is declared `ON DELETE SET NULL`
// (see the migration that introduced `page_components` / F025), so
// deleting the `page_components` row here is the entire implementation --
// the database itself nulls out `component_id` on every instance
// (AS-061) while leaving those `tasks` rows in place, untouched otherwise
// (AS-060). No application-level cascade/cleanup code is needed or
// wanted; duplicating what the FK already guarantees would just be a
// second place for the two to drift apart.
export async function deleteComponent(
  componentId: string,
): Promise<MutationResult> {
  const { user } = await getCurrentUser();

  if (!user) {
    return {
      success: false,
      error: "You must be signed in to delete a component.",
    };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const { data: componentRow, error: componentError } = await admin
    .from("page_components")
    .select("id, project_id, projects(workspace_id, workspaces(slug))")
    .eq("id", componentId)
    .maybeSingle();

  if (
    componentError ||
    !componentRow ||
    !(componentRow as { projects?: { workspace_id?: string } }).projects
      ?.workspace_id
  ) {
    return { success: false, error: "Component not found." };
  }

  const authz = await authorizeArchitectureProject(
    admin,
    user.id,
    componentRow.project_id,
  );

  if (!authz.ok) {
    return {
      success: false,
      error: "You don't have permission to delete a component in this project.",
    };
  }

  const deleteComponentWorkspaceSlug = authz.access.workspaceSlug;

  const { error: deleteError } = await admin
    .from("page_components")
    .delete()
    .eq("id", componentId);

  if (deleteError) {
    logger.error("deleteComponent: delete failed", { error: deleteError });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("deleteComponent: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  if (deleteComponentWorkspaceSlug) {
    revalidatePortalProject(deleteComponentWorkspaceSlug, componentRow.project_id);
  }

  return { success: true };
}

// F047 (AS-159, AS-160, AS-161): reorders the components list on the
// Architecture board's Components panel. Components live in
// `page_components` (standing decision: components are NOT tasks -- see
// lib/queries/architecture.ts's `ComponentRow`/`page_components` query),
// so -- unlike reorderPages/reorderSections, which patch a subset of
// task rows by id/position pairs -- this takes the FULL ordered list of
// component ids for one project and requires it to be complete (AS-160):
// if the caller's list doesn't exactly match every live component id for
// this project, the whole reorder is rejected rather than silently
// dropping (or duplicating the position of) whichever component the
// client's stale copy of the board was missing.
export async function reorderComponents(
  projectId: string,
  componentIds: string[],
): Promise<MutationResult> {
  const parsed = reorderComponentsSchema.safeParse({ projectId, componentIds });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid reorder payload.",
    };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { success: false, error: "You must be signed in to reorder components." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const authz = await authorizeArchitectureProject(
    admin,
    user.id,
    parsed.data.projectId,
  );

  if (!authz.ok) {
    return authz.reason === "not_found"
      ? { success: false, error: "Project not found." }
      : {
          success: false,
          error: "You don't have permission to reorder components in this project.",
        };
  }

  const reorderComponentsWorkspaceSlug = authz.access.workspaceSlug;

  const { data: existingComponents, error: existingComponentsError } = await admin
    .from("page_components")
    .select("id, name, project_id")
    .eq("project_id", parsed.data.projectId);

  if (existingComponentsError) {
    logger.error("reorderComponents: failed to load components", {
      error: existingComponentsError,
    });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // AS-160: the submitted list must be exactly the full set of this
  // project's components -- no fewer, no more, no unrelated ids.
  const existingIds = new Set((existingComponents ?? []).map((row) => row.id));
  const submittedIds = new Set(parsed.data.componentIds);

  const isComplete =
    existingIds.size === submittedIds.size &&
    [...existingIds].every((id) => submittedIds.has(id));

  if (!isComplete) {
    return { success: false, error: "Component list is incomplete." };
  }

  // Defense-in-depth: even if the schema's uniqueness refinement somehow
  // passed (e.g. a direct call bypassing the schema), a submitted list with
  // duplicate ids will have a different length than the DB's row count even
  // when the Set-based completeness check above matched (a Set of
  // [A, A, B] has the same size as a Set of {A, B}).
  if (parsed.data.componentIds.length !== (existingComponents ?? []).length) {
    return {
      success: false,
      error: "Component list is incomplete or contains duplicates",
    };
  }

  // AS-161: atomically write every component's position to its index in
  // the caller-supplied order via a single upsert. onConflict "id" merges
  // into the existing rows (every id here was already confirmed to exist
  // for this project above) -- this is either all-or-nothing at the DB
  // level, unlike the previous Promise.all fan-out of independent updates,
  // which could commit a partial reorder if one call in the batch failed.
  // The generated Insert type requires `name`/`project_id` as well as the
  // conflict key even though onConflict "id" only ever updates existing
  // rows here, so those are carried over unchanged from the rows already
  // fetched above rather than re-queried.
  const existingComponentById = new Map(
    (existingComponents ?? []).map((row) => [row.id, row]),
  );
  const { error: upsertError } = await admin.from("page_components").upsert(
    parsed.data.componentIds.map((id, index) => ({
      id,
      position: index,
      name: existingComponentById.get(id)?.name ?? "",
      project_id: parsed.data.projectId,
    })),
    { onConflict: "id" },
  );

  if (upsertError) {
    logger.error("reorderComponents: upsert failed", { error: upsertError });
    return {
      success: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  try {
    revalidatePath("/w", "layout");
  } catch (revalidateError) {
    logger.error("reorderComponents: revalidatePath failed (non-fatal)", {
      error: revalidateError,
    });
  }

  if (reorderComponentsWorkspaceSlug) {
    revalidatePortalProject(reorderComponentsWorkspaceSlug, parsed.data.projectId);
  }

  return { success: true };
}
