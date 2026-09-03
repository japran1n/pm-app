// UX-24: internal status vocabulary (`in_review`, `backlog`, `todo`, the
// word "task" itself) is written for the team, not for a client — and
// "backlog" in particular reads as *behind*, when it means the opposite
// (planned, not yet started). This is the one place the portal translates
// a raw status/category into words a client actually reads correctly.
import type { StatusCategory } from "@/lib/queries/portal";

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

// F006g (missions/20260903-portal, AS-015/AS-017): `category` can express
// "not started yet" and "delivered", but it cannot express "waiting on
// the client" -- that was always the whole reason `client_bucket` exists
// (see the migration comment, 20260911010000). A `not_started` status
// with no explicit override used to fall back to "waiting", which meant
// a Backlog page nobody had touched yet was reported to the client as
// blocked on THEM -- blaming the client for the team's own backlog, and
// the single most client-damaging defect the M1 re-scrutiny found. There
// is no dedicated "not started" bucket (the four buckets stay four, per
// this feature's own instruction not to overload `waiting` to avoid a
// schema change) -- a not-started status simply reads as work the team
// has not gotten to yet, grouped with "in progress" rather than
// misreported as something the client owes.
const CATEGORY_BUCKET_FALLBACK: Record<StatusCategory, ClientBucket> = {
  not_started: "progress",
  in_progress: "progress",
  done: "done",
};

// Never resolves a bucket by matching `name`/`rawStatus` -- a status
// called "Awaiting Client Feedback" (or "Design review") reaches
// "waiting" only via its own `client_bucket` column, set explicitly in
// the board-columns settings screen, or via `pendingClientApproval`
// (below) -- never by this function recognising the string.
//
// F006g (AS-015, AS-017): `pendingClientApproval` is the per-TASK signal
// (`tasks.pending_client_approval`, kept in sync with an open
// `approval_requests` row -- 20260916010000's own header) that a specific
// row genuinely needs the client's decision right now. It wins over
// whatever the status's own bucket says -- a task can sit in a column
// bucketed "in progress" and still be the one thing the client owes a
// decision on -- with one exception: a status categorised `done` is
// never "waiting", because delivered work is not blocked on the client
// no matter what flag survived on it. This is also what makes the
// Overview's "Waiting on you" list and the Pages distribution's "Waiting
// on you" count agree by construction: both route every row through this
// same function instead of keeping two independent definitions of
// "waiting" that could drift apart.
export function resolveClientBucket(
  category: StatusCategory,
  clientBucket: string | null | undefined,
  pendingClientApproval = false,
): ClientBucket {
  if (pendingClientApproval && category !== "done") {
    return "waiting";
  }
  if (clientBucket && isClientBucket(clientBucket)) {
    return clientBucket;
  }
  return CATEGORY_BUCKET_FALLBACK[category];
}

// F006g (missions/20260903-portal, AS-015, AS-017): the single exported
// bucket -> client-facing-name map. `pages-table.tsx`'s status filter,
// `status-distribution.tsx`'s key and `status-manager.tsx`'s bucket
// override select all import this rather than each keeping their own
// copy -- three copies is three answers to the same question, and the
// third had already drifted ("Waiting on client" / "Done") from the
// other two before this fix.
export const CLIENT_BUCKET_LABELS: Record<ClientBucket, string> = {
  waiting: "Waiting on you",
  progress: "In progress",
  blocked: "Blocked",
  done: "Ready to launch",
};

// F006g: `clientStatusLabel` used to resolve its "waiting" case with
// `/review/i` against the raw status name -- in this very module, using
// exactly the name-matching approach F004 was forbidden to use, and
// exactly the kind of drift `resolveClientBucket` exists to prevent. It
// now derives its phrase from the same bucket every other consumer
// reads, wording it for the shared-tasks list's group headings rather
// than reusing `CLIENT_BUCKET_LABELS` verbatim -- see status-pill.tsx's
// own comment on why that heading copy is deliberately not the generic
// bucket vocabulary.
export function clientStatusLabel(
  category: StatusCategory,
  clientBucket: string | null | undefined,
): string {
  const bucket = resolveClientBucket(category, clientBucket);
  switch (bucket) {
    case "waiting":
      return "Waiting on your review";
    case "blocked":
      return "Blocked";
    case "done":
      return "Delivered";
    case "progress":
    default:
      return "In progress";
  }
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
