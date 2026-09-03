// F015 (missions/20260903-portal): the Scope view's "Change requests"
// table — estimate, price, state, per the spec. F016 fills the pricing
// columns (estimate/price); until it lands, this renders only what
// exists (title, status, desired-by, created) rather than an empty money
// column, per this feature's own explicit instruction: "an empty price
// column reads as 'free', which is the worst possible default."
import { Badge } from "@/components/ui/badge";
import type { ProjectChangeRequest } from "@/lib/queries/project-records";

const STATUS_LABELS: Record<ProjectChangeRequest["status"], string> = {
  submitted: "Submitted",
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

export function ChangeRequestsTable({ requests }: { requests: ProjectChangeRequest[] }) {
  if (requests.length === 0) {
    return <p className="text-sm text-muted-foreground">No change requests yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2" data-testid="change-requests-table">
      {requests.map((request) => (
        <li key={request.id} className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">{request.title}</p>
            <Badge variant="secondary">{STATUS_LABELS[request.status]}</Badge>
            <span className="ml-auto text-xs text-muted-foreground">
              {formatDate(request.createdAt)}
            </span>
          </div>
          {request.body && (
            <p className="mt-1 text-sm text-muted-foreground">{request.body}</p>
          )}
          {request.status === "declined" && request.declineReason && (
            <p className="mt-1 text-xs text-muted-foreground">
              Declined: {request.declineReason}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
