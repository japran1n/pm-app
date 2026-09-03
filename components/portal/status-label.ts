// UX-24: internal status vocabulary (`in_review`, `backlog`, `todo`, the
// word "task" itself) is written for the team, not for a client — and
// "backlog" in particular reads as *behind*, when it means the opposite
// (planned, not yet started). This is the one place the portal translates
// a raw status/category into words a client actually reads correctly.
import type { StatusCategory } from "@/lib/queries/portal";

export function clientStatusLabel(
  category: StatusCategory,
  rawStatus: string,
): string {
  if (/review/i.test(rawStatus)) return "Waiting on your review";
  if (category === "done") return "Delivered";
  if (category === "in_progress") return "In progress";
  return "Planned";
}

// F004 (missions/20260903-portal, AS-015/AS-016): the four client-facing
// status buckets a project status tints/groups as -- `StatusPill`
// (components/portal/status-pill.tsx) is the one place that reads this;
// folded in here rather than as a second file so this module stays the
// single home for "how does the team's internal status vocabulary read
// to a client."
export type ClientBucket = "waiting" | "progress" | "blocked" | "done";

const CLIENT_BUCKETS: ReadonlySet<string> = new Set<ClientBucket>([
  "waiting",
  "progress",
  "blocked",
  "done",
]);

function isClientBucket(value: string): value is ClientBucket {
  return CLIENT_BUCKETS.has(value);
}

// `project_statuses.category` only carries three values and cannot
// express "waiting on the client" (e.g. "Awaiting Client Feedback" is
// category `in_progress` on the team's own board -- see
// docs/team-app-for-portal-plan.md's status table) or "blocked" (no
// `blocked` category exists at all). This fallback covers every status
// that has never had a bucket explicitly chosen for it; an explicit
// `project_statuses.client_bucket` always wins.
const CATEGORY_BUCKET_FALLBACK: Record<StatusCategory, ClientBucket> = {
  not_started: "waiting",
  in_progress: "progress",
  done: "done",
};

// Never resolves a bucket by matching `name`/`rawStatus` -- a status
// called "Awaiting Client Feedback" reaches "waiting" only via its own
// `client_bucket` column, set explicitly in the board-columns settings
// screen, never by this function recognising the string.
export function resolveClientBucket(
  category: StatusCategory,
  clientBucket: string | null | undefined,
): ClientBucket {
  if (clientBucket && isClientBucket(clientBucket)) {
    return clientBucket;
  }
  return CATEGORY_BUCKET_FALLBACK[category];
}

export function projectHealthLabel(project: {
  overdueCount: number;
  percentComplete: number | null;
}): { label: string; tone: "ok" | "warn" | "crit" } {
  if (project.overdueCount > 0) {
    return { label: "Needs attention", tone: "crit" };
  }
  if (project.percentComplete !== null && project.percentComplete >= 100) {
    return { label: "Complete", tone: "ok" };
  }
  return { label: "On track", tone: "ok" };
}
