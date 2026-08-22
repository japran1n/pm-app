// F161 (AS-287, AS-288): stacked "who's assigned" avatar group. Replaces
// every single-avatar assignee rendering (task card, list row, detail
// header) once a task can have more than one assignee (F159/F160's
// `task_assignees`).
//
// Composition, not reinvention (Clarified implementation's "Dependencies on
// existing code" answer): every avatar is a plain `UserAvatar` (F122) —
// this file only adds the overlap layout, the `+K` overflow chip, and the
// tooltip. No new avatar-rendering logic lives here.
//
// Display limit: the feature spec/clarification left the exact number
// open ("Notes for clarification" ambiguity-resolution default: take the
// simpler option, record the choice here). 3 is used — enough to show who
// besides "the rest" without the stack outgrowing a compact card, and the
// same limit already implied by this component's own AVATAR_GROUP_LIMIT
// export so a future caller/test can reference it instead of a magic
// number.
export const AVATAR_GROUP_LIMIT = 3;

import { Fragment } from "react";

import { UserAvatar, personLabel, type UserAvatarPerson } from "@/components/user-avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const SIZE_PX: Record<"sm" | "default" | "lg", number> = {
  sm: 24,
  default: 32,
  lg: 40,
};

/**
 * Overlapping/stacked avatars, up to `max` (AS-287: "all assignees appear
 * as a stacked avatar group"). Beyond that, a `+K` chip stands in for the
 * rest (AS-288: "overflow beyond the display limit shows a count").
 *
 * Every avatar — and the overflow chip — carries a tooltip naming who it
 * represents; the overflow chip's tooltip lists every HIDDEN person by
 * name, not just a bare count, since that's the one place the count alone
 * doesn't say who they are. Tooltips are reachable by keyboard (this
 * feature's own clarified note): each trigger is a real, focusable
 * `<button>`, not a hover-only wrapper — Base UI's Tooltip already opens
 * on focus as well as hover/press for exactly this reason.
 */
export function UserAvatarGroup({
  people,
  max = AVATAR_GROUP_LIMIT,
  size = "sm",
  className,
}: {
  people: UserAvatarPerson[];
  /** Display limit before the rest collapse into a "+K" chip. */
  max?: number;
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  if (people.length === 0) return null;

  const visible = people.slice(0, max);
  const hidden = people.slice(max);
  const overlapPx = -Math.round(SIZE_PX[size] * 0.35);

  return (
    <TooltipProvider>
      <div
        className={cn("flex items-center", className)}
        data-testid="avatar-group"
        aria-label={`Assigned: ${people.map((person) => personLabel(person)).join(", ")}`}
      >
        {visible.map((person, index) => (
          <Fragment key={person.id}>
            <Tooltip>
              <TooltipTrigger
                type="button"
                className="relative rounded-full ring-2 ring-background focus-visible:z-10 focus-visible:outline-none focus-visible:ring-ring"
                style={index === 0 ? undefined : { marginLeft: overlapPx }}
              >
                <UserAvatar person={person} size={size} />
              </TooltipTrigger>
              <TooltipContent>{personLabel(person)}</TooltipContent>
            </Tooltip>
          </Fragment>
        ))}
        {hidden.length > 0 && (
          <Tooltip>
            <TooltipTrigger
              type="button"
              data-testid="avatar-group-overflow"
              className="relative flex items-center justify-center rounded-full border border-border bg-muted font-medium text-muted-foreground ring-2 ring-background focus-visible:z-10 focus-visible:outline-none focus-visible:ring-ring"
              style={{
                marginLeft: overlapPx,
                width: SIZE_PX[size],
                height: SIZE_PX[size],
                fontSize: size === "sm" ? 10 : 11,
              }}
              aria-label={`${hidden.length} more assigned: ${hidden
                .map((person) => personLabel(person))
                .join(", ")}`}
            >
              +{hidden.length}
            </TooltipTrigger>
            <TooltipContent>
              {hidden.map((person) => personLabel(person)).join(", ")}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
