"use client";

// F009 (missions/20260903-portal, AS-021/AS-022/AS-023): one open approval
// card -- kind eyebrow, title, due chip (blocked when overdue, waiting
// otherwise), body text, then Approve / Request changes / open-artifact
// link. Supersedes `components/portal/approval-actions.tsx`'s
// task-boolean approve/reject pair for this feature's first-class
// `approval_requests` rows: same ref-guard + optimistic-apply + manual-
// revert-on-failure shape (see that file's own header comment for why it
// isn't `use-optimistic-action.ts`), generalised from "one task" to "one
// approval request, keyed by its own id" and wired to `decideApproval`
// (lib/actions/portal-approval.ts) instead of the two task-flag RPCs.
//
// AS-022: `isOwner` is presentation only -- a non-owner sees the buttons
// disabled with a line naming who decides, but nothing here is the
// control. `decideApproval` calls `decide_approval_atomic`, which
// re-checks `auth.uid()` against `project_decision_owners` itself,
// independent of this prop ever being wrong or stale.
//
// After a decision the card settles IN PLACE, showing what was decided
// and when -- it is never removed from the list on success, so a client
// who clicks Approve can tell success from a crash (this feature's own
// explicit instruction).
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Check, ExternalLink, Loader2, MessageSquareWarning } from "lucide-react";
import { toast } from "sonner";

import { decideApproval, nudgeApprovalOwner } from "@/lib/actions/portal-approval";
import { getApprovalDocSnapshotUrl } from "@/lib/actions/approvals";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PortalApproval } from "@/lib/queries/approvals";
import { cn } from "@/lib/utils";
import { formatDayMonthUTC } from "@/lib/format";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// F110 (missions/20260903-portal): the age bar's scale. `requestedAt` is a
// `timestamptz`; `dueAt` (when present) is the same date-only convention
// documented on `formatDate` above -- both are collapsed to UTC calendar
// midnight before differencing so a client mid-timezone gets whole-day
// counts, not fractional ones that shift with time of day.
function utcMidnight(iso: string): number {
  const isoWithTime = iso.includes("T") ? iso : `${iso}T00:00:00Z`;
  const d = new Date(isoWithTime);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((utcMidnight(toIso) - utcMidnight(fromIso)) / 86_400_000);
}

function artifactHref(
  approval: PortalApproval,
  workspaceSlug: string,
  projectId: string,
): string | null {
  if (approval.subjectType === "task" && approval.subjectId) {
    return `/portal/${workspaceSlug}/p/${projectId}/t/${approval.subjectId}`;
  }
  if (approval.artifactUrl) {
    return approval.artifactUrl;
  }
  return null;
}

