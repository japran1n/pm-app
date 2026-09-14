// F107 (missions/20260903-portal, docs/client-portal-visual-plan.md Part
// 2.2): "What we need from you" as a block near the top of Overview,
// each item named, with how long it has been waiting, and its action
// inline. The plan is explicit that the union behind the existing
// `waitingOnYouCount` tile (F085, `getPortalWaitingOnYouCount`) already
// reads the right rows -- approvals, pending-approval tasks, and past-due
// deliverables -- and that this block must reuse those reads rather than
// add a fourth path to the same data. This module is pure composition
// over three ALREADY-FETCHED lists (no query of its own):
//
//   - `getOpenApprovalsForClient` (lib/queries/approvals.ts) -- the exact
//     read the Approvals view itself renders.
//   - `getPortalWaitingOnYou` (lib/queries/portal.ts) -- the exact
//     project-scoped task list the Overview page already fetches for the
//     list under the phase timeline.
//   - `getClientDeliverables` (lib/queries/deliverables.ts) -- the exact
//     read the Your list view renders, filtered here with the SAME
//     shared `isDeliverablePastDue` predicate that function's own
//     dependents use (never a second, re-derived past-due test).
//
// Dedup follows `getPortalWaitingOnYouCount`'s own documented rule: a
// task-subject open approval and its `pending_client_approval` task row
// are the same obligation, collapsed onto the task's own id so the count
// on the tile and the number of rows rendered here can never disagree.
import type { PortalApproval } from "@/lib/queries/approvals";
import type { PortalOverviewTask } from "@/lib/queries/portal";
import { isDeliverablePastDue, type ClientDeliverable } from "@/lib/queries/deliverables";
import type { ProjectAccount } from "@/lib/queries/project-site";
import type { BriefState } from "@/lib/queries/brief";

export type WaitingOnYouItemKind = "approval" | "task" | "deliverable" | "account" | "brief";

// F064 (AS-163, AS-164): the project questionnaire is "waiting on you"
// while it is still in `draft` state AND has at least one question to
// answer -- a brief with zero questions has nothing for the client to
// do, so it never surfaces here even in `draft`. Once the client submits
// (`state` becomes `submitted`, F061's `submitBrief`) or the team
// approves it (`approved`), it drops out of this list (AS-164): a
// `draft`-only, has-questions predicate captures both exits in one
// check, matching `isDeliverablePastDue`'s pattern of a single shared
// predicate rather than scattering the "is this still outstanding"
// logic across callers.
export type BriefOutstandingInfo = {
  state: BriefState;
  questionCount: number;
} | null;

export type WaitingOnYouItem = {
  key: string;
  kind: WaitingOnYouItemKind;
  title: string;
  href: string;
  /** Days since the obligation was raised (approval/task) or days past
   * its due date (deliverable) -- always >= 0, floored. */
  daysWaiting: number;
  actionLabel: string;
};

function daysBetween(fromIso: string, todayIso: string): number {
  const from = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`).getTime();
  const today = new Date(`${todayIso.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((today - from) / (24 * 60 * 60 * 1000)));
}

export function buildWaitingOnYouItems({
  approvals,
  tasks,
  deliverables,
  accounts,
  brief,
  workspaceSlug,
  projectId,
  todayIso,
}: {
  approvals: PortalApproval[];
  tasks: PortalOverviewTask[];
  deliverables: ClientDeliverable[];
  accounts: ProjectAccount[];
  brief?: BriefOutstandingInfo;
  workspaceSlug: string;
  projectId: string;
  todayIso: string;
}): WaitingOnYouItem[] {
  const basePath = `/portal/${workspaceSlug}/p/${projectId}`;
  // Mission 20260914-portal-simplify, F009 (AS-017): "Approvals"/"Your
  // list" are folded into "For you" (F006) -- this block's own links
  // point straight at the new route (with the matching filter chip
  // preselected) rather than through the old routes' redirects.
  const approvalsHref = `${basePath}/for-you?filter=decisions`;
  const materialsHref = `${basePath}/for-you?filter=materials`;
  const siteHref = `${basePath}/site`;
  const briefHref = `${basePath}/brief`;
  const items: WaitingOnYouItem[] = [];
  const claimedTaskIds = new Set<string>();

  for (const approval of approvals) {
    if (approval.subjectType === "task" && approval.subjectId) {
      const task = tasks.find((t) => t.id === approval.subjectId);
      claimedTaskIds.add(approval.subjectId);
      items.push({
        key: `task:${approval.subjectId}`,
        kind: "task",
        title: task?.title ?? approval.title,
        href: `${basePath}/t/${approval.subjectId}`,
        daysWaiting: daysBetween(approval.requestedAt, todayIso),
        actionLabel: "Review",
      });
    } else {
      items.push({
        key: `approval:${approval.id}`,
        kind: "approval",
        title: approval.title,
        href: approvalsHref,
        daysWaiting: daysBetween(approval.requestedAt, todayIso),
        actionLabel: "Review",
      });
    }
  }

  // A pending-approval task with no matching approval row is not
  // expected in steady state (the migration keeps them in sync -- see
  // `getPortalWaitingOnYouCount`'s own header) but is not assumed here;
  // it still surfaces rather than silently vanishing from the block.
  for (const task of tasks) {
    if (claimedTaskIds.has(task.id)) continue;
    items.push({
      key: `task:${task.id}`,
      kind: "task",
      title: task.title,
      href: `${basePath}/t/${task.id}`,
      daysWaiting: daysBetween(task.updatedAt, todayIso),
      actionLabel: "Review",
    });
  }

  for (const deliverable of deliverables) {
    if (!isDeliverablePastDue(deliverable.state, deliverable.dueAt, todayIso)) continue;
    items.push({
      key: `deliverable:${deliverable.id}`,
      kind: "deliverable",
      title: deliverable.title,
      href: materialsHref,
      daysWaiting: daysBetween(deliverable.dueAt as string, todayIso),
      actionLabel: "Open",
    });
  }

  // F-Package-C: accounts the client owns but hasn't provisioned yet
  // (`owner === "client" && status === "pending"`) live in the same
  // "waiting on you" bucket as tasks/approvals/deliverables, matching the
  // predicate `getPortalWaitingOnYouCount` now applies. Accounts have no
  // "raised at" timestamp in the current schema, so daysWaiting is 0
  // rather than a fabricated value -- the row still surfaces, just
  // without an age claim it can't back up.
  for (const account of accounts) {
    if (account.owner !== "client" || account.status !== "pending") continue;
    items.push({
      key: `account:${account.id}`,
      kind: "account",
      title: account.service,
      href: siteHref,
      daysWaiting: 0,
      actionLabel: "Provide access",
    });
  }

  // F064 (AS-163, AS-164): a draft brief with at least one question is
  // outstanding for the client; a submitted or approved brief (or a
  // draft brief with no questions) is not.
  if (brief && brief.state === "draft" && brief.questionCount > 0) {
    items.push({
      key: "brief",
      kind: "brief",
      title: "Project questionnaire",
      href: briefHref,
      daysWaiting: 0,
      actionLabel: "Answer",
    });
  }

  return items.sort((a, b) => b.daysWaiting - a.daysWaiting);
}
