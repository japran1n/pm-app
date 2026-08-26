"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import {
  acceptClientRequest,
  declineClientRequest,
} from "@/lib/actions/client-requests";
import type { TeamClientRequest } from "@/lib/queries/client-requests";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const STATUS_LABEL: Record<TeamClientRequest["status"], string> = {
  submitted: "New",
  in_review: "In review",
  accepted: "Accepted",
  declined: "Declined",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function TeamRequestInbox({
  requests,
  workspaceSlug,
}: {
  requests: TeamClientRequest[];
  workspaceSlug: string;
}) {
  // Which request currently has its decline box open, and what has been
  // typed into it. A decline without a reason is rejected by the action and
  // by a DB constraint, so the reason is collected inline rather than
  // letting someone click Decline and then discover it needs an argument.
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // The actions revalidate the route, but a revalidation triggered from an
  // event handler (rather than from a form action) does not re-render the
  // page on its own — without this the card keeps offering Accept/Decline
  // for a request that has already been decided, which invites a second
  // click and a duplicate task.
  const router = useRouter();

  if (requests.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-8 text-center">
        <p className="text-sm font-medium">No client requests</p>
        <p className="mt-1 text-sm text-muted-foreground">
          When a client sends one from their portal, it lands here.
        </p>
      </div>
    );
  }

  const handleAccept = (request: TeamClientRequest) => {
    setBusyId(request.id);
    startTransition(async () => {
      const result = await acceptClientRequest(request.id);
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`"${request.title}" is on the board and shared back.`);
      router.refresh();
    });
  };

  const handleDecline = (request: TeamClientRequest) => {
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error("Give the client a reason.");
      return;
    }

    setBusyId(request.id);
    startTransition(async () => {
      const result = await declineClientRequest(request.id, trimmed);
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDecliningId(null);
      setReason("");
      toast.success("Declined, with your reason sent back.");
      router.refresh();
    });
  };

  return (
    <ul className="flex flex-col gap-3">
      {requests.map((request) => {
        const busy = isPending && busyId === request.id;
        const undecided =
          request.status === "submitted" || request.status === "in_review";

        return (
          <li
            key={request.id}
            className="flex flex-col gap-3 rounded-lg border border-border p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-col gap-1">
                <span className="font-medium">{request.title}</span>
                <span className="text-xs text-muted-foreground">
                  {request.requesterName ?? request.requesterEmail ?? "A client"}{" "}
                  · {request.projectName} · {formatDate(request.createdAt)}
                  {request.desiredBy
                    ? ` · needs it by ${formatDate(request.desiredBy)}`
                    : ""}
                </span>
              </div>

              <span className="text-xs font-medium text-muted-foreground">
                {STATUS_LABEL[request.status]}
              </span>
            </div>

            {request.body && (
              <p className="text-sm text-muted-foreground">{request.body}</p>
            )}

            {request.status === "declined" && request.declineReason && (
              <p className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                Declined: {request.declineReason}
              </p>
            )}

            {request.status === "accepted" && request.convertedTaskId && (
              <Link
                href={`/w/${workspaceSlug}/projects/${request.projectId}/board`}
                className="w-fit text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                View on the board
              </Link>
            )}

            {undecided && decliningId !== request.id && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleAccept(request)}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Check className="size-4" aria-hidden="true" />
                  )}
                  Accept &amp; create task
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDecliningId(request.id);
                    setReason("");
                  }}
                  disabled={busy}
                >
                  <X className="size-4" aria-hidden="true" />
                  Decline
                </Button>
              </div>
            )}

            {undecided && decliningId === request.id && (
              <div className="flex flex-col gap-2">
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={2}
                  maxLength={1000}
                  placeholder="Why not? The client sees this."
                  disabled={busy}
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => handleDecline(request)}
                    disabled={busy}
                  >
                    {busy ? (
                      <Loader2
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : null}
                    Send decline
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setDecliningId(null);
                      setReason("");
                    }}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