export function ApprovalCard({
  approval,
  workspaceSlug,
  projectId,
  isOwner,
  ownerName,
  ownerId = null,
}: {
  approval: PortalApproval;
  workspaceSlug: string;
  projectId: string;
  /** AS-022: presentation only -- see this file's header comment. */
  isOwner: boolean;
  /** The named decision owner for this approval's decision type, or
   * `null` when no one is assigned yet -- rendered as an honest "no
   * owner assigned" line rather than pretending nobody needs to know. */
  ownerName: string | null;
  /** F085 (missions/20260903-portal audit, defect 6), replaced by F090
   * item 3: lets a non-owner actually reach the named owner instead of
   * just being told a name. Originally a `mailto:` built from an
   * `ownerEmail` prop -- now `nudgeApprovalOwner` (lib/actions/
   * portal-approval.ts) re-derives the current owner server-side from
   * `project_decision_owners` and sends a real in-app notification, so
   * this prop only gates whether the button renders at all (`null` means
   * "no owner assigned yet", same honesty convention as `ownerName`) --
   * it is never sent to the server. Optional/defaulted so every
   * pre-existing caller that predates this field stays valid. */
  ownerId?: string | null;
}) {
  const [isRequestingChanges, setIsRequestingChanges] = useState(false);
  const [message, setMessage] = useState("");
  const [settled, setSettled] = useState<
    {
      decision: "approved" | "changes_requested";
      decidedAt: string;
      note: string | null;
      // F011 (AS-025): present once the server round trip confirms a
      // task was created; absent during the optimistic pre-confirm
      // render (see handleDecision below) so the "logged as work" line
      // never appears before it is actually true.
      resultingTaskId?: string | null;
    } | null
  >(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // F009c: opening a doc-subject approval's snapshot is a separate async
  // round trip (a fresh signed URL, same convention as
  // components/portal/file-list.tsx) from the decide transition above --
  // its own pending state so clicking "Open" never disables Approve.
  const [isOpeningDoc, startOpenDocTransition] = useTransition();

  // F090 item 3: same "settle in place, never remove the affordance"
  // shape as `settled` above for the decide actions -- once a nudge
  // succeeds the button becomes a confirmation, not a re-triggerable
  // action (matches this card's own "success is durable feedback, not a
  // toast that vanishes" convention).
  const [nudgeSent, setNudgeSent] = useState(false);
  const [isNudging, startNudgeTransition] = useTransition();

  const handleNudgeOwner = () => {
    startNudgeTransition(async () => {
      const result = await nudgeApprovalOwner(approval.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setNudgeSent(true);
      toast.success(ownerName ? `${ownerName} was notified.` : "The decision owner was notified.");
    });
  };

  const handleOpenDocSnapshot = () => {
    startOpenDocTransition(async () => {
      const result = await getApprovalDocSnapshotUrl(approval.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      window.open(result.signedUrl, "_blank", "noopener,noreferrer");
    });
  };

  // Same synchronous in-flight guard as approval-actions.tsx -- `isPending`
  // alone lags a same-tick second click.
  const inFlightRef = useRef(false);

  const handleDecision = (decision: "approved" | "changes_requested", note: string | null) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    const decidedAt = new Date().toISOString();
    setSettled({ decision, decidedAt, note });

    startTransition(async () => {
      try {
        const result = await decideApproval(approval.id, decision, note);

        if (!result.ok) {
          setSettled(null);
          toast.error(result.error);
          return;
        }

        toast.success(decision === "approved" ? "Approved." : "Sent — the team will follow up.");
        if (decision === "changes_requested") {
          setMessage("");
          setIsRequestingChanges(false);
          // F011 (AS-025): fill in what actually happened server-side —
          // the settled card names the task the decision created.
          setSettled((current) =>
            current ? { ...current, resultingTaskId: result.data.resultingTaskId } : current,
          );
        }
        router.refresh();
      } catch {
        setSettled(null);
        toast.error(GENERIC_ERROR);
      } finally {
        inFlightRef.current = false;
      }
    });
  };

  const handleApprove = () => handleDecision("approved", null);

  const handleRequestChanges = () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    handleDecision("changes_requested", trimmed);
  };

  const today = todayIso();
  const overdue = approval.dueAt !== null && approval.dueAt < today;
  const href = artifactHref(approval, workspaceSlug, projectId);
  const isExternal = href !== null && approval.subjectType !== "task";

  // F110 (missions/20260903-portal, plan section 3.5): the age bar's axis
  // is "days from request to due date", NOT a plain 0-100% of elapsed
  // time against some open-ended max -- that would make an approval two
  // months old and one three days old both read as "getting full", and
  // it would make a *past-due* item look no different from one that
  // landed exactly on its due date, which is the one failure mode this
  // feature's own brief calls out by name. Concretely: fill width is
  // elapsed-days-since-requested as a fraction of the requested-to-due
  // span, clamped to 100% at the due date itself; the due date always
  // sits at the right edge of the track (a fixed reference point, not a
  // moving one) so "the fill reached the marker" always means "at or
  // past due" and nothing else. Once the request is actually overdue,
  // the fill is re-coloured (status-blocked, same token the due chip
  // above already uses for overdue) AND a fixed "N days overdue" line
  // with a warning icon appears -- text and icon, not colour alone, so
  // greyscale/CVD viewing still reads it correctly (chart rule: no
  // colour-only encoding).
  const daysWaited = Math.max(0, daysBetween(approval.requestedAt, today));
  const overdueDays = approval.dueAt ? Math.max(0, daysBetween(approval.dueAt, today)) : 0;
  const totalSpanDays = approval.dueAt ? daysBetween(approval.requestedAt, approval.dueAt) : null;
  // Guard against malformed data (a due date on/before the request date)
  // the same way division-by-zero guards elsewhere in this codebase do:
  // fall back to "fully elapsed" rather than NaN/Infinity, since a due
  // date that isn't after the request date has, by definition, already
  // been reached.
  const ageFraction =
    totalSpanDays === null
      ? null
      : totalSpanDays <= 0
        ? 1
        : Math.min(1, daysWaited / totalSpanDays);
  const daysWaitedLabel =
    daysWaited <= 0 ? "Raised today" : daysWaited === 1 ? "Waiting 1 day" : `Waiting ${daysWaited} days`;
  const ageBarAriaLabel = approval.dueAt
    ? overdue
      ? `Raised ${formatDayMonthUTC(approval.requestedAt)}. ${overdueDays === 1 ? "1 day" : `${overdueDays} days`} past the ${formatDayMonthUTC(approval.dueAt)} due date.`
      : `Raised ${formatDayMonthUTC(approval.requestedAt)}. Due ${formatDayMonthUTC(approval.dueAt)}.`
    : undefined;

  return (
    <div
      data-testid="approval-card"
      className="flex flex-col gap-3 rounded-lg border border-border p-5"
    >
      <div className="flex items-center justify-between gap-3">
        {/* Decision types are per-project and customizable now
            (project_decision_types) — this is the type's own name, as
            configured on the project, not a fixed 4-value label lookup. */}
        <span className="text-xs font-medium uppercase tracking-[0.07em] text-muted-foreground">{approval.decisionType}</span>
        {!settled && approval.dueAt && (
          <span
            data-testid="approval-due-chip"
            data-overdue={overdue ? "true" : "false"}
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              overdue
                ? "bg-status-blocked-bg text-status-blocked"
                : "bg-status-waiting-bg text-status-waiting",
            )}
          >
            {overdue ? "Overdue" : `Due ${formatDayMonthUTC(approval.dueAt)}`}
          </span>
        )}
      </div>

      <h3 className="text-sm font-semibold">{approval.title}</h3>
      {approval.description && (
        <p className="text-sm text-muted-foreground">{approval.description}</p>
      )}

      {/* F085 (missions/20260903-portal audit, defect 6): `requestedAt`
          and `round` were both fetched and never shown -- a client
          couldn't tell a request raised this morning from one raised
          three weeks ago, or a fresh ask from a re-submission of
          something they already sent back. Both render here, always
          (not gated on `dueAt` the way the chip above is). */}
      <p data-testid="approval-requested-meta" className="text-xs text-muted-foreground">
        Requested {formatDayMonthUTC(approval.requestedAt)}
        {approval.round > 1 ? ` · Round ${approval.round}` : ""}
      </p>

      {/* F110: the age bar only makes sense for an open approval -- once
          `settled`, the card already shows what happened and when
          (the "Approved on"/"Changes requested on" block below), so a
          bar measuring time-still-waiting would be stale and misleading. */}
      {!settled && (
        <div data-testid="approval-age" className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{daysWaitedLabel}</span>
            {/* No colour-only encoding: overdue is named in text with an
                icon, never left to the bar's colour alone. */}
            {overdue && (
              <span className="flex items-center gap-1 font-medium text-status-blocked">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                {overdueDays === 1 ? "1 day overdue" : `${overdueDays} days overdue`}
              </span>
            )}
          </div>
          {/* Guard: an approval with no due date has no second point to
              scale a bar against -- rather than fabricate one, this
              renders the "days waited" text above with no bar at all
              (the honest version of what this card used to render
              nothing for). */}
          {approval.dueAt && ageFraction !== null && (
            <div
              className="group relative flex h-4 w-full items-center"
              title={ageBarAriaLabel}
            >
              <div
                data-testid="approval-age-bar"
                role="img"
                aria-label={ageBarAriaLabel}
                className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
              >
                <div
                  data-testid="approval-age-bar-fill"
                  data-overdue={overdue ? "true" : "false"}
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full",
                    overdue ? "bg-status-blocked" : "bg-status-waiting",
                  )}
                  style={{ width: `${Math.round(ageFraction * 100)}%` }}
                />
                {/* Due-date marker, always pinned to the right edge (the
                    fixed reference point the fill is measured against).
                    The 2px halo (matching the card surface) is the
                    2px-gap-between-adjacent-fills chart rule applied to
                    a fill-plus-marker pair rather than two series. */}
                <div
                  aria-hidden="true"
                  data-testid="approval-age-bar-due-marker"
                  className="absolute inset-y-0 right-0 w-[2px] rounded-full bg-foreground/60"
                  style={{ boxShadow: "0 0 0 2px var(--card)" }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {href && (
        <Link
          href={href}
          target={isExternal ? "_blank" : undefined}
          rel={isExternal ? "noopener noreferrer" : undefined}
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          {isExternal ? <ExternalLink className="size-3.5" aria-hidden="true" /> : null}
          Open
        </Link>
      )}

      {/* F009c: a doc-subject approval has no static href -- its snapshot
          lives in a private bucket with no public/anon-readable policy,
          so opening it requires a fresh signed URL per click (same
          convention as components/portal/file-list.tsx). */}
      {!href && approval.subjectType === "doc" && approval.artifactSnapshotPath && (
        <button
          type="button"
          onClick={handleOpenDocSnapshot}
          disabled={isOpeningDoc}
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline disabled:opacity-60"
        >
          {isOpeningDoc ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <ExternalLink className="size-3.5" aria-hidden="true" />
          )}
          Open
        </button>
      )}

      {settled ? (
        <div
          className={cn(
            "flex flex-col gap-1 rounded-lg border p-3 text-sm font-medium",
            settled.decision === "approved"
              ? "border-emerald-600/30 bg-emerald-600/5"
              : "border-amber-600/30 bg-amber-600/5",
          )}
        >
          <div className="flex items-center gap-2">
            {settled.decision === "approved" ? (
              <Check className="size-4 text-emerald-600" aria-hidden="true" />
            ) : (
              <MessageSquareWarning className="size-4" aria-hidden="true" />
            )}
            <span>
              {settled.decision === "approved" ? "Approved" : "Changes requested"} on{" "}
              {formatDayMonthUTC(settled.decidedAt)}.
            </span>
          </div>
          {/* F011 (AS-025): names the task that was created, without ever
              linking to it -- a client-created task is not client_visible
              by default (the RPC's own migration comment), so this is
              deliberately text, not a Link, regardless of the id being
              known here. */}
          {settled.decision === "changes_requested" && settled.resultingTaskId && (
            <p className="text-xs font-normal text-muted-foreground">
              We&apos;ve logged this as work for the team.
            </p>
          )}
        </div>
      ) : isRequestingChanges ? (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-600/30 bg-amber-600/5 p-4">
          <p className="text-sm font-medium">What needs to change?</p>
          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Describe what you'd like changed…"
            disabled={isPending || !isOwner}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => {
                setIsRequestingChanges(false);
                setMessage("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isPending || !isOwner || !message.trim()}
              onClick={handleRequestChanges}
            >
              {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Send
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={isPending || !isOwner} onClick={handleApprove}>
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="size-4" aria-hidden="true" />
              )}
              Approve
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending || !isOwner}
              onClick={() => setIsRequestingChanges(true)}
            >
              <MessageSquareWarning className="size-4" aria-hidden="true" />
              Request changes
            </Button>
          </div>
          {/* AS-022: presentation only -- naming who decides, not a
              control. See this file's header comment.
              F085 (defect 6): naming who decides used to be the end of
              the line for a non-owner -- buttons disabled, nothing else
              to do. `ownerEmail` turns "Only Maria can decide this" into
              an actual way to reach Maria; the unassigned case instead
              points at Approvals' own "Who approves what" grid
              (DecisionOwnersGrid, this feature's own sibling fix), the
              one place a client can see who else to raise it with. */}
          {!isOwner && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                {ownerName ? `Only ${ownerName} can decide this.` : "No one is assigned to decide this yet."}
              </span>
              {ownerName && ownerId && !nudgeSent && (
                <button
                  type="button"
                  onClick={handleNudgeOwner}
                  disabled={isNudging}
                  data-testid="nudge-owner-button"
                  className="font-medium text-primary hover:underline disabled:opacity-60"
                >
                  {isNudging ? "Notifying…" : `Ask ${ownerName} to take a look`}
                </button>
              )}
              {ownerName && ownerId && nudgeSent && (
                <span data-testid="nudge-owner-sent" className="font-medium text-muted-foreground">
                  {ownerName} was notified.
                </span>
              )}
              {!ownerName && (
                <Link
                  href={`/portal/${workspaceSlug}/p/${projectId}/approvals`}
                  className="font-medium text-primary hover:underline"
                >
                  See who to raise it with
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
