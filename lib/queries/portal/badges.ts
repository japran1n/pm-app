import { logger } from "@/lib/observability/logger";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getDeliverablesPastDueCount,
  getWorstOverdueBlockingDeliverableRisk,
} from "@/lib/queries/deliverables";
import type { PortalQueryResult } from "./shared";

// F003 (missions/20260903-portal, AS-002, AS-003): the sidebar's two
// badge counts -- approvals awaiting this client's decision, and the
// client's own deliverables past their due date. F003 shipped this as a
// zero-returning stub ("so F007/F012 only ever need to change THIS
// function's body, never any of its callers") -- F007 is that first
// body change.
//
// AS-002 (approvalsAwaiting): F007's dedicated `approval_requests` table
// now exists. This counts `state = 'pending'` rows through the ordinary
// RLS-respecting client, exactly like every other query in this file --
// `approval_requests_select_client` (this feature's migration) already
// scopes the result to a portal-enabled project the caller is a client
// of, folding in the task-subject `client_visible` check where it
// applies, so no filter is repeated here. This is the same table
// `getOpenApprovalsForClient` (lib/queries/approvals.ts) reads, so the
// sidebar badge and the approvals list it links to can never disagree
// the way the M1 scrutiny report's AS-002 finding described.
//
// F006f (missions/20260903-portal, AS-002): a failed count used to be
// logged and then coalesced to `count ?? 0` -- a dropped connection told
// the client "nothing is waiting on you", the exact wrong-confident-
// number defect this feature exists to remove. `approvalsAwaiting` is
// now a `PortalQueryResult<number>`: the caller (the sidebar nav item)
// renders no badge at all on a failed read, never a `0` it cannot tell
// apart from a real zero.
//
// AS-003 (deliverablesPastDue): `project can hold a list of items the
// client owes` (AS-028) is a wholly new entity F012 introduces in M3 --
// there is no existing table or column anywhere in this schema that
// means "a thing the client owes," so there is nothing to count yet.
// Zero is the honest, vacuously-true answer (a project with zero
// deliverables has zero overdue ones), the same reasoning F001's and
// F005's own handoffs already used for a not-yet-built entity, not a
// placeholder standing in for a real number. It never reads a fallible
// source, so it stays a plain `number`, not a `PortalQueryResult`.
export type PortalBadgeCounts = {
  approvalsAwaiting: PortalQueryResult<number>;
  deliverablesPastDue: number;
};

