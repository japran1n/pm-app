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
import NextLink from "next/link";
import { Link as LinkIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { withdrawApproval } from "@/lib/actions/approvals";
import type { WorkspaceApproval } from "@/lib/queries/approvals";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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
    // F013 (AS-017): the copy-link target is the live "For you" route,
    // not the dead `approvals` redirect -- `approvalId` is carried
    // through so For you can scroll to and highlight this row.
    const url = `${window.location.origin}/portal/${workspaceSlug}/p/${approval.projectId}/for-you?filter=decisions&approvalId=${approval.id}`;
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
        <SummaryFigure label="Open approvals" value={String(approvals.length)} mono />
        <SummaryFigure
          label="Oldest waiting"
          value={`${daysSince(oldest.requestedAt)}d`}
          emphasize={daysSince(oldest.requestedAt) >= 3}
          mono
        />
        <SummaryFigure
          label="Past due"
          value={String(pastDueCount)}
          emphasize={pastDueCount > 0}
          mono
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="py-2 pl-6 pr-4 lg:pl-8">What</th>
              <th className="px-4 py-2">Project</th>
              <th className="px-4 py-2">Decision</th>
              <th className="px-4 py-2">Who must decide</th>
              <th className="px-4 py-2">Waiting</th>
              <th className="px-4 py-2">What it blocks</th>
              <th className="py-2 pl-4 pr-6 lg:pr-8" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {approvals.map((approval) => {
              const waitingDays = daysSince(approval.requestedAt);
              const pastDue = isPastDue(approval);
              const busy = busyId === approval.id && isPending;

              // F083: "What" links through to the underlying task/doc when
              // the queue row has one to link to — a task-subject approval
              // deep-links into the board the same way My Tasks/Timeline
              // already do (`?taskId=` — see e.g. my-tasks/page.tsx), a
              // doc-subject approval links to the doc editor. `phase` and
              // `artifact` subjects (and any task/doc whose subject row has
              // since been deleted, per WorkspaceApproval's own comment)
              // have no single destination page, so those stay plain text
              // rather than link to something that 404s.
              const whatHref =
                approval.subjectId && approval.subjectType === "task"
                  ? `/w/${workspaceSlug}/projects/${approval.projectId}/board?taskId=${approval.subjectId}`
                  : approval.subjectId && approval.subjectType === "doc"
                    ? `/w/${workspaceSlug}/docs/${approval.subjectId}`
                    : null;

              return (
                <tr key={approval.id} className="align-top hover:bg-muted/50">
                  <td className="py-3 pl-6 pr-4 font-medium lg:pl-8">
                    {whatHref ? (
                      <NextLink href={whatHref} className="underline-offset-2 hover:underline">
                        {approval.title}
                      </NextLink>
                    ) : (
                      approval.title
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <NextLink
                      href={`/w/${workspaceSlug}/projects/${approval.projectId}/board`}
                      className="underline-offset-2 hover:underline"
                    >
                      {approval.projectName}
                    </NextLink>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{DECISION_TYPE_LABEL[approval.decisionType]}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {approval.decisionOwnerName ?? (
                      // F083: "Unassigned" links straight to the settings
                      // panel that fixes it (project settings' own
                      // DecisionOwnersSection) — the very problem this
                      // screen exists to surface should be one click from
                      // its fix.
                      <NextLink
                        href={`/w/${workspaceSlug}/projects/${approval.projectId}/settings`}
                        className="underline-offset-2 hover:underline"
                      >
                        Unassigned
                      </NextLink>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        pastDue ? "font-mono font-medium text-destructive" : "font-mono text-muted-foreground"
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
                  <td className="py-3 pl-4 pr-6 lg:pr-8">
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
                      {/* F083: withdrawal is permanent —
                          prevent_approval_request_settled_update
                          (lib/actions/approvals.ts's own comment on
                          withdrawApproval) rejects any further update once
                          state leaves 'pending', for every caller including
                          the service-role admin client. One unconfirmed
                          click on the most destructive control on a screen
                          a PM scans every morning was the gap; this matches
                          the AlertDialog pattern used for the equally
                          irreversible phase delete
                          (components/project/phase-list.tsx). */}
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button variant="outline" size="sm" type="button" disabled={busy}>
                              {busy ? (
                                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                              ) : null}
                              Withdraw
                            </Button>
                          }
                        />
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Withdraw &ldquo;{approval.title}&rdquo;?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              The client&apos;s pending decision disappears and
                              cannot be reopened — it can only be re-raised as
                              a brand new request.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleWithdraw(approval)}>
                              Withdraw
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
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
  mono = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-4 hover-lift">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${emphasize ? "text-destructive" : ""} ${mono ? "font-mono" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
