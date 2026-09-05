// F115 (missions/20260903-portal, docs/client-portal-phase-2-plan.md C):
// "when will you need me again, and for what?" -- a single line under the
// launch headline, computed from data the Overview page ALREADY fetches
// for `buildWaitingOnYouItems` (open approvals, client deliverables) plus
// the phase list it already fetches for the timeline. No fourth query:
// this is pure composition over three already-fetched lists, exactly
// like that module's own header states its reasoning.
//
// Priority order (plan's own words, first match wins):
//   1. something the client owes NOW -- an open approval (regardless of
//      whether it carries a due date) or a past-due deliverable;
//   2. something the client WILL owe -- the next scheduled deliverable
//      (not a decision, not yet delivered, not past due);
//   3. the next phase whose start needs a client decision -- modelled as
//      the next pending `decision`-kind deliverable, the same
//      `client_deliverables` rows case 2 reads, just filtered to that one
//      kind (kept separate from case 2 because the plan calls it out as
//      its own rung, not because it needs a second read);
//   4. nothing pending -- told explicitly, with the next phase's planned
//      start if the phase list has one.
//
// Honesty rule (this feature's own DoD instruction): never state a date
// the data doesn't support. Every branch below emits a dateless sentence
// when the chosen item/phase has no date, rather than inventing one.
import type { PortalApproval } from "@/lib/queries/approvals";
import { isDeliverablePastDue, type ClientDeliverable } from "@/lib/queries/deliverables";
import type { PortalPhase } from "@/lib/queries/portal";

function formatShortDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// "week of 18 Sept" per the plan's own case-4 example -- the phase's own
// planned-start date, formatted the same short way. This is the exact
// date the plan's own example names ("18 Sept"), not a Monday-of-week
// derivation the data doesn't carry -- inventing a "week starts on
// Monday" convention on top of a single date is exactly the kind of
// unsupported precision the honesty rule forbids.
function formatWeekOf(iso: string): string {
  return formatShortDate(iso);
}

type DatedCandidate = { dueAt: string | null; position: number; title: string };

// Earliest date first; undated candidates sort last (never treated as
// "most urgent" just because they lack a date), tie-broken by position
// for determinism.
function sortByUrgency(candidates: DatedCandidate[]): DatedCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return a.position - b.position;
  });
}

export function buildNextFromYouAnswer({
  approvals,
  deliverables,
  phases,
  todayIso,
}: {
  approvals: PortalApproval[];
  deliverables: ClientDeliverable[];
  phases: PortalPhase[];
  todayIso: string;
}): string {
  // Case 1: open approvals (with or without a due date) and past-due
  // deliverables are both "owed now" -- the plan lists them as one rung.
  const openApprovals = approvals.filter((approval) => approval.state === "pending");
  const pastDueDeliverables = deliverables.filter((deliverable) =>
    isDeliverablePastDue(deliverable.state, deliverable.dueAt, todayIso),
  );

  if (openApprovals.length > 0 || pastDueDeliverables.length > 0) {
    const candidates = sortByUrgency([
      ...openApprovals.map((approval, index) => ({
        dueAt: approval.dueAt,
        position: index,
        title: approval.title,
        verb: "sign off",
      })),
      ...pastDueDeliverables.map((deliverable) => ({
        dueAt: deliverable.dueAt,
        position: deliverable.position,
        title: deliverable.title,
        verb: "send over",
      })),
    ] as (DatedCandidate & { verb: string })[]);
    const chosen = candidates[0] as DatedCandidate & { verb: string };
    return chosen.dueAt
      ? `Next from you: ${chosen.verb} ${chosen.title} — expected around ${formatShortDate(chosen.dueAt)}.`
      : `Next from you: ${chosen.verb} ${chosen.title}.`;
  }

  // Case 2: the next scheduled deliverable not yet requested -- not a
  // decision (that is case 3), not already delivered, not past due
  // (that is case 1).
  const upcomingDeliverables = deliverables.filter(
    (deliverable) =>
      deliverable.kind !== "decision" &&
      deliverable.state === "not_started" &&
      !isDeliverablePastDue(deliverable.state, deliverable.dueAt, todayIso),
  );
  if (upcomingDeliverables.length > 0) {
    const next = sortByUrgency(
      upcomingDeliverables.map((deliverable) => ({
        dueAt: deliverable.dueAt,
        position: deliverable.position,
        title: deliverable.title,
      })),
    )[0];
    return next.dueAt
      ? `Next from you: ${next.title} — expected around ${formatShortDate(next.dueAt)}.`
      : `Next from you: ${next.title}.`;
  }

  // Case 3: the next phase requiring a client decision -- the same
  // `client_deliverables` rows, filtered to `kind === "decision"`.
  const pendingDecisions = deliverables.filter(
    (deliverable) =>
      deliverable.kind === "decision" &&
      deliverable.state !== "accepted" &&
      deliverable.state !== "waived" &&
      !isDeliverablePastDue(deliverable.state, deliverable.dueAt, todayIso),
  );
  if (pendingDecisions.length > 0) {
    const next = sortByUrgency(
      pendingDecisions.map((deliverable) => ({
        dueAt: deliverable.dueAt,
        position: deliverable.position,
        title: deliverable.title,
      })),
    )[0];
    return next.dueAt
      ? `Next from you: a decision on ${next.title} — expected around ${formatShortDate(next.dueAt)}.`
      : `Next from you: a decision on ${next.title}.`;
  }

  // Case 4: nothing pending. Told explicitly, per the plan's own
  // instruction that silence reads as neglect -- named with the next
  // phase's planned start when the phase list has one, otherwise no
  // invented date.
  const nextPhase = phases
    .filter((phase) => phase.state === "not_started")
    .sort((a, b) => a.position - b.position)[0];

  if (nextPhase?.plannedStart) {
    return `Nothing needed from you right now — next check-in around the start of ${nextPhase.name}, week of ${formatWeekOf(nextPhase.plannedStart)}.`;
  }
  if (nextPhase) {
    return `Nothing needed from you right now — next check-in around the start of ${nextPhase.name}.`;
  }
  return "Nothing needed from you right now.";
}
