// Mission 20260914-portal-simplify, F006 (AS-008, AS-009): the "For you"
// page's single merged list -- open decisions (`approval_requests`, via
// `getOpenApprovalsForClient`) and outstanding materials
// (`client_deliverables`, via `getClientDeliverablesForPortal`), soonest
// due first, overdue flagged. Deliberately a pure function over the two
// arrays those existing queries already return -- no new reads, no new
// "waiting" definition (see lib/portal/waiting-on-you-count.ts's own header
// comment on why F005/F006/F008/F010 all stay on the same two sources) --
// so this file only decides ORDER and GROUPING, never what counts as
// outstanding.
import { isDeliverablePastDue } from "@/lib/queries/deliverables";
import type { PortalApproval } from "@/lib/queries/approvals";
import type { PortalDeliverable } from "@/lib/queries/deliverables";
import { isApprovalPastDue, toUtcDateOnly } from "@/lib/portal/is-past-due";

export type ForYouFilter = "all" | "decisions" | "materials";

export type ForYouItem =
  | {
      kind: "decision";
      id: string;
      dueAt: string | null;
      overdue: boolean;
      approval: PortalApproval;
    }
  | {
      kind: "material";
      id: string;
      dueAt: string | null;
      overdue: boolean;
      deliverable: PortalDeliverable;
    };

export type ForYouCounts = {
  all: number;
  decisions: number;
  materials: number;
};

// F017 (portal-simplify, M2 scrutiny): `isApprovalPastDue` used to be a
// second, verbatim copy of `waiting-on-you-count.ts`'s own private
// function -- deduplicated into `lib/portal/is-past-due.ts`, imported by
// both call sites, so a future edit to the predicate can't apply to one
// and silently miss the other.

/** Materials the CLIENT still has to act on -- not yet delivered at all
 * (`not_started`/`in_progress`). F017's own bug fix: a `delivered`
 * material is waiting on the TEAM to review it (see
 * `components/portal/deliverable-row.tsx`'s "Waiting for us to check it"
 * copy -- that IS this state's whole meaning), so it must never appear
 * in the "waiting on you" merged list or its counts; the previous filter
 * (`state !== "accepted" && state !== "waived"`) incorrectly counted it
 * as still outstanding FOR THE CLIENT. Kept in the "For you" list's
 * empty-state contract via `awaitingReviewDeliverables` below instead --
 * visible, but in the history disclosure, not counted as action-needed. */
export function outstandingDeliverables(deliverables: PortalDeliverable[]): PortalDeliverable[] {
  return deliverables.filter((d) => d.state === "not_started" || d.state === "in_progress");
}

/** Delivered, not yet accepted/waived by the team -- awaiting THEIR
 * action, not the client's. Surfaced in "For you"'s history disclosure
 * (never counted in the chip/badge numbers) so the client can still see
 * "sent, waiting for review" without it reading as something they still
 * owe. */
export function awaitingReviewDeliverables(deliverables: PortalDeliverable[]): PortalDeliverable[] {
  return deliverables.filter((d) => d.state === "delivered");
}

export function settledDeliverables(deliverables: PortalDeliverable[]): PortalDeliverable[] {
  return deliverables.filter((d) => d.state === "accepted" || d.state === "waived");
}

// AS-008: soonest due first, overdue flagged. Items with no due date sort
// after every item that has one -- same ordering convention Your list's
// `outstanding` list already uses (your-list/page.tsx), applied here
// across BOTH kinds instead of within one.
export function buildForYouItems(
  approvals: PortalApproval[],
  deliverables: PortalDeliverable[],
  todayIso: string,
): ForYouItem[] {
  const decisionItems: ForYouItem[] = approvals.map((approval) => ({
    kind: "decision",
    id: approval.id,
    dueAt: approval.dueAt,
    overdue: isApprovalPastDue(approval.dueAt, todayIso),
    approval,
  }));

  const materialItems: ForYouItem[] = outstandingDeliverables(deliverables).map((deliverable) => ({
    kind: "material",
    id: deliverable.id,
    dueAt: deliverable.dueAt,
    overdue: isDeliverablePastDue(deliverable.state, deliverable.dueAt, todayIso),
    deliverable,
  }));

  // F017 (portal-simplify, M2 scrutiny): a decision's `dueAt` is a full
  // `timestamptz`, a material's is a plain `date` -- comparing the raw
  // strings sorted a decision due "2026-09-14T09:00:00Z" AFTER a material
  // due "2026-09-14" even though both are due the same calendar day
  // (the longer timestamp string is lexicographically greater). Both
  // sides are truncated to their UTC calendar date (`toUtcDateOnly`,
  // the same rule `is-past-due.ts` uses) before comparing, so same-day
  // items sort as equal -- ties then fall through to Array.prototype.sort's
  // own stable ordering (decisions-then-materials, this function's
  // insertion order), never an accidental type-driven reshuffle.
  return [...decisionItems, ...materialItems].sort((a, b) => {
    if (a.dueAt && b.dueAt) {
      const aDate = toUtcDateOnly(a.dueAt);
      const bDate = toUtcDateOnly(b.dueAt);
      return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
    }
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return 0;
  });
}

// AS-009: the chip counts are derived from the SAME merged list the rows
// come from -- never a second, independently computed number that could
// drift from what is actually rendered.
export function countForYouItems(items: ForYouItem[]): ForYouCounts {
  const decisions = items.filter((item) => item.kind === "decision").length;
  const materials = items.filter((item) => item.kind === "material").length;
  return { all: items.length, decisions, materials };
}

export function filterForYouItems(items: ForYouItem[], filter: ForYouFilter): ForYouItem[] {
  if (filter === "all") return items;
  if (filter === "decisions") return items.filter((item) => item.kind === "decision");
  return items.filter((item) => item.kind === "material");
}

export function parseForYouFilter(value: string | undefined): ForYouFilter {
  if (value === "decisions" || value === "materials") return value;
  return "all";
}
