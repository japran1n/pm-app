// Shared helper for resolving assignee display names for a batch of tasks
// (F053: AS-085's "assignee" column).
//
// Same constraint documented at length in `getWorkspaceMembers`
// (lib/queries/members.ts): there is no public.profiles/users table in
// this schema, so the only server-side way to turn a `tasks.assignee_id`
// (auth user id) into a display name is the Auth Admin API via the
// secret-key admin client (never shipped to the browser, AS-140).
//
// Unlike `getWorkspaceMembers`, which resolves one name per *member* row,
// this resolves one name per *unique* assignee id actually present in the
// task list being rendered — a list view with many tasks assigned to the
// same person makes one Admin API call for that person, not one per task
// row.
import { createAdminClient } from "@/lib/supabase/admin";

export async function resolveAssigneeNames(
  assigneeIds: (string | null)[],
): Promise<Map<string, string>> {
  const uniqueIds = Array.from(
    new Set(assigneeIds.filter((id): id is string => Boolean(id))),
  );

  const names = new Map<string, string>();
  if (uniqueIds.length === 0) return names;

  const admin = createAdminClient();

  await Promise.all(
    uniqueIds.map(async (id) => {
      try {
        const { data, error } = await admin.auth.admin.getUserById(id);
        if (error) {
          console.error("resolveAssigneeNames: getUserById failed for", id, error);
          return;
        }
        const user = data?.user;
        if (!user) return;
        const displayName =
          (user.user_metadata?.full_name as string | undefined) ??
          user.email ??
          null;
        if (displayName) names.set(id, displayName);
      } catch (lookupError) {
        console.error("resolveAssigneeNames: getUserById threw for", id, lookupError);
      }
    }),
  );

  return names;
}
