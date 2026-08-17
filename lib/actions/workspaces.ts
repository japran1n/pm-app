"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createWorkspaceSchema,
  slugify,
  findAvailableSlug,
} from "@/lib/validation/workspaces";

export type CreateWorkspaceResult =
  | { ok: true; slug: string }
  | { ok: false; error: string };

// Creates a workspace and makes the calling user its owner (AS-005, AS-006).
//
// Ordering / rollback strategy: `workspace_members` has no client-facing
// INSERT policy (see supabase/migrations/20260817222822_rls_workspaces.sql —
// intentionally left to whichever feature bootstraps the first owner row),
// so both inserts here go through the secret-key admin client, which
// bypasses RLS by design (AS-140: never exposed to the browser — this file
// only runs on the server as a Server Action).
//
// Because there's no real multi-table transaction available through the
// Supabase client libraries (no client-side `BEGIN`/`COMMIT`, and adding a
// Postgres RPC function for a two-insert bootstrap was judged more
// machinery than this flow needs), the approach chosen is: insert the
// workspace, then insert the membership row; if the membership insert fails,
// explicitly delete the just-created workspace row (manual compensating
// action) so no orphaned, memberless workspace is left behind. This is
// documented here rather than silently caught, per the handoff.
export async function createWorkspace(
  _prevState: CreateWorkspaceResult | null,
  formData: FormData,
): Promise<CreateWorkspaceResult> {
  const parsed = createWorkspaceSchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid workspace name.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to create a workspace." };
  }

  const admin = createAdminClient();

  const baseSlug = slugify(parsed.data.name);
  const slug = await findAvailableSlug(admin, baseSlug);

  const { data: workspace, error: workspaceError } = await admin
    .from("workspaces")
    .insert({ name: parsed.data.name, slug })
    .select("id, slug")
    .single();

  if (workspaceError || !workspace) {
    console.error("createWorkspace: workspace insert failed:", workspaceError);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { error: memberError } = await admin.from("workspace_members").insert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: "owner",
    status: "active",
  });

  if (memberError) {
    console.error(
      "createWorkspace: owner membership insert failed, rolling back workspace:",
      memberError,
    );
    // Compensating delete: avoid leaving an orphaned, memberless workspace.
    const { error: rollbackError } = await admin
      .from("workspaces")
      .delete()
      .eq("id", workspace.id);
    if (rollbackError) {
      console.error(
        "createWorkspace: rollback delete also failed — orphaned workspace",
        workspace.id,
        rollbackError,
      );
    }
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  redirect(`/w/${workspace.slug}`);
}
