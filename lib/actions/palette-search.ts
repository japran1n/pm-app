"use server";

// F242 (AS-460, AS-461, AS-466): the command palette's search Server
// Action — searches projects, tasks, and members in one workspace and
// returns them grouped by type (AS-460). AS-461 (selecting a result
// navigates to it) and AS-466 (empty state) are satisfied entirely by the
// client component (components/command/command-palette.tsx) rendering
// this function's result; this file's job is only to produce a
// visibility-correct, deduplicated, capped result set.
//
// Reuse, not duplication:
//   - Tasks: delegates to `searchWorkspaceTasks` (lib/queries/search.ts),
//     the SAME function the full Search page uses (F069/F070/F146/F147/
//     F223) — this file adds no second task-search implementation. That
//     function already re-checks active workspace membership
//     (F070/AS-118/AS-122) and resolves the F147 task-key exact match, so
//     typing "PM-142" into the palette finds that task first, exactly
//     like the search page.
//   - Members: delegates to `getWorkspaceMembers` (lib/queries/
//     members.ts), the SAME function the Members page uses, then filters
//     client-side... no: filters HERE, server-side, by name/email
//     substring match (F017's query has no filter of its own since the
//     full members page shows everyone). Reusing it means member name/
//     avatar resolution logic (F120/F122's `resolvePeople`) is never
//     duplicated.
//
// Visibility (this mission's repeated privilege-escalation bug class —
// F322/F323/M16's task_dependencies fix): every query below runs through
// the plain RLS-scoped session client (`createClient()`), never
// `createAdminClient()`. `searchWorkspaceTasks` already proves this for
// tasks (see that file's own header comment: `tasks_select_active_members`
// / `is_project_visible_to` enforce private-project visibility with no
// admin-client bypass to re-check). The projects query below uses the
// same session client, so `projects_select_active_members`'s identical
// `is_project_visible_to` predicate applies to it too — a private project
// the caller cannot see can never be returned by either query. Members
// are workspace-level (not project-scoped), so there is no private-project
// concept to leak there; `workspace_members_select_fellow_members` already
// scopes that read to fellow active members of the SAME workspace only.
//
// Archived projects (`projects.deleted_at`) and trashed tasks
// (`tasks.deleted_at`): excluded exactly like `lib/queries/my-tasks.ts`
// and `lib/queries/calendar.ts` — an explicit `.is("deleted_at", null)` on
// the projects query here, and `searchWorkspaceTasks`/`search_tasks`
// already exclude trashed tasks (see that file's own comments).
//
// Performance: three queries total (projects, tasks via
// `searchWorkspaceTasks`'s existing N=project-count RPC fan-out, members),
// none of them per-result-row — no N+1. Each group is capped at
// PALETTE_RESULT_CAP_PER_GROUP client-visible rows so a broad query
// doesn't render an unbounded list.
//
// Debounce/cancel of fast typing lives in the CLIENT component (an
// AbortController-free "only the latest call's result wins" guard,
// keyed by a request id) — this Server Action itself is stateless and
// simply answers whatever request it receives; ordering is the caller's
// responsibility, matching how every other debounced Server Action call
// in this codebase works (there is no queue/cancellation primitive on the
// server side for Server Actions).

import { createClient } from "@/lib/supabase/server";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import { createAdminClient } from "@/lib/supabase/admin";
import { searchWorkspaceTasks } from "@/lib/queries/search";
import { getWorkspaceMembers } from "@/lib/queries/members";
import {
  PALETTE_RESULT_CAP_PER_GROUP,
  type PaletteMemberResult,
  type PaletteProjectResult,
  type PaletteSearchResults,
  type PaletteTaskResult,
} from "@/lib/palette/palette-search-types";

export async function searchPalette(
  workspaceId: string,
  query: string,
): Promise<PaletteSearchResults> {
  const trimmed = query.trim();
  const empty: PaletteSearchResults = { projects: [], tasks: [], members: [] };

  if (!trimmed) {
    return empty;
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return empty;
  }

  // AS-460/visibility: defense-in-depth re-check, same convention as
  // `searchWorkspaceTasks`'s own F070 hardening — a caller who is only a
  // member of some OTHER, unrelated workspace gets nothing back here
  // rather than relying solely on RLS to filter every query below
  // correctly.
  const admin = createAdminClient();
  const membership = await requireActiveMembership(admin, workspaceId, user.id);

  if (!membership.ok) {
    return empty;
  }

  const likePattern = `%${trimmed.replace(/[%_]/g, "\\$&")}%`;

  const [projectsResult, tasks, members] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, key")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .ilike("name", likePattern)
      .limit(PALETTE_RESULT_CAP_PER_GROUP),
    searchWorkspaceTasks(workspaceId, trimmed),
    getWorkspaceMembers(workspaceId),
  ]);

  if (projectsResult.error) {
    throw projectsResult.error;
  }

  const projects: PaletteProjectResult[] = (projectsResult.data ?? []).map(
    (p) => ({ type: "project" as const, id: p.id, name: p.name, key: p.key }),
  );

  const cappedTasks: PaletteTaskResult[] = tasks
    .slice(0, PALETTE_RESULT_CAP_PER_GROUP)
    .map((t) => ({
      type: "task" as const,
      id: t.id,
      title: t.title,
      projectId: t.projectId,
      projectName: t.projectName,
      projectKey: t.projectKey,
      number: t.number,
    }));

  const needle = trimmed.toLowerCase();
  const matchedMembers: PaletteMemberResult[] = members.active
    .filter(
      (m) =>
        (m.name && m.name.toLowerCase().includes(needle)) ||
        (m.email && m.email.toLowerCase().includes(needle)),
    )
    .slice(0, PALETTE_RESULT_CAP_PER_GROUP)
    .map((m) => ({
      type: "member" as const,
      userId: m.userId,
      name: m.name,
      email: m.email,
      avatarUrl: m.avatarUrl,
    }));

  return { projects, tasks: cappedTasks, members: matchedMembers };
}
