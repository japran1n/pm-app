// Team member profile: identity (avatar/email/role) and "Projects" are
// workspace-wide and visible to any active non-guest member, same
// convention as the Team directory page one level up. "Tasks" (this
// person's currently assigned tasks across every project, reusing
// `getMyTasks` parametrized on the TARGET user rather than the caller —
// that function already takes an arbitrary `userId` argument, see
// lib/queries/my-tasks.ts, so no separate query variant was needed) is
// the one sensitive tier, gated by `canViewTeamMemberTaskDetail`
// (lib/auth/permissions.ts): always visible for your own profile,
// otherwise only to workspace owner/admin or a lead on at least one
// project the target person has a task assigned in. "Time" links out to
// the existing per-person time drill-down (time/[userId]) rather than
// re-embedding it — that page already re-derives and enforces its own
// (identical-shape) notes-visibility gate, so this page doesn't need to
// duplicate that logic, only link to it.
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock, FolderKanban, ListChecks } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/queries/workspaces";
import { getWorkspaceMembers } from "@/lib/queries/members";
import { getProjectsForMember } from "@/lib/queries/team";
import { getMyTasks } from "@/lib/queries/my-tasks";
import { getCurrentUserTimezone } from "@/lib/queries/profile";
import {
  canViewMembersList,
  canViewTeamMemberTaskDetail,
} from "@/lib/auth/permissions";
import { UserAvatar } from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default async function TeamMemberProfilePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; userId: string }>;
}) {
  const { workspaceSlug, userId: targetUserId } = await params;

  const supabase = await createClient();

  // ARCH-001: caller identity, the workspace-by-slug lookup, and the
  // caller's own membership role all come from the shared cached helper
  // (lib/queries/workspaces.ts) instead of three per-page queries.
  const ctx = await getWorkspaceContext(workspaceSlug);

  if (!ctx.user) {
    redirect("/sign-in");
  }

  if (!ctx.workspace) {
    redirect("/onboarding");
  }

  const { user, workspace, role: callerRole } = ctx;

  if (!canViewMembersList({ role: callerRole })) {
    redirect(`/w/${workspaceSlug}`);
  }

  const members = await getWorkspaceMembers(workspace.id);
  const target = members.active.find((m) => m.userId === targetUserId);

  if (!target) {
    redirect(`/w/${workspaceSlug}/team`);
  }

  const isSelf = targetUserId === user.id;
  const projects = await getProjectsForMember(workspace.id, targetUserId);

  // Only bother resolving project-lead status (a second round trip) for
  // non-self targets who aren't already owner/admin — same short-circuit
  // convention the time drill-down page uses for the identical check.
  let isProjectLeadOnResource = false;
  if (!isSelf && callerRole !== "owner" && callerRole !== "admin" && projects.length > 0) {
    const projectIds = projects.map((p) => p.projectId);
    const { data: leadRows } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", user.id)
      .eq("project_role", "lead")
      .in("project_id", projectIds);
    isProjectLeadOnResource = Boolean(leadRows && leadRows.length > 0);
  }

  const canViewTasks = canViewTeamMemberTaskDetail({
    role: callerRole,
    resourceOwnerId: targetUserId,
    callerId: user.id,
    isProjectLeadOnResource,
  });

  const timeZone = await getCurrentUserTimezone(supabase);
  const buckets = canViewTasks
    ? await getMyTasks(workspace.id, targetUserId, timeZone)
    : null;
  const assignedTasks = buckets
    ? [...buckets.overdue, ...buckets.today, ...buckets.thisWeek, ...buckets.later]
    : [];

  const label = target.name ?? target.email ?? "Unknown member";

  return (
    <div className="flex flex-col gap-6 p-6">
      <Link
        href={`/w/${workspaceSlug}/team`}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Back to Team
      </Link>

      <div className="flex items-center gap-4">
        <UserAvatar
          person={{
            id: target.userId,
            name: target.name,
            email: target.email,
            avatarUrl: target.avatarUrl,
          }}
          className="size-14"
        />
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{label}</h1>
          {target.email && (
            <p className="font-mono text-sm text-muted-foreground">{target.email}</p>
          )}
          <Badge
            variant={target.role === "owner" ? "default" : "secondary"}
            className="w-fit capitalize"
          >
            {target.role}
          </Badge>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <FolderKanban className="size-4" aria-hidden="true" />
          Projects
        </h2>
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not a member of any project.</p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="team-member-projects">
            {projects.map((project) => (
              <li key={project.projectId} className="flex items-center gap-2 text-sm">
                <Link
                  href={`/w/${workspaceSlug}/projects/${project.projectId}`}
                  className="hover:underline"
                >
                  {project.projectName}
                </Link>
                <Badge variant="outline" className="capitalize">
                  {project.projectRole}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <ListChecks className="size-4" aria-hidden="true" />
          Tasks
        </h2>
        {!canViewTasks ? (
          <p
            data-testid="tasks-restricted-notice"
            className="text-sm text-muted-foreground"
          >
            Assigned tasks are only visible to this person, workspace
            owners/admins, or a lead on one of their projects.
          </p>
        ) : assignedTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks currently assigned.</p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="team-member-tasks">
            {assignedTasks.map((task) => (
              <li key={task.id} className="flex items-center gap-2 text-sm">
                <Link
                  href={`/w/${workspaceSlug}/t/${task.projectKey ?? task.projectId}-${task.number}`}
                  className="hover:underline"
                >
                  {task.title}
                </Link>
                <span className="text-muted-foreground">{task.projectName}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Clock className="size-4" aria-hidden="true" />
          Time
        </h2>
        <Link href={`/w/${workspaceSlug}/time/${targetUserId}`}>
          <Button variant="outline" className="w-fit">
            View time report
          </Button>
        </Link>
      </div>
    </div>
  );
}
