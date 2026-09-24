// Mission 20260914-portal-simplify, F005 (AS-007): "The For you nav badge
// and the Home callout show the same number for the same project, and show
// no number when the read fails." F006 (the new "For you" page), F008 (the
// four-item sidebar's "For you" badge), and F010 (the Home callout) all need
// the SAME "waiting on you" number for a project -- this module is the one
// place that number is computed, so those three call sites can never drift
// apart the way the pre-simplify UI's separate approvals badge and
// deliverables badge could.
//
// Deliberately narrower than `buildWaitingOnYouItems`
// (lib/portal/build-waiting-on-you-items.ts): that module also folds in
// `pending_client_approval` tasks, pending client-owned accounts, and a
// draft brief -- items the pre-simplify Overview page's "What we need from
// you" block surfaces. F006/F008/F010's shared count is scoped to exactly
// the two categories the new "For you" page groups its list into --
// decisions (open approvals) and materials (outstanding deliverables) --
// per plan.md's F005 description. It is not a third, competing definition
// of "waiting on you": it reuses the exact same two reads
// (`getOpenApprovalsForClient`, `getClientDeliverablesForPortal`) and the
// exact same past-due predicate (`isDeliverablePastDue`) those other
// modules already depend on, just grouped and counted differently for this
// narrower "For you" surface. If a future feature needs the union of BOTH
// groupings (e.g. a single project-wide "all outstanding" number spanning
// tasks/accounts/brief too), that is new scope, not a change to this file.
import { getOpenApprovalsForClient } from "@/lib/queries/approvals";
import {
  getClientDeliverablesForPortal,
  isDeliverablePastDue,
} from "@/lib/queries/deliverables";
import type { PortalQueryResult } from "@/lib/queries/portal";
import { isApprovalPastDue } from "@/lib/portal/is-past-due";

export type WaitingOnYouCount = {
  /** Open approvals this client can act on (`getOpenApprovalsForClient`). */
  decisions: number;
  /** Client deliverables not yet accepted or waived
   * (`getClientDeliverablesForPortal`, filtered to non-terminal states). */
  materials: number;
  /** `decisions + materials`. */
  total: number;
  /** Past-due among BOTH `decisions` and `materials`. Materials use the
   * shared `isDeliverablePastDue` predicate. `getOpenApprovalsForClient`
   * only ever returns `state === "pending"` rows, so an approval counts as
   * past due here on the same shape of test -- still open, has a due date,
   * and that date has passed -- there is no separate "approval past due"
   * predicate exported elsewhere in the codebase to reuse (`PortalApproval`
   * carries `dueAt` but no caller currently derives an overdue flag from
   * it), so this is the one place that check is written, kept as narrow
   * and literal as `isDeliverablePastDue` itself rather than introducing a
   * generic cross-entity "is overdue" abstraction. */
  overdue: number;
};

// AS-007: a failed read from EITHER source must not silently render as
// "nothing waiting" -- same honesty rule `getOpenApprovalsForClient` and
// `getClientDeliverablesForPortal` already enforce with their own
// `PortalQueryResult` return types (see those modules' header comments).
// This helper just propagates the first failure rather than swallowing it
// into a coalesced zero.
export async function getWaitingOnYouCount(
  projectId: string,
  todayIso: string,
): Promise<PortalQueryResult<WaitingOnYouCount>> {
  const [approvalsResult, deliverablesResult] = await Promise.all([
    getOpenApprovalsForClient(projectId),
    getClientDeliverablesForPortal(projectId),
  ]);

  if (!approvalsResult.ok) return approvalsResult;
  if (!deliverablesResult.ok) return deliverablesResult;

  const decisions = approvalsResult.data.length;

  // F017 (portal-simplify, M2 scrutiny): a `delivered` material is
  // waiting on the TEAM to review it, not on the client -- it must not
  // inflate this "waiting on YOU" count (the bug this fix addresses: the
  // badge/callout counted it as outstanding for the client while "For
  // you" itself, once fixed, no longer lists it as an action item, so
  // the two disagreed). Same `not_started`/`in_progress`-only definition
  // `outstandingDeliverables` (lib/portal/build-for-you-items.ts) now
  // uses, so this count and the "For you" page it links to always agree.
  const outstandingMaterials = deliverablesResult.data.filter(
    (deliverable) => deliverable.state === "not_started" || deliverable.state === "in_progress",
  );
  const materials = outstandingMaterials.length;

  const overdueMaterials = outstandingMaterials.filter((deliverable) =>
    isDeliverablePastDue(deliverable.state, deliverable.dueAt, todayIso),
  ).length;
  const overdueDecisions = approvalsResult.data.filter((approval) =>
    isApprovalPastDue(approval.dueAt, todayIso),
  ).length;
  const overdue = overdueMaterials + overdueDecisions;

  return {
    ok: true,
    data: {
      decisions,
      materials,
      total: decisions + materials,
      overdue,
    },
  };
}

// REUSE-PORTAL-04: the multi-project chooser's per-card "N waiting on you"
// badge used to count `getPortalOverview().waitingOnYou` TASKS — a
// different source from the in-project "For you" badge (approvals +
// outstanding deliverables), so the two disagreed for the same project.
// It now uses the same `getWaitingOnYouCount` per project. A project whose
// read failed is omitted (no badge), per AS-007's "no number when the read
// fails" rule.
export async function getWaitingOnYouTotalsByProject(
  projectIds: readonly string[],
  todayIso: string,
): Promise<Map<string, number>> {
  const results = await Promise.all(
    projectIds.map(async (projectId) => ({
      projectId,
      result: await getWaitingOnYouCount(projectId, todayIso),
    })),
  );
  const totals = new Map<string, number>();
  for (const { projectId, result } of results) {
    if (result.ok) totals.set(projectId, result.data.total);
  }
  return totals;
}
