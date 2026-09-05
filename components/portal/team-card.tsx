// F006 (missions/20260903-portal): the right rail's "Your team" card --
// `project_members` (`getPortalTeam`, lib/queries/portal.ts), avatar +
// name + role label per member, per this feature's own clarified spec.
//
// F112 (six-star review Part 0/D): a real card per person -- name,
// project ROLE (job title, from `project_roles`), one line on what they
// own (`note`), and how to reach them (email). Team lead first is
// `getPortalTeam`'s own sort order, not this component's -- this just
// renders in the order it receives.
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
        <ul className="flex flex-col gap-4">
          {members.map((member) => (
            <li key={member.id} className="flex items-start gap-2">
              <UserAvatar
                person={{ id: member.userId, name: member.name, avatarUrl: member.avatarUrl }}
                size="sm"
              />
              <div className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-sm font-medium">
                  {member.name ?? "Someone at the agency"}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {member.roleLabel}
                </span>
                {member.note && (
                  <span className="mt-1 truncate text-xs text-muted-foreground">
                    {member.note}
                  </span>
                )}
                {member.email && (
                  <a
                    href={`mailto:${member.email}`}
                    className="mt-1 truncate text-xs text-primary underline underline-offset-2"
                  >
                    {member.email}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
