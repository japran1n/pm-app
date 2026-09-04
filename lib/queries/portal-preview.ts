// F024 (missions/20260903-portal, AS-052): the picker's own data --
// "which active clients could an owner/admin preview as". Uses the admin
// client deliberately: this is the ONE portal-adjacent read in this
// feature that is NOT subject to the client's own RLS (there is no
// client session yet -- the whole point of this page is to pick one), and
// it is gated by the caller already being re-checked as workspace
// owner/admin (lib/actions/portal-preview.ts's requireWorkspaceAdmin, and
// this query's own page-level guard) before this ever runs -- the same
// "admin client resolves a display value / list for an already-permitted
// caller" justification lib/queries/members.ts and lib/queries/people.ts
// give for their own admin-client reads.
import { createAdminClient } from "@/lib/supabase/admin";
import { resolvePeople } from "@/lib/queries/people";
import { logger } from "@/lib/observability/logger";

export type PreviewableClient = {
  userId: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
};

export async function getPreviewableClients(
  workspaceId: string,
): Promise<PreviewableClient[]> {
  const admin = createAdminClient();

  const { data: rows, error } = await admin
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("role", "client")
    .eq("status", "active");

  if (error) {
    logger.error("getPreviewableClients: fetch failed", { error });
    return [];
  }

  const userIds = (rows ?? [])
    .map((row) => row.user_id)
    .filter((id): id is string => Boolean(id));

  if (userIds.length === 0) return [];

  const people = await resolvePeople(userIds);

  return userIds.map((userId) => {
    const person = people.get(userId);
    return {
      userId,
      email: person?.email ?? null,
      name: person?.name ?? null,
      avatarUrl: person?.avatarUrl ?? null,
    };
  });
}
