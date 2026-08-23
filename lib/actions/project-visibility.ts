import type { createAdminClient } from "@/lib/supabase/admin";
import type { WorkspaceRole } from "@/lib/auth/permissions";

export type ProjectVisibility = "workspace" | "private";

// F322/F323 (AS-227, AS-228, AS-229): re-implements
// `public.is_project_visible_to`'s rule
// (supabase/migrations/20260821140526_project_visibility_rls_sweep.sql) in
// application code, for the CALLER themselves. Every task-scoped action
// across lib/actions/tasks.ts and its siblings (checklist.ts, comments.ts,
// dependencies.ts, attachments.ts, watchers.ts, time-entries.ts,
// comment-reactions.ts, purge.ts) reads/writes through the ADMIN client,
// which bypasses RLS entirely by design — so the visibility check RLS would
// otherwise provide has to be re-run explicitly here. This is the ONE
// shared helper every one of those call sites uses, so the rule lives in
// exactly one place. A project is visible to a caller when it is
// 'workspace'-visible, OR the caller is a workspace owner/admin, OR the
// caller has an explicit `project_members` row for that project.
export async function isProjectVisibleToCaller(
  admin: ReturnType<typeof createAdminClient>,
  context: { projectId: string; visibility: ProjectVisibility },
  userId: string,
  role: WorkspaceRole,
): Promise<boolean> {
  if (context.visibility === "workspace") return true;
  if (role === "owner" || role === "admin") return true;

  const { data } = await admin
    .from("project_members")
    .select("user_id")
    .eq("project_id", context.projectId)
    .eq("user_id", userId)
    .maybeSingle();

  return !!data;
}
