"use client";

// F004 (missions/20260903-portal, AS-015, AS-016): one status pill,
// shared by every portal view and by the team-side board wherever a
// client-facing status is displayed, so the two can never carry two
// different mappings for the same status.
//
// The label is the status's own name (`project_statuses.name`) -- the
// exact word the team sees, not a translated generic bucket phrase like
// components/portal/status-label.ts's `clientStatusLabel` produces for
// the shared-tasks list's group headings. AS-015 is specifically about a
// single, undivergeable status per row; a second, generic label here
// would reintroduce the drift the assertion rules out.
//
// The dot + tint come from the status's client bucket
// (`resolveClientBucket`, folded into status-label.ts rather than
// duplicated here) so colour always tracks the same four validated
// tokens (`--status-*`, app/globals.css) regardless of which of the four
// buckets a given status resolves to.
//
// Tooltip: `client_description`, read straight from the database
// (AS-016). A status with no description renders the pill with no
// tooltip at all -- not an empty bubble, and not a crash.
//
// F006g (missions/20260903-portal): a task with no status at all
// (`status_id` null -- `lib/queries/portal.ts`'s `getPortalPages`
// passes `name: null` for that row) used to still resolve a bucket from
// the `not_started` category default and render a coloured pill with an
// empty label. `name === null` now short-circuits to a neutral "No
// status" pill -- `bg-muted`/`text-muted-foreground`, the same neutral
// tokens used everywhere else in this app for "nothing set yet", never
// one of the four validated status tokens -- with no tooltip, since
// there is no status to describe.
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { resolveClientBucket, type ClientBucket } from "@/components/portal/status-label";
import type { StatusCategory } from "@/lib/queries/portal";
import { cn } from "@/lib/utils";

const BUCKET_CLASSES: Record<ClientBucket, { dot: string; text: string; bg: string }> = {
  waiting: {
    dot: "bg-status-waiting",
    text: "text-status-waiting",
    bg: "bg-status-waiting-bg",
  },
  progress: {
    dot: "bg-status-progress",
    text: "text-status-progress",
    bg: "bg-status-progress-bg",
  },
  blocked: {
    dot: "bg-status-blocked",
    text: "text-status-blocked",
    bg: "bg-status-blocked-bg",
  },
  done: {
    dot: "bg-status-done",
    text: "text-status-done",
    bg: "bg-status-done-bg",
  },
};

export function StatusPill({
  name,
  category,
  clientBucket = null,
  description = null,
  className,
  labelOverride = null,
}: {
  name: string | null;
  category: StatusCategory;
  clientBucket?: string | null;
  description?: string | null;
  className?: string;
  /**
   * F108 (missions/20260903-portal, docs/client-portal-visual-plan.md
   * 3.2, coordinator review): a caller-supplied client-facing word to
   * render INSTEAD of the status's own raw `name` -- e.g. the Pages
   * table, where the underlying `project_statuses.name` is whatever the
   * team named it (the default seed literally names its four statuses
   * `todo`/`in_progress`/`in_review`/`done` -- internal, snake_case
   * words, never meant for a client to read). `undefined`/`null` (every
   * existing caller) keeps this component's original AS-015 behaviour
   * unchanged -- the status's own name, verbatim, is still the ONLY
   * label the team-side board and every other portal view render. This
   * does not change which bucket/colour a status resolves to, only the
   * TEXT drawn inside the same pill.
   */
  labelOverride?: string | null;
}) {
  if (name === null) {
    return (
      <span
        data-testid="status-pill"
        data-bucket="none"
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-micro font-medium text-muted-foreground",
          className,
        )}
      >
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
        <span className="truncate">No status</span>
      </span>
    );
  }

  const bucket = resolveClientBucket(category, clientBucket);
  const classes = BUCKET_CLASSES[bucket];

  const pill = (
    <span
      data-testid="status-pill"
      data-bucket={bucket}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-micro font-medium",
        classes.bg,
        classes.text,
        className,
      )}
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", classes.dot)} />
      <span className="truncate">{labelOverride ?? name}</span>
    </span>
  );

  // AS-016's tooltip only exists when there is a real, database-sourced
  // description to show -- a status with `client_description: null`
  // renders the plain pill (still coloured, still labelled) with no
  // tooltip trigger at all.
  if (!description) {
    return pill;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {pill}
      </TooltipTrigger>
      <TooltipContent>{description}</TooltipContent>
    </Tooltip>
  );
}
