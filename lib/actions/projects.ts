"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createProjectSchema } from "@/lib/validation/projects";
import { requireActiveMembership } from "@/lib/auth/require-membership";

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
    console.error("createProject: insert failed:", insertError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
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
      console.error(
        "createProject: revalidatePath failed (non-fatal):",
        revalidateError,
      );
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
