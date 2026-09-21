// F015/F016 (missions/20260903-portal): the Scope view's "Change
// requests" table — estimate, price, state, per the spec. F016 fills the
// pricing columns and per-request state ("Awaiting your approval",
// "Approved 21 Oct", "Declined 18 Sep") plus a link into the open
// approval, once a request has been triaged as scope_verdict =
// 'change_request'. Before that, the estimate/price columns are simply
// absent (not an empty cell) — F015's own explicit instruction: "an
// empty price column reads as 'free', which is the worst possible
// default."
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { ProjectChangeRequest } from "@/lib/queries/project-records";
import { formatDate, formatDateUTC } from "@/lib/format";

const STATUS_LABELS: Record<ProjectChangeRequest["status"], string> = {
  submitted: "Submitted",
  in_review: "In review",
  accepted: "Accepted",
  declined: "Declined",
};

function formatAmount(amount: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency ?? ""}`.trim();
  }
}

// AS-048: the state label a client reads for a quoted change request,
// independent of the underlying client_requests.status column (which
// tracks triage, not the quote decision).
//
// F016h: added the expired branch. `accept_client_request_atomic`'s
// CR048 (supabase/migrations/20261001010000…:660) refuses an approval
// once `quote_valid_until < current_date` — before this fix the label
// stayed "Awaiting your approval" forever for a quote the accept path
// would already reject, with nothing telling the client why their click
// fails.
export function quoteStateLabel(request: ProjectChangeRequest, today: string): string | null {
  if (request.scopeVerdict !== "change_request") return null;

  if (request.clientDecision === "approved" && request.decidedAt) {
    return `Approved ${formatDate(request.decidedAt)}`;
  }
  if (request.clientDecision === "rejected" && request.decidedAt) {
    return `Declined ${formatDate(request.decidedAt)}`;
  }
  if (request.quoteValidUntil && request.quoteValidUntil < today) {
    return "Expired";
  }
  return "Awaiting your approval";
}

export function ChangeRequestsTable({
  requests,
  workspaceSlug,
  projectId,
}: {
  requests: ProjectChangeRequest[];
  workspaceSlug?: string;
  projectId?: string;
}) {
  if (requests.length === 0) {
    return <p className="text-sm text-muted-foreground">No change requests yet.</p>;
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <ul className="flex flex-col gap-2" data-testid="change-requests-table">
      {requests.map((request) => {
        const quoteState = quoteStateLabel(request, today);

        return (
          <li key={request.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-foreground">{request.title}</p>
              <Badge variant="secondary">{STATUS_LABELS[request.status]}</Badge>
              {quoteState && (
                <Badge
                  variant={request.clientDecision === "approved" ? "default" : "outline"}
                  data-testid={`quote-state-${request.id}`}
                >
                  {quoteState}
                </Badge>
              )}
              {request.clientDecision === "pending" &&
                request.scopeVerdict === "change_request" &&
                request.approvalRequestId &&
                workspaceSlug &&
                projectId && (
                  <Link
                    href={`/portal/${workspaceSlug}/p/${projectId}/for-you?filter=decisions`}
                    className="text-xs font-medium text-primary underline underline-offset-2"
                  >
                    Review this quote
                  </Link>
                )}
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {formatDate(request.createdAt)}
              </span>
            </div>
            {request.body && (
              <p className="mt-1 text-sm text-muted-foreground">{request.body}</p>
            )}
            {request.scopeVerdict === "change_request" && (
              <div
                className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
                data-testid={`quote-details-${request.id}`}
              >
                {request.quotedHours != null && <span>Estimate: <span className="font-mono">{request.quotedHours}h</span></span>}
                {request.quotedAmount != null && (
                  <span>Price: <span className="font-mono">{formatAmount(request.quotedAmount, request.quoteCurrency)}</span></span>
                )}
                {request.quoteValidUntil && (
                  <span>Valid until <span className="font-mono">{formatDateUTC(request.quoteValidUntil)}</span></span>
                )}
              </div>
            )}
            {request.status === "declined" && request.declineReason && (
              <p className="mt-1 text-xs text-muted-foreground">
                Declined: {request.declineReason}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
