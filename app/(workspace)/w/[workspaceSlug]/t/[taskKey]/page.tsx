// F246 (AS-473, AS-474, AS-477): the canonical, shareable per-task URL —
// `/w/[workspaceSlug]/t/[taskKey]` (e.g. "/w/acme/t/PM-142"). This is the
// ONE URL notifications, emails, and the command palette (F242) should all
// point at going forward; it supersedes those surfaces' prior use of the
// board's own `?taskId=` search param (see board.tsx, F208/F233's
// `?taskId=` deep-link) as the CANONICAL, human-shareable form, but does
// not remove `?taskId=`: this route's whole implementation IS a thin
// resolve-then-redirect onto that exact existing contract
// (`/w/{slug}/projects/{projectId}/board?taskId={id}`), so the two
// coexist — this route never re-implements task-detail rendering, it only
// adds a stable, key-based (not id-based) address that survives without
// the caller needing to already know the task's project id.
//
// Server Component (Clarified implementation: "Server Component for data
// loading") — no interactive surface here at all, this page's entire job
// is resolve-and-redirect/notFound.
//
// AS-473 ("every task has its own URL that opens the task directly"):
// satisfied by this route existing for any live, visible task — the key
// segment is parsed by the exact same lib/tasks/task-key.ts parser F147's
// workspace search and F242's command palette already use, so a key
// copied from either of those surfaces resolves here unchanged.
//
// AS-474 ("opened in a fresh tab renders the task, not a blank page or a
// redirect to the board" [without opening it]): the `redirect()` target
// below is the EXACT `?taskId=` URL `tests/unit/board-taskid-deeplink.test.tsx`
// already proves opens the real TaskDetailSheet on mount (via
// useTaskDetailSheet().openTask, fetching through the real getTaskDetail
// Server Action) — so a fresh tab lands on a board that immediately opens
// the task's sheet, never a bare board with nothing selected.
//
// AS-477 ("a task URL the caller cannot access returns not-found, never
// revealing existence"): every failure path below — an unparseable key, a
// project key that doesn't resolve in this workspace, a task number that
// doesn't resolve in that project, a soft-deleted task/project, OR a task
// whose PRIVATE project the caller cannot see — calls the identical
// `notFound()`. No branch here or in `getTaskDetail` distinguishes
// "doesn't exist" from "exists but hidden": `resolveTaskIdByKey`
// (lib/queries/tasks.ts) reads through the plain RLS-scoped client, whose
// `is_project_visible_to`-gated select policies
// (20260821140526_project_visibility_rls_sweep.sql) already collapse
// those cases to "no row" at the database layer, and `getTaskDetail`
// (lib/actions/tasks.ts) re-runs the F323-hardened
// `isProjectVisibleToCaller` check independently and returns the SAME
// "Task not found." error for a truly missing task as for one the caller
// may not see. This page treats any `!result.ok` from `getTaskDetail`
// as `notFound()` — it never inspects or surfaces the error message
// itself, so a future change to that message's wording can't leak a
// distinction here either.
//
// This route sits inside the workspace layout
// (app/(workspace)/w/[workspaceSlug]/layout.tsx), so an unauthenticated
// caller or a caller who isn't an active member of this workspace at all
// is already redirected to /sign-in or 404'd one level up — no duplicate
// gate needed here, same convention as the board/list pages.

import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getTaskDetail } from "@/lib/actions/tasks";
import { resolveTaskIdByKey } from "@/lib/queries/tasks";
import { parseTaskKeyQuery } from "@/lib/tasks/task-key";

export default async function TaskDeepLinkPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; taskKey: string }>;
}) {
  const { workspaceSlug, taskKey } = await params;

  const parsedKey = parseTaskKeyQuery(decodeURIComponent(taskKey));
  if (!parsedKey) {
    notFound();
  }

  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) {
    notFound();
  }

  const resolved = await resolveTaskIdByKey(
    workspace.id,
    parsedKey.projectKey,
    parsedKey.taskNumber,
  );

  if (!resolved) {
    notFound();
  }

  // Re-resolves the FULL task detail through the same Server Action the
  // board's `?taskId=` deep-link already calls — this is the single,
  // authoritative visibility check (F323-hardened, admin-client-backed,
  // independent of the RLS-scoped lookup above) this route relies on
  // before ever redirecting the caller anywhere. See file-header comment.
  const detail = await getTaskDetail(resolved.taskId);
  if (!detail.ok) {
    notFound();
  }

  redirect(
    `/w/${workspaceSlug}/projects/${resolved.projectId}/board?taskId=${resolved.taskId}`,
  );
}
