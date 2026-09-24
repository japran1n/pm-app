import Link from "next/link";
import { redirect } from "next/navigation";

import { PendingInvites } from "@/components/auth/pending-invites";
import { Logo } from "@/components/brand/logo";
import {
  listPendingInvites,
  verifiedInviteIdentity,
} from "@/lib/actions/invites";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDefaultWorkspaceSlug } from "@/lib/queries/workspaces";

// Pending workspace invites for the signed-in user's verified email. An
// invite is never activated just by signing in (SEC audit 2026-09-24): the
// user lands here after sign-in whenever something is pending and chooses
// Accept or Decline per invite. With nothing pending this page steps aside
// to /onboarding, which routes on as before.
export default async function InvitesPage() {
  const { supabase, user } = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const invites = await listPendingInvites(verifiedInviteIdentity(user));
  if (invites.length === 0) redirect("/onboarding");

  // A user who already belongs to a workspace can leave the decision for
  // later and carry on where they were.
  const defaultWorkspace = await getDefaultWorkspaceSlug(supabase, user.id);
  const continueHref = defaultWorkspace
    ? defaultWorkspace.role === "client"
      ? `/portal/${defaultWorkspace.slug}`
      : `/w/${defaultWorkspace.slug}`
    : null;

  return (
    <main className="flex min-h-svh flex-1 flex-col items-center justify-center gap-10 p-6">
      <Logo className="h-5 w-auto text-foreground" />

      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {invites.length === 1
              ? `You've been invited to ${invites[0].workspaceName}`
              : "You've been invited"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Accept to join, or decline if you weren&apos;t expecting this.
          </p>
        </div>

        <PendingInvites
          invites={invites.map(({ id, workspaceName, role }) => ({
            id,
            workspaceName,
            role,
          }))}
        />

        {continueHref && (
          <Link
            href={continueHref}
            className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Not now
          </Link>
        )}
      </div>
    </main>
  );
}