// F009 (missions/20260903-portal, AS-002, third-scrutiny finding): this
// used to count every `state = 'pending'` row on the project, full stop --
// with no `project_decision_owners` filter, a client who owns only
// `brand` decisions saw a badge that also counted `commercial` requests
// they would get a `42501` on from `decide_approval_atomic` the moment
// they tried to act on one. AS-002's own text is "awaiting THIS CLIENT's
// decision" -- so this now first resolves which decision types the
// calling client actually owns on this project (their own
// `project_decision_owners` rows), and only counts pending requests of
// those types. A client who owns no decision type on this project sees
// 0, honestly (there is nothing they can decide), not the full pending
// count.
export async function getPortalBadgeCounts(projectId: string): Promise<PortalBadgeCounts> {
  const { supabase, user } = await getCurrentUser();

  if (!user) {
    // No session -- the layout that calls this already redirects an
    // unauthenticated caller before this ever runs (see that layout's
    // own defensive re-check), so this is unreachable in practice. An
    // honest failure, never a fabricated zero, if it ever is reached.
    return {
      approvalsAwaiting: { ok: false, error: "Not signed in." },
      deliverablesPastDue: 0,
    };
  }

  // F012/F016e (missions/20260903-portal, M3): the real past-due
  // deliverables count -- no `blocking` qualifier, matching AS-003's own
  // wording and the Your list view's "blocked" bucket count (see
  // `getDeliverablesPastDueCount`'s doc comment). A failed read degrades
  // to 0 here (unlike
  // `approvalsAwaiting` above) because this badge count's own type is a
  // plain `number`, not a `PortalQueryResult` -- the spec for this field
  // is "no placeholder that pretends to be data" for the number itself,
  // not for its failure mode, and a badge silently showing 0 on a
  // logged, transient read failure is the same posture the rest of this
  // file takes for degrade-gracefully counts (see `overdueCount` below).
  const overdueResult = await getDeliverablesPastDueCount(projectId);
  const deliverablesPastDue = overdueResult.ok ? overdueResult.data : 0;
  if (!overdueResult.ok) {
    logger.error("getPortalBadgeCounts: failed to load overdue deliverables count", {
      error: overdueResult.error,
    });
  }

  const { data: ownerRows, error: ownerError } = await supabase
    .from("project_decision_owners")
    .select("decision_type")
    .eq("project_id", projectId)
    .eq("user_id", user.id);

  if (ownerError) {
    logger.error("getPortalBadgeCounts: failed to load decision owners", { error: ownerError });
    return {
      approvalsAwaiting: { ok: false, error: ownerError.message },
      deliverablesPastDue,
    };
  }

  const decisionTypes = [...new Set((ownerRows ?? []).map((row) => row.decision_type))];

  // Owns nothing on this project -- there is nothing pending this client
  // could ever decide, so the honest count is 0 without a second round
  // trip.
  if (decisionTypes.length === 0) {
    return { approvalsAwaiting: { ok: true, data: 0 }, deliverablesPastDue };
  }

  const { count, error } = await supabase
    .from("approval_requests")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("state", "pending")
    .in("decision_type", decisionTypes);

  if (error) {
    logger.error("getPortalBadgeCounts: failed to load approvals count", { error });
    return {
      approvalsAwaiting: { ok: false, error: error.message },
      deliverablesPastDue,
    };
  }

  return {
    // A successful head-count query never actually returns a null
    // count (it returns 0 for no rows) -- this `?? 0` guards the SDK's
    // nullable type, not a failure; it is only ever reached once `error`
    // above is known false.
    approvalsAwaiting: { ok: true, data: count ?? 0 },
    deliverablesPastDue,
  };
}

