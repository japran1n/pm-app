// Team directory: a grid of every active member of this workspace
// (avatar, name, role), each card linking to that member's profile page
// (./[userId]/page.tsx). Server Component, same "reachable to any active
// member, no extra page-level gate unless the assertion needs one"
// convention the Members settings page documents (that page IS
// admin/invite-gated further down for its management controls; this page
// has none — it's read-only, so it stays open to every non-guest active
// member exactly like `canViewMembersList` already governs for Settings →
// Members).
import { redirect } from "next/navigation";
import Link from "next/link";
import { Users } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceMembers } from "@/lib/queries/members";
import { canViewMembersList, type WorkspaceRole } from "@/lib/auth/permissions";
import { UserAvatar } from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";

export default async function TeamPage({
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

  // Same gate as Settings → Members (AS-222): a guest never sees the
  // workspace's roster.
  if (
    !canViewMembersList({
      role: (ownMembership?.role ?? "guest") as WorkspaceRole,
    })
  ) {
    redirect(`/w/${workspaceSlug}`);
  }

  const members = await getWorkspaceMembers(workspace.id);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Users className="size-5" aria-hidden="true" />
          Team
        </h1>
        <p className="text-sm text-muted-foreground">
          Active members of {workspace.name}.
        </p>
      </div>

      {members.active.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No active members yet"
          description="Invite teammates from Settings → Members to build your roster."
        />
      ) : (
        <div
          data-testid="team-grid"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {members.active.map((member) => {
            const label = member.name ?? member.email ?? "Unknown member";
            return (
              <Link
                key={member.id}
                href={`/w/${workspaceSlug}/team/${member.userId}`}
                data-testid={`team-card-${member.userId}`}
                className="hover-surface flex flex-col items-center gap-2 rounded-lg border bg-card p-4 text-center transition-colors"
              >
                <UserAvatar
                  person={{
                    id: member.userId,
                    name: member.name,
                    email: member.email,
                    avatarUrl: member.avatarUrl,
                  }}
                  className="size-12"
                />
                <span className="font-medium">{label}</span>
                <Badge
                  variant={member.role === "owner" ? "default" : "secondary"}
                  className="capitalize"
                >
                  {member.role}
                </Badge>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
