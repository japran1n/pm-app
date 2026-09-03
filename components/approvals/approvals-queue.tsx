"use client";

// F010 (missions/20260903-portal, AS-027): the team-wide approvals queue
// — "the thing a PM checks every morning, not a report" (this feature's
// own scope note). Ordered by how long each request has been waiting
// (server-sorted, oldest first — this component never re-sorts). Three
// summary figures at the top (open count, oldest age, past-due count),
// then one row per open approval with a "what it blocks" column derived
// server-side (never PM-typed) and two actions: Withdraw (settles the
// row) and Copy link (the portal URL — the actual reminder channel now
// that email is out of scope for this mission, per the feature spec).
//
// Deliberately NO "Remind" button: a control that looks like it notifies
// and does not is worse than no control (explicit instruction in the
// feature spec) — Copy link is this screen's entire escalation
// mechanism.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link as LinkIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { withdrawApproval } from "@/lib/actions/approvals";
import type { WorkspaceApproval } from "@/lib/queries/approvals";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// F010: WorkspaceApproval plus the "who must decide" name, resolved once
// per (projectId, decisionType) pair by the page (lib/queries/approvals.ts's
// getDecisionOwnerNames) rather than re-fetched per row here.
export type ApprovalsQueueRow = WorkspaceApproval & {
  decisionOwnerName: string | null;
};

const DECISION_TYPE_LABEL: Record<WorkspaceApproval["decisionType"], string> = {
  content: "Content",
  brand: "Brand",
  technical: "Technical",
  commercial: "Commercial",
};

// Whole days since `iso`, floor — "3 days" means at least 3*24h have
// elapsed, matching this codebase's other "age in days" displays (e.g.
// the portal's own due-chip).
function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function isPastDue(approval: ApprovalsQueueRow): boolean {
  if (!approval.dueAt) return false;
  return new Date(approval.dueAt).getTime() < Date.now();
}

export function ApprovalsQueue({
  workspaceSlug,
  approvals,
}: {
  workspaceSlug: string;
  approvals: ApprovalsQueueRow[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (approvals.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm font-medium">No open approvals</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Every client decision across this workspace has been settled. New
          requests show up here the moment they&apos;re raised.
        </p>
      </div>
    );
  }

  // Already sorted oldest-first by the query (AS-027) — derive the
  // summary strip from that order rather than re-sorting.
  const oldest = approvals[0];
  const pastDueCount = approvals.filter(isPastDue).length;

  function handleWithdraw(approval: ApprovalsQueueRow) {
    setBusyId(approval.id);
    startTransition(async () => {
      const result = await withdrawApproval(approval.id);
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`"${approval.title}" withdrawn.`);
      router.refresh();
    });
  }

  function handleCopyLink(approval: ApprovalsQueueRow) {
    const url = `${window.location.origin}/portal/${workspaceSlug}/p/${approval.projectId}/approvals?approvalId=${approval.id}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        toast.success("Link copied — paste it wherever you already talk to this client.");
      })
      .catch(() => {
        toast.error("Couldn't copy the link. Please try again.");
      });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Summary strip (spec section 4): open count, oldest age, past-due
          count — the last two are what make a PM act. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryFigure label="Open approvals" value={String(approvals.length)} />
        <SummaryFigure
          label="Oldest waiting"
          value={`${daysSince(oldest.requestedAt)}d`}
          emphasize={daysSince(oldest.requestedAt) >= 3}
        />
        <SummaryFigure
          label="Past due"
          value={String(pastDueCount)}
          emphasize={pastDueCount > 0}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-4 py-2">What</th>
              <th className="px-4 py-2">Project</th>
              <th className="px-4 py-2">Decision</th>
              <th className="px-4 py-2">Who must decide</th>
              <th className="px-4 py-2">Waiting</th>
              <th className="px-4 py-2">What it blocks</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {approvals.map((approval) => {
              const waitingDays = daysSince(approval.requestedAt);
              const pastDue = isPastDue(approval);
              const busy = busyId === approval.id && isPending;

              return (
                <tr key={approval.id} className="align-top">
                  <td className="px-4 py-3 font-medium">{approval.title}</td>
                  <td className="px-4 py-3 text-muted-foreground">{approval.projectName}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{DECISION_TYPE_LABEL[approval.decisionType]}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {approval.decisionOwnerName ?? "Unassigned"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        pastDue ? "font-medium text-destructive" : "text-muted-foreground"
                      }
                    >
                      {waitingDays}d{pastDue ? " · past due" : ""}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {approval.blocks
                      ? approval.blocks.phaseName
                        ? `${approval.blocks.label} (${approval.blocks.phaseName})`
                        : approval.blocks.label
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => handleCopyLink(approval)}
                        aria-label={`Copy portal link for ${approval.title}`}
                      >
                        <LinkIcon className="size-3.5" aria-hidden="true" />
                        Copy link
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        disabled={busy}
                        onClick={() => handleWithdraw(approval)}
                      >
                        {busy ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        ) : null}
                        Withdraw
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryFigure({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${emphasize ? "text-destructive" : ""}`}>
        {value}
      </p>
    </div>
  );
}