// F085 (missions/20260903-portal audit, defect 2): the Overview tile's
// honest "what's waiting on you" count. Before this fix, the Overview
// tile read only `getPortalWaitingOnYou` (task-shaped,
// `pending_client_approval` rows) while the sidebar's Approvals badge
// (`getPortalBadgeCounts` above) read `approval_requests` directly for
// the client's owned decision types — a doc- or phase-subject approval
// exists in the badge and not in the tile, and past-due deliverables
// were in neither. This is the one function that unions all three, so
// the tile and the badge can never disagree about whether there is
// SOMETHING waiting on the client, only (by design, per each surface's
// own scope) about which view is the right place to act on it.
//
// Dedup: a task-subject approval request keeps `tasks.pending_client_approval`
// true for exactly as long as it is open (20260916010000's own header) —
// so a task-subject open approval and its `pending_client_approval` task
// row are the SAME obligation counted twice unless collapsed onto one
// key (`task:<id>`). A non-task-subject (doc/phase/artifact) approval has
// no task row to collide with, so it gets its own key (`approval:<id>`).
// Past-due deliverables live in a separate table with no task/approval
// row of their own, so that count is added on top, never deduped against
// the other two.
export async function getPortalWaitingOnYouCount(
  projectId: string,
): Promise<PortalQueryResult<number>> {
  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "Not signed in." };
  }

  const overdueResult = await getDeliverablesPastDueCount(projectId);
  if (!overdueResult.ok) {
    logger.error("getPortalWaitingOnYouCount: failed to load overdue deliverables count", {
      error: overdueResult.error,
    });
    return { ok: false, error: overdueResult.error };
  }

  const { data: taskRows, error: taskError } = await supabase
    .from("tasks")
    .select("id")
    .eq("project_id", projectId)
    .eq("pending_client_approval", true)
    .eq("client_visible", true)
    .is("deleted_at", null)
    // Same terminal shape as `getPortalWaitingOnYou`'s identical filter
    // set above -- ordering has no bearing on a count, this just keeps
    // one query shape for "pending-approval tasks" rather than a second,
    // subtly different one.
    .order("updated_at", { ascending: false });

  if (taskError) {
    logger.error("getPortalWaitingOnYouCount: failed to load pending-approval tasks", {
      error: taskError,
    });
    return { ok: false, error: taskError.message };
  }

  const { data: ownerRows, error: ownerError } = await supabase
    .from("project_decision_owners")
    .select("decision_type")
    .eq("project_id", projectId)
    .eq("user_id", user.id);

  if (ownerError) {
    logger.error("getPortalWaitingOnYouCount: failed to load decision owners", {
      error: ownerError,
    });
    return { ok: false, error: ownerError.message };
  }

  const decisionTypes = [...new Set((ownerRows ?? []).map((row) => row.decision_type))];

  const keys = new Set<string>();
  for (const task of taskRows ?? []) {
    keys.add(`task:${task.id}`);
  }

  if (decisionTypes.length > 0) {
    const { data: approvalRows, error: approvalError } = await supabase
      .from("approval_requests")
      .select("id, subject_type, subject_id")
      .eq("project_id", projectId)
      .eq("state", "pending")
      .in("decision_type", decisionTypes);

    if (approvalError) {
      logger.error("getPortalWaitingOnYouCount: failed to load approvals", {
        error: approvalError,
      });
      return { ok: false, error: approvalError.message };
    }

    for (const approval of approvalRows ?? []) {
      keys.add(
        approval.subject_type === "task" && approval.subject_id
          ? `task:${approval.subject_id}`
          : `approval:${approval.id}`,
      );
    }
  }

  // F-Package-C: accounts the client owns but has not provisioned yet are
  // their own obligation, distinct from tasks/approvals/deliverables --
  // same "waiting on you" bucket, counted here so the tile and the
  // `buildWaitingOnYouItems` list (which applies the identical
  // `owner === "client" && status === "pending"` predicate) can never
  // disagree.
  const { data: accountRows, error: accountError } = await supabase
    .from("project_accounts")
    .select("id")
    .eq("project_id", projectId)
    .eq("owner", "client")
    .eq("status", "pending")
    .eq("client_visible", true);

  if (accountError) {
    logger.error("getPortalWaitingOnYouCount: failed to load pending client accounts", {
      error: accountError,
    });
    return { ok: false, error: accountError.message };
  }

  return { ok: true, data: keys.size + overdueResult.data + (accountRows ?? []).length };
}

// --- Risk banner (F006, missions/20260903-portal, AS-031) -----------------

export type PortalRisk = {
  id: string;
  message: string;
  // F085 (missions/20260903-portal audit, defect 5): carried straight
  // through from `DeliverableRisk` (lib/queries/deliverables.ts) -- the
  // banner names the item and its due date, and links the row to Your
  // list (where the client actually acts on it), rather than a bare
  // sentence with nothing to click.
  itemName: string;
  dueAt: string;
};

// F014 (missions/20260903-portal, AS-031): "a blocking deliverable past
// due" is the one risk source this function surfaces today. "An approval
// open longer than the project's threshold" (F007/F009, M2) is still not
// built -- this function's own return type stays a plain array precisely
// so a second risk source can be appended here later without changing
// `RiskBanner`'s (components/portal/risk-banner.tsx) props shape at all,
// the same extension-point pattern `getPortalBadgeCounts` above already
// uses. Zero or one entries today: `getWorstOverdueBlockingDeliverableRisk`
// (lib/queries/deliverables.ts) only ever names the SINGLE worst overdue
// blocking deliverable, per this feature's own spec ("naming the worst
// one and what it moves") -- never a whole list of every overdue item,
// which would read as noise rather than the one place the portal is
// allowed to be uncomfortable. `null` renders nothing at all (no empty
// banner shell), matching this file's own "must not render a
// placeholder" instruction, unchanged from before this feature.
export async function getPortalRisks(projectId: string): Promise<PortalRisk[]> {
  const risk = await getWorstOverdueBlockingDeliverableRisk(projectId);
  return risk
    ? [{ id: risk.id, message: risk.message, itemName: risk.itemName, dueAt: risk.dueAt }]
    : [];
}
