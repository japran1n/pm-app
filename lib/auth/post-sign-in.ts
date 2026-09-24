import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import {
  listPendingInvites,
  verifiedInviteIdentity,
} from "@/lib/actions/invites";
import { getDefaultWorkspaceSlug } from "@/lib/queries/workspaces";

// Where a freshly signed-in user lands, shared by /auth/callback (PKCE
// magic link) and /auth/confirm (token_hash verifyOtp, used by invites):
//
//   1. pending invites for their verified email -> /invites (they choose
//      Accept/Decline there; nothing is activated automatically)
//   2. an active membership -> /w/<slug> (or /portal/<slug> for a client)
//   3. otherwise -> /onboarding
export async function postSignInPath(
  supabase: SupabaseClient,
  user: User,
): Promise<string> {
  const invites = await listPendingInvites(verifiedInviteIdentity(user));
  if (invites.length > 0) return "/invites";

  const defaultWorkspace = await getDefaultWorkspaceSlug(supabase, user.id);
  if (defaultWorkspace) {
    return defaultWorkspace.role === "client"
      ? `/portal/${defaultWorkspace.slug}`
      : `/w/${defaultWorkspace.slug}`;
  }
  return "/onboarding";
}
