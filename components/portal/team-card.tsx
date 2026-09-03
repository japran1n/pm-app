// F006 (missions/20260903-portal): the right rail's "Your team" card --
// `project_members` (`getPortalTeam`, lib/queries/portal.ts), avatar +
// name + role label per member, per this feature's own clarified spec.
import { UserAvatar } from "@/components/user-avatar";
import type { PortalTeamMember } from "@/lib/queries/portal";

export function TeamCard({ members }: { members: PortalTeamMember[] }) {
  return (
    <div
      data-testid="team-card"
      className="flex flex-col gap-3 rounded-lg border border-border p-5"
    >
      <h2 className="text-sm font-semibold">Your team</h2>
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No team members assigned to this project yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {members.map((member) => (
            <li key={member.id} className="flex items-center gap-2">
              <UserAvatar
                person={{ id: member.id, name: member.name, avatarUrl: member.avatarUrl }}
                size="sm"
              />
              <div className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-sm font-medium">
                  {member.name ?? "Someone at the agency"}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {member.roleLabel}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
