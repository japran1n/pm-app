// F138 (AS-243): renders a workspace's logo, with an initials fallback
// identical in shape/behaviour to UserAvatar (F122) — same
// Avatar/AvatarImage/AvatarFallback primitives, same accessible-name
// pattern (role="img" + aria-label on the root, image + fallback both
// aria-hidden), same lib/user-color.ts palette/hash logic for a
// deterministic, WCAG-AA-contrast fallback colour (keyed by workspace id
// instead of user id — same hash function, same 8-entry palette, so a
// workspace and a user can never be told apart by "how" their colour was
// picked). Not a copy-pasted UserAvatar: it is deliberately a small,
// separate component (a workspace and a "person" are different domain
// concepts with different fallback-initials rules — see initialsForName
// below), but every piece it reuses is imported, not reimplemented.

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { getUserColor } from "@/lib/user-color";

// Workspace names are free text with no "first/last name" structure the
// way a person's display name has (UserAvatar's initialsFor splits on
// whitespace into two parts) — so this takes the first one or two
// grapheme clusters of the name instead, which reads sensibly for both
// single-word ("Acme" -> "AC") and multi-word ("My Team" -> "MY") names
// alike.
function firstGraphemes(value: string, count: number): string {
  return Array.from(value).slice(0, count).join("");
}

function workspaceInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return firstGraphemes(trimmed, 2).toUpperCase();
}

export function WorkspaceLogo({
  workspaceId,
  name,
  logoUrl,
  size = "default",
  className,
}: {
  workspaceId: string;
  name: string;
  logoUrl?: string | null;
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  const color = getUserColor(workspaceId);

  return (
    <Avatar
      size={size}
      className={className}
      role="img"
      aria-label={name}
      data-testid="workspace-logo"
    >
      {logoUrl ? (
        <AvatarImage src={logoUrl} alt="" aria-hidden="true" />
      ) : null}
      <AvatarFallback
        aria-hidden="true"
        style={{ backgroundColor: color.background, color: color.foreground }}
      >
        {workspaceInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
