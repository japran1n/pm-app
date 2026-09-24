"use server";

import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/current-user";
import {
  acceptInviteForUser,
  declineInviteForUser,
  verifiedInviteIdentity,
} from "@/lib/actions/invites";
import { inviteResponseSchema } from "@/lib/validation/auth";
import type { ActionOutcome } from "@/lib/actions/authz";

// The only way a pending workspace invite becomes an active membership: the
// invitee clicks Accept on /invites. The identity (user id + verified email)
// always comes from the server-verified session — the form only carries the
// invite id, and lib/actions/invites.ts re-checks that the row is addressed
// to that email before touching it.

export type InviteResponseResult = ActionOutcome;

function parseInviteId(formData: FormData): string | null {
  const parsed = inviteResponseSchema.safeParse({
    inviteId: formData.get("inviteId"),
  });
  return parsed.success ? parsed.data.inviteId : null;
}

export async function acceptInvite(
  _prevState: InviteResponseResult | null,
  formData: FormData,
): Promise<InviteResponseResult> {
  const inviteId = parseInviteId(formData);
  if (!inviteId) return { ok: false, error: "Invalid invite." };

  const { user } = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const result = await acceptInviteForUser(inviteId, verifiedInviteIdentity(user));
  if (!result.ok) return { ok: false, error: result.error };

  if (!result.workspaceSlug) redirect("/onboarding");
  redirect(
    result.role === "client"
      ? `/portal/${result.workspaceSlug}`
      : `/w/${result.workspaceSlug}`,
  );
}

export async function declineInvite(
  _prevState: InviteResponseResult | null,
  formData: FormData,
): Promise<InviteResponseResult> {
  const inviteId = parseInviteId(formData);
  if (!inviteId) return { ok: false, error: "Invalid invite." };

  const { user } = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const result = await declineInviteForUser(inviteId, verifiedInviteIdentity(user));
  if (!result.ok) return { ok: false, error: result.error };

  // Re-render /invites: it lists whatever is left, or moves on when empty.
  redirect("/invites");
}
