import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceMembers } from "@/lib/queries/members";
import {
  canManageMembers,
  canViewMembersList,
  type WorkspaceRole,
} from "@/lib/auth/permissions";
import { logger } from "@/lib/observability/logger";
import { InviteMemberForm } from "@/components/invite-member-form";
import { RevokeInviteButton } from "@/components/revoke-invite-button";
import { MemberRoleSelect } from "@/components/member-role-select";
import { RemoveMemberButton } from "@/components/remove-member-button";
import {
  TransferOwnershipDialog,
  type TransferOwnershipCandidate,
} from "@/components/transfer-ownership-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
// F122 (AS-204, AS-214): active members now render through the shared
// avatar component instead of this page's own inline initials span
// (pending invites keep the plain email-initial span below — an invite
// has no user id yet, so there's nothing for AS-204's colour hash to key
// on until it's accepted and becomes a real member row).
import { UserAvatar } from "@/components/user-avatar";

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

  const { data: ownMembership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  // F134 (AS-222): a guest cannot see the workspace members list at all —
  // deny, not merely hide, so this page also rejects direct navigation.
  // The layout guard above only proves active workspace membership, not
  // non-guest membership, so this page needs its own gate the way F132's
  // project pages do. Same "single source of truth" predicate the UI
  // gating and any future server-side re-check both call (AS-230).
  if (
    !canViewMembersList({
      role: (ownMembership?.role ?? "guest") as WorkspaceRole,
    })
  ) {
    redirect(`/w/${workspaceSlug}`);
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
    logger.error("MembersPage: failed to load members", { error: error });
    loadError = true;
  }

  const canInvite =
    ownMembership?.role === "owner" || ownMembership?.role === "admin";
  // AS-218 (F129, superseding mission-1's owner-only AS-014/AS-015): owner
  // OR admin may change another member's role — same line as `canInvite`,
  // via the shared `canManageMembers` predicate (AS-230: one permission
  // helper backs both UI gating and the server-side re-check in
  // `changeMemberRole`).
  const canChangeRoles = canManageMembers({
    role: (ownMembership?.role ?? "guest") as WorkspaceRole,
  });

  // F134 (AS-220): the invite-as-guest UI needs a project list to scope the
  // invite to. RLS-scoped select is sufficient here (an owner/admin — the
  // only caller who reaches the invite form below — sees every
  // workspace-visible project regardless of visibility, per is_project_
  // visible_to's owner/admin bypass).
  const { data: inviteableProjects } = canInvite
    ? await supabase
        .from("projects")
        .select("id, name")
        .eq("workspace_id", workspace.id)
        .is("deleted_at", null)
        .order("name", { ascending: true })
    : { data: [] };

  // F130 (AS-233, AS-234): only the workspace owner sees the transfer
  // control at all — gated the same way `canDeleteWorkspace` gates
  // DeleteWorkspaceDialog, not merely a disabled control for anyone else.
  // Candidates are built only from `members.active` (already excludes
  // pending invites — AS-234) and exclude the caller's own row (there is
  // nothing to transfer to yourself).
  const isOwner = ownMembership?.role === "owner";
  const transferCandidates: TransferOwnershipCandidate[] =
    isOwner && members
      ? members.active
          .filter((member) => member.userId !== user.id)
          .map((member) => ({
            userId: member.userId,
            label: member.name ?? member.email ?? "Unknown member",
          }))
      : [];

  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Members</h1>
        <p className="text-sm text-muted-foreground">
          Active members and pending invites for {workspace.name}.
        </p>
      </div>

      {isOwner && members && (
        <div>
          <TransferOwnershipDialog
            workspaceId={workspace.id}
            candidates={transferCandidates}
          />
        </div>
      )}

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
        <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
          <h2 className="text-sm font-medium">Invite a teammate</h2>
          <InviteMemberForm
            workspaceId={workspace.id}
            projects={inviteableProjects ?? []}
          />
        </section>
      )}

      {members && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Active members</h2>
            <Badge variant="secondary">{members.active.length}</Badge>
          </div>
          {members.active.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active members yet.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Role</TableHead>
                    {canInvite && (
                      <TableHead className="w-px">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.active.map((member) => {
                    const label = member.name ?? member.email ?? "Unknown member";

                    return (
                      <TableRow key={member.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <UserAvatar
                              person={{
                                id: member.userId,
                                name: member.name,
                                email: member.email,
                                avatarUrl: member.avatarUrl,
                              }}
                            />
                            <div className="flex flex-col">
                              <span className="font-medium">{label}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {canChangeRoles && member.role !== "owner" ? (
                            <MemberRoleSelect
                              workspaceId={workspace.id}
                              workspaceMemberId={member.id}
                              role={member.role}
                              memberLabel={label}
                            />
                          ) : (
                            <Badge
                              variant={member.role === "owner" ? "default" : "secondary"}
                              className="capitalize"
                            >
                              {member.role}
                            </Badge>
                          )}
                        </TableCell>
                        {canInvite && (
                          <TableCell>
                            {/* AS-016/AS-018: owner/admin can remove any active
                                member; the sole owner is rejected server-side
                                by `removeMember` regardless of what's rendered
                                here. */}
                            <RemoveMemberButton
                              workspaceId={workspace.id}
                              workspaceMemberId={member.id}
                              memberLabel={label}
                            />
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}

      {members && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Pending invites</h2>
            <Badge variant="secondary">{members.pending.length}</Badge>
          </div>
          {members.pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pending invites.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
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
                  {members.pending.map((invite) => {
                    const initial = invite.invitedEmail.charAt(0).toUpperCase();

                    return (
                      <TableRow key={invite.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <span
                              aria-hidden="true"
                              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
                            >
                              {initial}
                            </span>
                            {invite.invitedEmail}
                          </div>
                        </TableCell>
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
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
