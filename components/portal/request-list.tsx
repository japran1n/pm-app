"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { withdrawClientRequest } from "@/lib/actions/client-requests";
import type { PortalRequest } from "@/lib/queries/portal";
import { Button } from "@/components/ui/button";

const STATUS_LABEL: Record<PortalRequest["status"], string> = {
  submitted: "Waiting for review",
  in_review: "Being reviewed",
  accepted: "Accepted",
  declined: "Declined",
};

const STATUS_CLASS: Record<PortalRequest["status"], string> = {
  submitted: "text-muted-foreground",
  in_review: "text-blue-600 dark:text-blue-400",
  accepted: "text-emerald-600 dark:text-emerald-400",
  declined: "text-destructive",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function RequestList({ requests }: { requests: PortalRequest[] }) {
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // See TeamRequestInbox: an action called from an event handler needs an
  // explicit refresh for its revalidation to reach the screen.
  const router = useRouter();

  if (requests.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-8 text-center">
        <p className="text-sm font-medium">No requests yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Anything you send will show up here with its status.
        </p>
      </div>
    );
  }

  const handleWithdraw = (requestId: string) => {
    setWithdrawingId(requestId);
    startTransition(async () => {
      const result = await withdrawClientRequest(requestId);
      setWithdrawingId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Request withdrawn.");
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-medium tracking-tight">Sent</h2>

      <ul className="flex flex-col gap-3">
        {requests.map((request) => (
          <li
            key={request.id}
            className="flex flex-col gap-3 rounded-lg border border-border p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-col gap-1">
                <span className="font-medium">{request.title}</span>
                <span className="text-xs text-muted-foreground">
                  {request.projectName} · sent {formatDate(request.createdAt)}
                  {request.desiredBy
                    ? ` · needed by ${formatDate(request.desiredBy)}`
                    : ""}
                </span>
              </div>

              <span
                className={`text-xs font-medium ${STATUS_CLASS[request.status]}`}
              >
                {STATUS_LABEL[request.status]}
              </span>
            </div>

            {request.body && (
              <p className="text-sm text-muted-foreground">{request.body}</p>
            )}

            {/* The decision, in the client's own view. A bare "declined"
                with the reason living only in the team's inbox is what
                produces the follow-up email asking why. */}
            {request.status === "declined" && request.declineReason && (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                {request.declineReason}
              </p>
            )}

            {request.status === "accepted" && (
              <p className="rounded-md border border-emerald-600/30 bg-emerald-600/5 p-3 text-sm">
                {request.convertedTaskTitle
                  ? `On the board as "${request.convertedTaskTitle}"${
                      request.convertedTaskStatus
                        ? ` — ${request.convertedTaskStatus.replace(/_/g, " ")}`
                        : ""
                    }.`
                  : "Accepted and added to the project."}
              </p>
            )}

            {request.status === "submitted" && (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleWithdraw(request.id)}
                  disabled={isPending && withdrawingId === request.id}
                >
                  {isPending && withdrawingId === request.id ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Withdrawing...
                    </>
                  ) : (
                    "Withdraw"
                  )}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
