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

import {
  UserAvatar,
  personLabel,
  statusNoteTooltipLabel,
  type UserAvatarPerson,
} from "@/components/user-avatar";
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
  max: maxProp,
  limit,
  size = "sm",
  className,
  // F165: reused for the task detail header's watcher avatar group, where
  // "Assigned: ..." would be a wrong accessible name — the group's own
  // meaning (who it represents) varies by caller. Optional and defaulted
  // to "Assigned" so every existing caller (F161's assignee groups) keeps
  // its exact previous accessible name with no changes needed there.
  ariaLabelPrefix = "Assigned",
  // BUGFIX: default true preserves every existing caller's exact prior
  // behaviour. Set false ONLY when this group is nested inside another
  // native <button> — components/task/list-assignee-cell.tsx's Popover
  // trigger IS one, and Base UI's TooltipTrigger below renders a real
  // <button> per avatar. A <button> inside a <button> is invalid HTML;
  // React 19's hydration validator now treats it as a hard hydration
  // failure (an uncaught error that breaks ALL client interactivity on
  // the page, not merely a console warning), rather than the older
  // "browser is forgiving, technically-invalid-but-works" behaviour this
  // code silently relied on since F161/F165. Board's TaskCard never hit
  // this because its own clickable wrapper uses role="button" on a <div>,
  // not a real <button> — an ARIA role, not literal HTML nesting.
  // When false: same avatars, same overflow "+K" chip, no per-avatar
  // tooltip and no individual focus stop — acceptable here specifically
  // because the ENCLOSING trigger already opens a popover that names
  // every assignee, so the collapsed view's hover-tooltip is redundant,
  // not a lost capability.
  interactive = true,
  overflowCount,
}: {
  people: UserAvatarPerson[];
  /** Display limit before the rest collapse into a "+K" chip. */
  max?: number;
  /** Alias of `max`; wins when both given. */
  limit?: number;
  size?: "sm" | "default" | "lg";
  className?: string;
  /** Prefix for this group's accessible name, e.g. "Assigned" or
   * "Watching" — see doc comment above. */
  ariaLabelPrefix?: string;
  /** False when nesting inside another native <button> — see doc comment
   * above. */
  interactive?: boolean;
  /** Extra overflow count beyond what `people` contains — used when the
   * caller has already pre-sliced `people` to the display limit but knows
   * the total count from a separate query (e.g. getProjectTeamPreview). */
  overflowCount?: number;
}) {
  const max = limit ?? maxProp ?? AVATAR_GROUP_LIMIT;
  if (people.length === 0) return null;

  const visible = people.slice(0, max);
  const hidden = people.slice(max);
  const extraOverflow = overflowCount ?? 0;
  const overlapPx = -Math.round(SIZE_PX[size] * 0.35);

  return (
    <TooltipProvider>
      <div
        className={cn("flex items-center", className)}
        data-testid="avatar-group"
        aria-label={`${ariaLabelPrefix}: ${people.map((person) => personLabel(person)).join(", ")}`}
      >
        {visible.map((person, index) =>
          interactive ? (
            <Fragment key={person.id}>
              <Tooltip>
                <TooltipTrigger
                  type="button"
                  className="relative rounded-full ring-2 ring-background focus-visible:z-10 focus-visible:outline-none focus-visible:ring-ring"
                  style={index === 0 ? undefined : { marginLeft: overlapPx }}
                >
                  <UserAvatar person={person} size={size} />
                </TooltipTrigger>
                <TooltipContent>
                  {statusNoteTooltipLabel(person) ?? personLabel(person)}
                </TooltipContent>
              </Tooltip>
            </Fragment>
          ) : (
            <span
              key={person.id}
              className="relative rounded-full ring-2 ring-background"
              style={index === 0 ? undefined : { marginLeft: overlapPx }}
            >
              <UserAvatar person={person} size={size} />
            </span>
          ),
        )}
        {(hidden.length > 0 || extraOverflow > 0) &&
          (interactive ? (
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
                aria-label={`${hidden.length + extraOverflow} more ${ariaLabelPrefix.toLowerCase()}${hidden.length > 0 ? `: ${hidden.map((person) => personLabel(person)).join(", ")}` : ""}`}
              >
                +{hidden.length + extraOverflow}
              </TooltipTrigger>
              <TooltipContent>
                {hidden.length > 0
                  ? hidden.map((person) => personLabel(person)).join(", ")
                  : `${extraOverflow} more`}
              </TooltipContent>
            </Tooltip>
          ) : (
            <span
              data-testid="avatar-group-overflow"
              className="relative flex items-center justify-center rounded-full border border-border bg-muted font-medium text-muted-foreground ring-2 ring-background"
              style={{
                marginLeft: overlapPx,
                width: SIZE_PX[size],
                height: SIZE_PX[size],
                fontSize: size === "sm" ? 10 : 11,
              }}
            >
              +{hidden.length + extraOverflow}
            </span>
          ))}
      </div>
    </TooltipProvider>
  );
}
