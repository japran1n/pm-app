"use client";

// F014 (missions/20260903-portal, AS-029, AS-030, AS-032): one row of the
// Your list view's two lists.
//
// "Outstanding" rows (not yet accepted) carry the left rule token
// (blocked = past due, waiting = still open or delivered-and-pending),
// the owner name, the derived "what it holds up" line
// (lib/queries/deliverables.ts's `holdsUp`, never typed by the PM — this
// feature's own spec, verbatim), and one of three trailing states:
//   - not yet delivered: the upload control (`DeliverableUpload`).
//   - delivered, awaiting review: "Waiting for us to check it." — no
//     upload control (AS-030: it stays outstanding until accepted, and
//     re-sending before the team has even looked would just create a
//     second signal to reconcile).
//   - returned (state back at `in_progress` with a `review_note` set,
//     per `accept_deliverable_atomic`'s own "returned" branch,
//     20260927010000): the note shown inline, plus the upload control
//     again so the client can re-send.
//
// "Settled" rows (accepted/waived) render muted, with the acceptance
// date, no upload control — AS-029's own "separately from open and
// past-due items".
import { useState } from "react";
import { CheckCircle2, Clock } from "lucide-react";

import type {
  PortalDeliverable,
  DeliverableState,
  DeliverableKind,
} from "@/lib/queries/deliverables";
import { DeliverableUpload } from "@/components/portal/deliverable-upload";
import { cn } from "@/lib/utils";
import { formatDayMonthUTC } from "@/lib/format";

function isPastDue(dueAt: string | null, today: string): boolean {
  return Boolean(dueAt && dueAt < today);
}

const KIND_LABEL: Record<DeliverableKind, string> = {
  copy: "Copy",
  image: "Image",
  access: "Access",
  decision: "Decision",
  data: "Data",
  other: "Other",
};

export function DeliverableRow({
  deliverable,
  today,
  variant,
}: {
  deliverable: PortalDeliverable;
  /** ISO `YYYY-MM-DD`, computed once by the Server Component page and
   * passed down so every row in the list agrees on "today" (never each
   * row computing `new Date()` independently, which could disagree
   * across a render that straddles midnight). */
  today: string;
  variant: "outstanding" | "settled";
}) {
  const [state, setState] = useState<DeliverableState>(deliverable.state);
  const [deliveredAt, setDeliveredAt] = useState(deliverable.deliveredAt);

  if (variant === "settled") {
    return (
      <li
        data-testid="deliverable-row-settled"
        className="flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-foreground">{deliverable.title}</span>
          <span className="flex items-center gap-1.5 shrink-0">
            <CheckCircle2 className="size-4 text-status-done" aria-hidden="true" />
            {deliverable.state === "waived"
              ? "Waived"
              : deliverable.acceptedAt
                ? `Accepted ${formatDayMonthUTC(deliverable.acceptedAt)}`
                : "Accepted"}
          </span>
        </div>
        <span>{deliverable.ownerName}</span>
      </li>
    );
  }

  const pastDue = isPastDue(deliverable.dueAt, today);
  const isReturned = state === "in_progress" && Boolean(deliverable.reviewNote);
  const isDelivered = state === "delivered";
  const ruleToken = pastDue ? "border-status-blocked" : "border-status-waiting";

  return (
    <li
      data-testid="deliverable-row-outstanding"
      data-state={state}
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-l-4 border-border/60 bg-card px-4 py-3 text-sm",
        ruleToken,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">{deliverable.title}</span>
          <span className="text-muted-foreground">{deliverable.ownerName}</span>
          {deliverable.holdsUp.label && (
            <span className="text-muted-foreground">{deliverable.holdsUp.label}</span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <span className={cn("text-xs font-medium", pastDue ? "text-status-blocked" : "text-muted-foreground")}>
            {deliverable.dueAt
              ? `${pastDue ? "Was due" : "Due"} ${formatDayMonthUTC(deliverable.dueAt)}`
              : "No due date"}
          </span>
          <span className="text-xs text-muted-foreground">{KIND_LABEL[deliverable.kind]}</span>
        </div>
      </div>

      {isReturned && deliverable.reviewNote && (
        <p
          data-testid="deliverable-review-note"
          className="rounded-md bg-status-blocked-bg px-3 py-2 text-sm text-status-blocked"
        >
          Sent back: {deliverable.reviewNote}
        </p>
      )}

      {isDelivered ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Clock className="size-4" aria-hidden="true" />
          Waiting for us to check it{deliveredAt ? ` (sent ${formatDayMonthUTC(deliveredAt)})` : ""}.
        </p>
      ) : (
        <DeliverableUpload
          deliverableId={deliverable.id}
          onDelivered={() => {
            setState("delivered");
            setDeliveredAt(new Date().toISOString());
          }}
        />
      )}
    </li>
  );
}
