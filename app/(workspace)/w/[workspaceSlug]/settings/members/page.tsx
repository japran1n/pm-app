import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceMembers } from "@/lib/queries/members";
import { InviteMemberForm } from "@/components/invite-member-form";
import { RevokeInviteButton } from "@/components/revoke-invite-button";
import { MemberRoleSelect } from "@/components/member-role-select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// F017 (AS-023): lists a workspace's active members and pending invites in
// two separate sections. Server Component — primary content is rendered
// into the initial HTML (AS-155); the only interactive part (the invite
// form) is its own small Client Component.
//
// Access: relies on the workspace-membership layout guard above this route
// (app/(workspace)/w/[workspaceSlug]/layout.tsx, F010/F023) — reaching this
// page at all already means the caller is an active member of this
// workspace, per the clarified spec ("no duplicate page-level gate unless
// the assigned assertion specifically requires role-gating beyond
// membership" — AS-023 doesn't). The invite form is additionally gated to
// owner/admin roles here (UI-only convenience gate); the actual permission
// check lives server-side in `inviteMember` itself (AS-143 convention), so
// hiding/showing the form here is not a security boundary.
export default async function MembersPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  // Defensive fallback only — the layout guard above already redirects
  // away when the workspace can't be resolved for this caller.
  if (!workspace) {
    redirect("/onboarding");
  }

  let members: Awaited<ReturnType<typeof getWorkspaceMembers>> | null = null;
  let loadError = false;

  try {
    members = await getWorkspaceMembers(workspace.id);
  } catch (error) {
    // Real error logging: this repo has no Sentry (or other error-tracking
    // SDK) wired up yet — checked package.json and the repo tree — so this
    // follows every other page/action's existing convention of
    // console.error rather than introducing a new dependency out of scope
    // for this feature.
    console.error("MembersPage: failed to load members:", error);
    loadError = true;
  }

  const { data: ownMembership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  const canInvite =
    ownMembership?.role === "owner" || ownMembership?.role === "admin";
  // AS-014/AS-015: only the owner may change another member's role — a
  // stricter gate than `canInvite` (which also allows admins).
  const canChangeRoles = ownMembership?.role === "owner";

  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Members</h1>
        <p className="text-sm text-muted-foreground">
          Active members and pending invites for {workspace.name}.
        </p>
      </div>

      {loadError && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p>Something went wrong loading members. Please try again.</p>
          <a href={`/w/${workspaceSlug}/settings/members`} className="underline">
            Retry
          </a>
        </div>
      )}

      {members && canInvite && (
        <section className="flex flex-col gap-3">
          <InviteMemberForm workspaceId={workspace.id} />
        </section>
      )}

      {members && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Active members
          </h2>
          {members.active.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active members yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.active.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {member.name ?? member.email ?? "Unknown member"}
                        </span>
                        {member.name && member.email && (
                          <span className="text-xs text-muted-foreground">
                            {member.email}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {canChangeRoles && member.role !== "owner" ? (
                        <MemberRoleSelect
                          workspaceId={workspace.id}
                          workspaceMemberId={member.id}
                          role={member.role}
                          memberLabel={member.name ?? member.email ?? "This member"}
                        />
                      ) : (
                        <Badge variant="secondary" className="capitalize">
                          {member.role}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}

      {members && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Pending invites
          </h2>
          {members.pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pending invites.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  {canInvite && (
                    <TableHead className="w-px">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.pending.map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell>{invite.invitedEmail}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {invite.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">Invited</Badge>
                    </TableCell>
                    {canInvite && (
                      <TableCell>
                        <RevokeInviteButton
                          workspaceId={workspace.id}
                          workspaceMemberId={invite.id}
                          invitedEmail={invite.invitedEmail}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}
    </div>
  );
}
