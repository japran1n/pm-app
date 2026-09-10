// F006 (missions/20260903-portal): the right rail's "Your team" card --
// `project_members` (`getPortalTeam`, lib/queries/portal.ts), avatar +
// name + role label per member, per this feature's own clarified spec.
//
// F112 (six-star review Part 0/D): a real card per person -- name,
// project ROLE (job title, from `project_roles`), one line on what they
// own (`note`), and how to reach them (email). Team lead first is
// `getPortalTeam`'s own sort order, not this component's -- this just
// renders in the order it receives.
// Paket E (client-portal-phase plan, "Piši nam"): each member row now
// links to the project's existing conversation channel (already built by
// F116, app/(portal)/.../conversation/page.tsx) with `?mention=<userId>`,
// rather than only offering a mailto link. `workspaceSlug`/`projectId` are
// optional so existing callers/tests that only care about the read-only
// member list keep working unchanged -- the button simply doesn't render
// without them.
//
// Overview polish pass (2026-09-08): the message link's own label was
// still the Serbian "Piši nam" -- every other client-facing string in
// this portal is English-only (see the pages/approvals copy this file's
// siblings render), so this was the one straggler. Renamed to "Message"
// to match this portal's terse, verb-first action-link tone (e.g.
// "Message", not a full sentence) rather than translating literally.
//
// Same pass: this card moves from a narrow sidebar column to a full-width
// row of member cards below the (now full-width) phase timeline -- see
// this component's own grid className below and the Overview page's
// layout comment for why.
import Link from "next/link";
import { MessageCircle } from "lucide-react";

import { UserAvatar } from "@/components/user-avatar";
import type { PortalTeamMember } from "@/lib/queries/portal";

export function TeamCard({
  members,
  workspaceSlug,
  projectId,
}: {
  members: PortalTeamMember[];
  workspaceSlug?: string;
  projectId?: string;
}) {
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
        <ul
          data-testid="team-card-list"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {members.map((member) => (
            <li
              key={member.id}
              className="flex items-start gap-3 rounded-lg border border-border/60 p-4"
            >
              <UserAvatar
                person={{ id: member.userId, name: member.name, avatarUrl: member.avatarUrl }}
                size="lg"
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
                    className="mt-1 truncate font-mono text-xs text-primary underline underline-offset-2"
                  >
                    {member.email}
                  </a>
                )}
                {workspaceSlug && projectId && (
                  <Link
                    href={`/portal/${workspaceSlug}/p/${projectId}/conversation?mention=${member.userId}`}
                    className="mt-1 flex items-center gap-1 text-xs text-primary underline underline-offset-2"
                  >
                    <MessageCircle aria-hidden="true" className="size-3" />
                    Message
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
