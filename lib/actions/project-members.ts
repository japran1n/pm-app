"use server";

// F131: project_members Server Action layer (AS-224 — "a project has an
// explicit member list; adding a member grants access").
//
// The `project_members` table and its RLS policies (SELECT: any active
// workspace member; INSERT/DELETE: workspace owner/admin or an existing
// project lead, via the `is_project_lead_or_workspace_admin` helper) were
// already shipped as F132's hard prerequisite
// (supabase/migrations/20260821140520_project_members.sql). This file adds
// only the missing piece: the Server Action layer that lets the app
// actually add/remove a member, closing the gap F132's handoff flagged
// ("F131 still needs its own Server Action / UI work").
//
// Convention: same as lib/actions/checklist.ts — Zod-validated input,
// membership/authorization re-checked server-side with the admin client
// (defense in depth per this mission's Access control answer, even though
// RLS is the real enforcement boundary), and the actual INSERT/DELETE runs
// through the RLS-respecting request-scoped client so RLS stays the
// exercised boundary, not a bypassed one.

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  addProjectMemberSchema,
  removeProjectMemberSchema,
} from "@/lib/validation/project-members";

type ProjectContext = {
  id: string;
  workspaceId: string;
};

// Resolves a project id to its owning workspace id via the admin client
// (bypasses RLS so a bad/inaccessible id reads as a clean "not found"
// rather than an ambiguous RLS-filtered empty result — same convention as
// loadChecklistItemContext in lib/actions/checklist.ts).
async function loadProjectContext(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<ProjectContext | null> {
  const { data, error } = await admin
    .from("projects")
    .select("id, workspace_id")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return { id: data.id, workspaceId: data.workspace_id };
}

// Independently re-checks "is this caller a workspace owner/admin of this
// project's workspace, OR an existing lead of this project" — the same
// predicate the `is_project_lead_or_workspace_admin` SQL helper enforces
// at the RLS layer, re-derived here with the admin client so this check
// cannot be silently defeated by a missing/incomplete RLS policy (defense
// in depth, matching lib/auth/require-membership.ts's stated rationale).
async function isProjectLeadOrWorkspaceAdmin(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const { data: membership } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (membership && (membership.role === "owner" || membership.role === "admin")) {
    return true;
  }

  const { data: leadRow } = await admin
    .from("project_members")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .eq("project_role", "lead")
    .maybeSingle();

  return Boolean(leadRow);
}

// Non-fatal cache-freshness revalidation, same convention as
// lib/actions/checklist.ts's revalidateWorkspace.
async function revalidateWorkspace(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  actionLabel: string,
) {
  const { data: workspaceRow } = await admin
    .from("workspaces")
    .select("slug")
    .eq("id", workspaceId)
    .maybeSingle();

  if (workspaceRow?.slug) {
    try {
      revalidatePath(`/w/${workspaceRow.slug}`, "layout");
    } catch (revalidateError) {
      console.error(
        `${actionLabel}: revalidatePath failed (non-fatal):`,
        revalidateError,
      );
    }
  }
}

export type AddProjectMemberResult =
  | {
      ok: true;
      data: { id: string; projectId: string; userId: string; projectRole: string };
    }
  | { ok: false; error: string };

// Adds a user to a project's explicit member list (AS-224). Only a
// workspace owner/admin, or an existing project lead, may call this
// successfully — enforced both here (defense in depth) and by the
// `project_members_insert_leads_or_admins` RLS policy, which is the real
// boundary the actual INSERT is executed against.
export async function addProjectMember(
  projectId: string,
  userId: string,
  projectRole?: "lead" | "member",
): Promise<AddProjectMemberResult> {
  const parsed = addProjectMemberSchema.safeParse({
    projectId,
    userId,
    projectRole: projectRole ?? "member",
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid member.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to add a project member." };
  }

  const admin = createAdminClient();
  const project = await loadProjectContext(admin, parsed.data.projectId);

  if (!project) {
    return { ok: false, error: "Project not found." };
  }

  const authorized = await isProjectLeadOrWorkspaceAdmin(
    admin,
    project.workspaceId,
    project.id,
    user.id,
  );

  if (!authorized) {
    return {
      ok: false,
      error: "You don't have permission to add members to this project.",
    };
  }

  // The target user must be an active member of the same workspace — a
  // project's explicit member list only ever grants access to people who
  // are already in the workspace (adding an outsider is out of scope for
  // this feature; workspace invites are a separate flow, lib/actions/invites.ts).
  const { data: targetMembership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", project.workspaceId)
    .eq("user_id", parsed.data.userId)
    .eq("status", "active")
    .maybeSingle();

  if (!targetMembership) {
    return {
      ok: false,
      error: "That user is not an active member of this workspace.",
    };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("project_members")
    .insert({
      project_id: parsed.data.projectId,
      user_id: parsed.data.userId,
      project_role: parsed.data.projectRole,
      added_by: user.id,
    })
    .select("id, project_id, user_id, project_role")
    .single();

  if (insertError || !inserted) {
    // Unique constraint (project_members_unique_project_user) maps to a
    // specific, field-level message per the Clarified implementation's
    // Failure handling answer, rather than a generic 500.
    if (insertError?.code === "23505") {
      return { ok: false, error: "That user is already a member of this project." };
    }
    console.error("addProjectMember: insert failed:", insertError);
    return { ok: false, error: "Something went wrong. Please try again in a moment." };
  }

  await revalidateWorkspace(admin, project.workspaceId, "addProjectMember");

  return {
    ok: true,
    data: {
      id: inserted.id,
      projectId: inserted.project_id,
      userId: inserted.user_id,
      projectRole: inserted.project_role,
    },
  };
}

export type RemoveProjectMemberResult =
  | { ok: true; data: { projectId: string; userId: string } }
  | { ok: false; error: string };

// Removes a user from a project's explicit member list. Same authorization
// as addProjectMember (owner/admin or existing lead); RLS
// (`project_members_delete_leads_or_admins`) is the real boundary.
export async function removeProjectMember(
  projectId: string,
  userId: string,
): Promise<RemoveProjectMemberResult> {
  const parsed = removeProjectMemberSchema.safeParse({ projectId, userId });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid member.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to remove a project member." };
  }

  const admin = createAdminClient();
  const project = await loadProjectContext(admin, parsed.data.projectId);

  if (!project) {
    return { ok: false, error: "Project not found." };
  }

  const authorized = await isProjectLeadOrWorkspaceAdmin(
    admin,
    project.workspaceId,
    project.id,
    user.id,
  );

  if (!authorized) {
    return {
      ok: false,
      error: "You don't have permission to remove members from this project.",
    };
  }

  const { data: deletedRows, error: deleteError } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", parsed.data.projectId)
    .eq("user_id", parsed.data.userId)
    .select("id");

  if (deleteError || !deletedRows || deletedRows.length === 0) {
    console.error("removeProjectMember: delete failed:", deleteError);
    return { ok: false, error: "Something went wrong. Please try again in a moment." };
  }

  await revalidateWorkspace(admin, project.workspaceId, "removeProjectMember");

  return {
    ok: true,
    data: { projectId: parsed.data.projectId, userId: parsed.data.userId },
  };
}
