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
}: {
  name: string;
  category: StatusCategory;
  clientBucket?: string | null;
  description?: string | null;
  className?: string;
}) {
  const bucket = resolveClientBucket(category, clientBucket);
  const classes = BUCKET_CLASSES[bucket];

  const pill = (
    <span
      data-testid="status-pill"
      data-bucket={bucket}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        classes.bg,
        classes.text,
        className,
      )}
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", classes.dot)} />
      <span className="truncate">{name}</span>
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
