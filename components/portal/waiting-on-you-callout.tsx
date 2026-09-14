// Mission 20260914-portal-simplify, F010 (AS-018): Home's own single
// "N things are waiting on you" callout. Sources its count from F005's
// `getWaitingOnYouCount` -- the SAME helper the "For you" sidebar badge
// (F008) reads -- so this callout and the badge can never disagree about
// how many things are waiting on the client for the same project. This
// component takes the already-resolved count as a prop rather than
// fetching it itself; it renders nothing when the read failed or the
// total is 0, per AS-018's own wording ("hides it at 0"), matching the
// "no fabricated zero" honesty rule the underlying helper documents on
// itself.
//
// Replaces the old `WaitingOnYouBlock` (lib/portal/build-waiting-on-you-
// items.ts) on this page: that block listed individual rows (approvals,
// tasks, deliverables, accounts, a draft brief) which is now largely
// superseded by the "For you" page (F006) the callout's own button links
// to -- showing both a list AND this callout would restate the same
// obligation twice on one screen, the exact duplication this mission's
// own spec calls out.
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function WaitingOnYouCallout({
  total,
  overdue,
  href,
}: {
  /** `getWaitingOnYouCount(...).data.total` -- decisions + materials. */
  total: number;
  /** `getWaitingOnYouCount(...).data.overdue`. */
  overdue: number;
  /** The "For you" route this callout's button sends the client to. */
  href: string;
}) {
  // AS-018: hidden entirely at 0 -- no empty-state placeholder, this
  // callout simply isn't part of the page when there is nothing waiting.
  if (total <= 0) {
    return null;
  }

  const overdueLabel =
    overdue > 0 ? (overdue === 1 ? "One is overdue." : `${overdue} are overdue.`) : null;

  return (
    <Card
      data-testid="waiting-on-you-callout"
      className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">
          <span className="font-mono" data-testid="waiting-on-you-callout-count">
            {total}
          </span>{" "}
          {total === 1 ? "thing is waiting on you" : "things are waiting on you"}
        </p>
        {overdueLabel && (
          <p data-testid="waiting-on-you-callout-overdue" className="text-sm text-status-blocked">
            {overdueLabel}
          </p>
        )}
      </div>
      <Link
        href={href}
        data-testid="waiting-on-you-callout-link"
        className={buttonVariants({ variant: "primary", size: "sm", className: "w-fit shrink-0" })}
      >
        Review now
      </Link>
    </Card>
  );
}
