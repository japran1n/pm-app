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
import { Check, ExternalLink, Loader2, MessageSquareWarning } from "lucide-react";
import { toast } from "sonner";

import { decideApproval } from "@/lib/actions/portal-approval";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PortalApproval } from "@/lib/queries/approvals";
import { cn } from "@/lib/utils";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

const DECISION_TYPE_LABEL: Record<PortalApproval["decisionType"], string> = {
  content: "Content",
  brand: "Brand",
  technical: "Technical",
  commercial: "Commercial",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
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

  const overdue = approval.dueAt !== null && approval.dueAt < todayIso();
  const href = artifactHref(approval, workspaceSlug, projectId);
  const isExternal = href !== null && approval.subjectType !== "task";

  return (
    <div
      data-testid="approval-card"
      className="flex flex-col gap-3 rounded-lg border border-border p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-tag text-muted-foreground">
          {DECISION_TYPE_LABEL[approval.decisionType]}
        </span>
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
            {overdue ? "Overdue" : `Due ${formatDate(approval.dueAt)}`}
          </span>
        )}
      </div>

      <h3 className="text-sm font-semibold">{approval.title}</h3>
      {approval.description && (
        <p className="text-sm text-muted-foreground">{approval.description}</p>
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
              {formatDate(settled.decidedAt)}.
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
              control. See this file's header comment. */}
          {!isOwner && (
            <p className="text-xs text-muted-foreground">
              {ownerName ? `Only ${ownerName} can decide this.` : "No one is assigned to decide this yet."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
