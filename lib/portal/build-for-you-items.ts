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

// `getOpenApprovalsForClient` only ever returns `state === "pending"` rows
// (see that query's own header comment), so every approval here is by
// definition still open -- this is just "does it have a due date, and has
// that date passed", same shape of test as
// `waiting-on-you-count.ts`'s own `isApprovalPastDue` (not re-exported from
// there because that module is intentionally the count-only surface; this
// is the ordering/grouping surface).
function isApprovalPastDue(dueAt: string | null, todayIso: string): boolean {
  return dueAt !== null && dueAt < todayIso;
}

/** Outstanding materials: not yet accepted or waived -- same filter
 * `getWaitingOnYouCount` and Your list's `classifyBucket` both already use. */
export function outstandingDeliverables(deliverables: PortalDeliverable[]): PortalDeliverable[] {
  return deliverables.filter((d) => d.state !== "accepted" && d.state !== "waived");
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

  return [...decisionItems, ...materialItems].sort((a, b) => {
    if (a.dueAt && b.dueAt) return a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0;
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
