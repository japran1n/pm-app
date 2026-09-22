"use server";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/observability/logger";


// F263 (AS-510): favourite/unfavourite a project. Toggle-style Server
// Action pair, following this mission's established
// optimistic-with-rollback convention (lib/actions/watchers.ts's
// watchTask/unwatchTask is the closest sibling: a self-serve, own-row
// preference with no canWrite/role gate beyond "you're signed in and this
// project is visible to you" -- favouriting, like watching, is a personal
// affordance, not a content mutation).
//
// The write goes through the caller's own authenticated session (never the
// admin client), per this table's own migration header comment --
// `project_favorites_insert_own` / `project_favorites_delete_own` already
// allow a user to write their own row, and inserting/deleting a favourite
// for a project the caller cannot even see is naturally rejected by the
// INSERT's FK (project_id must exist) plus this Server Action's own
// membership/visibility check below (defense in depth, same AS-143
// convention every other self-serve action in this codebase follows) --
// RLS alone would allow inserting a favourite for a project outside the
// caller's visibility (own-row RLS has no project-visibility predicate, by
// design per the migration's header comment), so the visibility check here
// is not just defense in depth, it is the ONLY thing preventing a caller
// from favouriting a project they cannot see.

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { toggleProjectFavoriteSchema } from "@/lib/validation/favorites";
import type { ActionResult } from "@/lib/actions/authz";

export type ToggleProjectFavoriteResult = ActionResult<{ projectId: string; isFavorite: boolean }>;

async function resolveVisibleProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<
  { ok: true; workspaceSlug: string | null } | { ok: false; error: string }
> {
  // RLS's `projects_select_active_members` (already visibility-scoped per
  // F132/F134/F134's is_project_visible_to_row) is the single source of
  // truth for "can this caller see this project" -- no second copy of that
  // predicate here, same "no second source of truth" convention this
  // mission's clarifications keep calling for. A row coming back at all
  // means the caller can see it; nothing back means not-visible,
  // not-found, or soft-deleted -- all collapsed to the same generic error,
  // same as the rest of this codebase's "don't leak which case it was"
  // convention (AS-144's cousin at the row level).
  //
  // F046: also selects the owning workspace's slug (via the same,
  // already-RLS-scoped row) purely so the caller below can revalidate the
  // sidebar's own path after a favourite/unfavourite write -- same
  // `revalidatePath(\`/w/${slug}\`, "layout")` convention createProject/
  // editProject/archiveProject/restoreProject in lib/actions/projects.ts
  // already use, so a server-rendered `isFavorite` prop this write just
  // changed doesn't linger stale until the next unrelated navigation.
  const { data, error } = await supabase
    .from("projects")
    .select("id, workspaces(slug)")
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: "Project not found." };
  }

  const workspaceSlug = Array.isArray(data.workspaces)
    ? (data.workspaces[0]?.slug ?? null)
    : ((data.workspaces as { slug: string } | null)?.slug ?? null);

  return { ok: true, workspaceSlug };
}

function revalidateSidebar(workspaceSlug: string | null, actionName: string) {
  if (!workspaceSlug) return;
  try {
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  } catch (revalidateError) {
    // Same non-fatal cache-freshness rationale as lib/actions/projects.ts:
    // revalidatePath throws outside an active request/render context (e.g.
    // this action invoked from a test harness). The write itself already
    // succeeded, so this is not an action failure.
    logger.error(`${actionName}: revalidatePath failed (non-fatal)`, {
      error: revalidateError,
    });
  }
}

// Favourites a project (idempotent: already-favourited is still ok:true,
// matching watchTask's own idempotent-no-op convention).
export async function favoriteProject(
  projectId: string,
): Promise<ToggleProjectFavoriteResult> {
  const parsed = toggleProjectFavoriteSchema.safeParse({ projectId });
  if (!parsed.success) {
    return { ok: false, error: "Invalid project." };
  }

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const visible = await resolveVisibleProject(supabase, parsed.data.projectId);
  if (!visible.ok) {
    return visible;
  }

  // NOTE (SB-040 fix): project_favorites deliberately has no UPDATE policy
  // (own-row SELECT/INSERT/DELETE only -- see this table's migration header
  // comment: it is a membership fact, never updated). A plain
  // `.upsert(..., { onConflict })` resolves to `INSERT ... ON CONFLICT DO
  // UPDATE`, and Postgres evaluates the UPDATE branch against the missing
  // UPDATE policy, so RLS denies re-favouriting an already-favourited
  // project. `ignoreDuplicates: true` resolves to `DO NOTHING` instead,
  // which needs no UPDATE policy and preserves the intended idempotent
  // no-op semantics documented above.
  const { error } = await supabase
    .from("project_favorites")
    .upsert(
      { user_id: user.id, project_id: parsed.data.projectId },
      { onConflict: "user_id,project_id", ignoreDuplicates: true },
    );

  if (error) {
    logger.error("favoriteProject: write failed", { error: error });
    return { ok: false, error: "Could not favourite this project." };
  }

  revalidateSidebar(visible.workspaceSlug, "favoriteProject");

  return { ok: true, data: { projectId: parsed.data.projectId, isFavorite: true } };
}

// Unfavourites a project (idempotent: not-currently-favourited is still
// ok:true).
export async function unfavoriteProject(
  projectId: string,
): Promise<ToggleProjectFavoriteResult> {
  const parsed = toggleProjectFavoriteSchema.safeParse({ projectId });
  if (!parsed.success) {
    return { ok: false, error: "Invalid project." };
  }

  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const { error } = await supabase
    .from("project_favorites")
    .delete()
    .eq("user_id", user.id)
    .eq("project_id", parsed.data.projectId);

  if (error) {
    logger.error("unfavoriteProject: write failed", { error: error });
    return { ok: false, error: "Could not remove this favourite." };
  }

  // F046: no visibility gate needed here (unlike favoriteProject) -- this
  // is a plain own-row delete, harmless even if the project has since
  // become invisible to the caller -- but the sidebar path still needs
  // revalidating so a re-sync away in ProjectNavList/ProjectFavoriteButton
  // sees the server's fresh `isFavorite: false` rather than a stale
  // cached render. Best-effort lookup only: if the project row is gone or
  // not visible, there's nothing to revalidate.
  const { data: projectRow } = await supabase
    .from("projects")
    .select("workspaces(slug)")
    .eq("id", parsed.data.projectId)
    .maybeSingle();
  const workspaceSlug = projectRow
    ? Array.isArray(projectRow.workspaces)
      ? (projectRow.workspaces[0]?.slug ?? null)
      : ((projectRow.workspaces as { slug: string } | null)?.slug ?? null)
    : null;
  revalidateSidebar(workspaceSlug, "unfavoriteProject");

  return {
    ok: true,
    data: { projectId: parsed.data.projectId, isFavorite: false },
  };
}
